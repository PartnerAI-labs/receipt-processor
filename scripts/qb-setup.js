/**
 * QuickBooks OAuth2 setup helper.
 *
 * Usage: node scripts/qb-setup.js
 *
 * 1. Starts a local server on :3001 to catch the OAuth2 callback
 * 2. Opens the Intuit authorization URL in your browser
 * 3. Exchanges the auth code for tokens
 * 4. Saves everything to config/quickbooks.json
 * 5. Lists accounts and tax codes so you can pick IDs
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const CONFIG_PATH = path.join(__dirname, "..", "config", "quickbooks.json");
const CLIENT_ID = "ABZH8TOvOmO7BbEfCs6yoBCJaYS52LdAOBsUQFb1F3rbrxZOEv";
const CLIENT_SECRET = "fCcomYBi2hyQloI9UXpsyjTws8DtX7ZDPHFmALbZ";
const REDIRECT_URI = "http://localhost:3001/callback";
const SCOPES = "com.intuit.quickbooks.accounting";

// Intuit OAuth2 endpoints
const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    state: "setup",
  });
  return `${AUTH_URL}?${params}`;
}

function exchangeCodeForTokens(code, realmId) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }).toString();

    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

    const url = new URL(TOKEN_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(`${parsed.error}: ${parsed.error_description}`));
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse token response: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function qbApiGet(accessToken, realmId, entity) {
  const isSandbox = true;
  const baseUrl = isSandbox
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";

  return new Promise((resolve, reject) => {
    const queryPath = `/v3/company/${realmId}/query?query=${encodeURIComponent(`SELECT * FROM ${entity}`)}&minorversion=65`;
    const url = new URL(`${baseUrl}${queryPath}`);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse QB response: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

async function listAccountsAndTaxCodes(accessToken, realmId) {
  console.log("\n--- QuickBooks Accounts ---\n");

  try {
    const accountsResp = await qbApiGet(accessToken, realmId, "Account");
    const accounts = accountsResp?.QueryResponse?.Account || [];

    // Group by type
    const bankAccounts = accounts.filter((a) => a.AccountType === "Bank");
    const creditCards = accounts.filter((a) => a.AccountType === "Credit Card");
    const expenses = accounts.filter((a) => a.AccountType === "Expense");

    console.log("Bank Accounts (use one of these as defaultAccountId for cash/bank payments):");
    for (const a of bankAccounts) {
      console.log(`  ID: ${a.Id}  Name: ${a.Name}`);
    }

    console.log("\nCredit Card Accounts (use one of these as defaultAccountId for card payments):");
    for (const a of creditCards) {
      console.log(`  ID: ${a.Id}  Name: ${a.Name}`);
    }

    console.log("\nExpense Accounts (these are matched by category name):");
    for (const a of expenses) {
      console.log(`  ID: ${a.Id}  Name: ${a.Name}`);
    }
  } catch (err) {
    console.error("Failed to list accounts:", err.message);
  }

  console.log("\n--- QuickBooks Tax Codes ---\n");

  try {
    const taxResp = await qbApiGet(accessToken, realmId, "TaxCode");
    const taxCodes = taxResp?.QueryResponse?.TaxCode || [];

    for (const t of taxCodes) {
      console.log(`  ID: ${t.Id}  Name: ${t.Name}  Active: ${t.Active}`);
    }
  } catch (err) {
    console.error("Failed to list tax codes:", err.message);
  }
}

// --- Main: Start local server and handle OAuth2 flow ---

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:3001`);

  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h2>Authorization failed</h2><p>${error}</p>`);
    console.error("Authorization failed:", error);
    server.close();
    return;
  }

  if (!code || !realmId) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h2>Missing code or realmId in callback</h2>");
    server.close();
    return;
  }

  console.log(`\nReceived auth code. RealmId: ${realmId}`);
  console.log("Exchanging code for tokens...");

  try {
    const tokens = await exchangeCodeForTokens(code, realmId);

    // Save config
    const config = {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      environment: "sandbox",
      realmId,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      defaultAccountId: "",
      defaultExpenseAccountId: "",
    };

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
    console.log(`\nConfig saved to ${CONFIG_PATH}`);

    // List accounts and tax codes
    await listAccountsAndTaxCodes(tokens.access_token, realmId);

    console.log("\n--- Next Steps ---");
    console.log("1. Pick a Bank or Credit Card account ID from above");
    console.log("2. Edit config/quickbooks.json and set defaultAccountId to that ID");
    console.log("3. Optionally set defaultExpenseAccountId for uncategorised expenses");
    console.log("\nDone! You can close this terminal.");

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<h2>QuickBooks connected!</h2>" +
        "<p>Check your terminal for account IDs.</p>" +
        "<p>You can close this tab.</p>"
    );
  } catch (err) {
    console.error("Token exchange failed:", err.message);
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h2>Token exchange failed</h2><p>${err.message}</p>`);
  }

  server.close();
});

server.listen(3001, () => {
  const authUrl = buildAuthUrl();
  console.log("QuickBooks OAuth2 Setup");
  console.log("=======================\n");
  console.log("Opening browser for authorization...\n");
  console.log("If the browser doesn't open, visit this URL manually:");
  console.log(authUrl + "\n");

  import("open").then((open) => open.default(authUrl));
});
