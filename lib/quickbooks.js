const fs = require("fs");
const path = require("path");
const QuickBooks = require("node-quickbooks");

const CONFIG_PATH = path.join(__dirname, "..", "config", "quickbooks.json");

/**
 * Load QuickBooks configuration from config/quickbooks.json.
 * Throws a descriptive error if the file is not found.
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `QuickBooks config not found at ${CONFIG_PATH}. ` +
        "Copy config/quickbooks.example.json to config/quickbooks.json and fill in your credentials."
    );
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

/**
 * Refresh the OAuth2 access token and persist both tokens to config file.
 * Call this before starting a batch upload.
 */
function refreshAndPersist(qbo) {
  return new Promise((resolve, reject) => {
    qbo.refreshAccessToken((err, response) => {
      if (err) return reject(err);
      const config = loadConfig();
      config.accessToken = response.access_token;
      config.refreshToken = response.refresh_token;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
      resolve(response);
    });
  });
}

/**
 * Create and return a node-quickbooks client instance using OAuth 2.0.
 * Sets sandbox or production mode based on config.environment.
 */
function createClient() {
  const config = loadConfig();
  const useSandbox = config.environment === "sandbox";

  QuickBooks.setOauthVersion("2.0", useSandbox);

  return new QuickBooks(
    config.clientId,
    config.clientSecret,
    config.accessToken,
    false, // no token secret for OAuth 2.0
    config.realmId,
    useSandbox,
    false, // debug
    null, // minorversion (use default)
    "2.0",
    config.refreshToken
  );
}

// In-memory caches for batch lookups (reset per script run)
const accountCache = new Map();
const vendorCache = new Map();
const taxCodeCache = new Map();

function findAccountByName(qbo, name) {
  if (accountCache.has(name)) return Promise.resolve(accountCache.get(name));
  return new Promise((resolve, reject) => {
    qbo.findAccounts({ Name: name, limit: 1 }, (err, result) => {
      if (err) return reject(err);
      const accounts = result?.QueryResponse?.Account;
      if (!accounts || accounts.length === 0) {
        resolve(null);
        return;
      }
      const ref = { value: accounts[0].Id, name: accounts[0].Name };
      accountCache.set(name, ref);
      resolve(ref);
    });
  });
}

function findOrCreateVendor(qbo, name) {
  if (vendorCache.has(name)) return Promise.resolve(vendorCache.get(name));
  return new Promise((resolve, reject) => {
    qbo.findVendors({ DisplayName: name, limit: 1 }, (err, result) => {
      if (err) return reject(err);
      const vendors = result?.QueryResponse?.Vendor;
      if (vendors && vendors.length > 0) {
        const ref = { value: vendors[0].Id, name: vendors[0].DisplayName };
        vendorCache.set(name, ref);
        return resolve(ref);
      }
      qbo.createVendor({ DisplayName: name }, (createErr, vendor) => {
        if (createErr) return reject(createErr);
        const ref = { value: vendor.Id, name: vendor.DisplayName };
        vendorCache.set(name, ref);
        resolve(ref);
      });
    });
  });
}

function findTaxCodeByName(qbo, name) {
  if (taxCodeCache.has(name)) return Promise.resolve(taxCodeCache.get(name));
  return new Promise((resolve, reject) => {
    qbo.findTaxCodes({ Name: name, limit: 1 }, (err, result) => {
      if (err) return reject(err);
      const codes = result?.QueryResponse?.TaxCode;
      if (!codes || codes.length === 0) {
        resolve(null);
        return;
      }
      const ref = { value: codes[0].Id, name: codes[0].Name };
      taxCodeCache.set(name, ref);
      resolve(ref);
    });
  });
}

/**
 * Create a Purchase record in QuickBooks for the given receipt data.
 * Resolves entity names to QB IDs via the lookup helpers above.
 * Returns a Promise that resolves with the created Purchase.
 */
async function createPurchase(qbo, receiptData, config) {
  if (!config.defaultAccountId || config.defaultAccountId === "YOUR_BANK_OR_CC_ACCOUNT_ID") {
    throw new Error(
      "Missing defaultAccountId in config/quickbooks.json. " +
        "Set this to your bank or credit card account ID from QuickBooks > Chart of Accounts."
    );
  }

  const paymentType =
    receiptData.payment_method?.toLowerCase() === "cash" ? "Cash" : "CreditCard";

  const expenseAccount = receiptData.suggested_category
    ? await findAccountByName(qbo, receiptData.suggested_category)
    : null;

  const vendor = receiptData.vendor_name
    ? await findOrCreateVendor(qbo, receiptData.vendor_name)
    : null;

  // Try UK tax code names first, fall back to US sandbox names
  const vatRate = Number(receiptData.vat_rate);
  const taxCodeNames = vatRate === 20 ? ["20.0% S", "TAX"]
    : vatRate === 5 ? ["5.0% R", "TAX"]
    : ["No VAT", "NON"];
  let taxCode = null;
  for (const name of taxCodeNames) {
    taxCode = await findTaxCodeByName(qbo, name);
    if (taxCode) break;
  }

  const lineDetail = {
    AccountRef: expenseAccount || (() => {
      console.warn(`  Warning: category "${receiptData.suggested_category}" not found in QuickBooks. Using Uncategorised Expense.`);
      return { value: config.defaultExpenseAccountId || "1", name: "Uncategorised Expense" };
    })(),
    ...(taxCode && { TaxCodeRef: { value: taxCode.value } }),
  };

  const purchase = {
    PaymentType: paymentType,
    AccountRef: { value: config.defaultAccountId },
    TotalAmt: receiptData.gross_amount,
    TxnDate: receiptData.date,
    Line: [
      {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: receiptData.gross_amount,
        Description: receiptData.description || "",
        AccountBasedExpenseLineDetail: lineDetail,
      },
    ],
    ...(vendor && { EntityRef: { value: vendor.value, name: vendor.name, type: "Vendor" } }),
    CurrencyRef: {
      value: receiptData.currency || "GBP",
    },
  };

  return new Promise((resolve, reject) => {
    qbo.createPurchase(purchase, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

/**
 * Upload a receipt file and attach it to a Purchase in QuickBooks.
 * Returns a Promise that resolves with the attachment data.
 */
function uploadAttachment(qbo, purchaseId, filePath) {
  return new Promise((resolve, reject) => {
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    const contentTypes = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".heic": "image/heic",
      ".webp": "image/webp",
    };

    const contentType = contentTypes[ext] || "application/octet-stream";
    const stream = fs.createReadStream(filePath);

    qbo.upload(filename, contentType, stream, "Purchase", purchaseId, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

module.exports = {
  loadConfig,
  createClient,
  refreshAndPersist,
  createPurchase,
  uploadAttachment,
  findAccountByName,
  findOrCreateVendor,
  findTaxCodeByName,
};
