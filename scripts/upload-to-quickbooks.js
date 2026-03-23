const fs = require("fs");
const path = require("path");
const {
  loadConfig,
  createClient,
  createPurchase,
  uploadAttachment,
  refreshAndPersist,
} = require("../lib/quickbooks");

// Parse --receipts flag from argv (default ~/receipts/)
const receiptsIdx = process.argv.indexOf("--receipts");
const receiptsPath =
  receiptsIdx !== -1
    ? process.argv[receiptsIdx + 1]
    : path.join(require("os").homedir(), "receipts");

const dataDir = path.join(receiptsPath, "data");
const approvedDir = path.join(receiptsPath, "approved");
const uploadedDir = path.join(receiptsPath, "uploaded");

async function main() {
  // Read all JSON files from data/ directory
  if (!fs.existsSync(dataDir)) {
    console.log("No data directory found at", dataDir);
    process.exit(0);
  }

  const jsonFiles = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith(".json"));

  // Filter for status === "approved"
  const approved = [];
  for (const file of jsonFiles) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(dataDir, file), "utf8")
      );
      if (data.status === "approved") {
        approved.push({ file, data });
      }
    } catch {
      // Skip malformed JSON files
    }
  }

  if (approved.length === 0) {
    console.log("No approved receipts to upload.");
    process.exit(0);
  }

  console.log(`Found ${approved.length} approved receipt(s). Connecting to QuickBooks...`);

  // Create QB client
  const qbo = createClient();

  // Refresh access token before batch upload
  try {
    await refreshAndPersist(qbo);
    console.log("Access token refreshed.");
  } catch (refreshErr) {
    console.warn("Token refresh failed, trying with existing token:", refreshErr.message);
  }

  const config = loadConfig();

  let uploadedCount = 0;
  let failedCount = 0;

  for (const { file, data } of approved) {
    const receiptFilename = data.filename;
    const receiptPath = path.join(approvedDir, receiptFilename);

    try {
      // Create Purchase in QuickBooks
      const purchase = await createPurchase(qbo, data, config);
      const purchaseId = purchase.Id;

      // Upload attachment if receipt file exists
      if (fs.existsSync(receiptPath)) {
        await uploadAttachment(qbo, purchaseId, receiptPath);

        // Move receipt file from approved/ to uploaded/
        if (!fs.existsSync(uploadedDir)) {
          fs.mkdirSync(uploadedDir, { recursive: true });
        }
        fs.renameSync(receiptPath, path.join(uploadedDir, receiptFilename));
      }

      // Update JSON status to "uploaded"
      data.status = "uploaded";
      data.uploaded_at = new Date().toISOString();
      data.quickbooks_id = purchaseId;
      fs.writeFileSync(
        path.join(dataDir, file),
        JSON.stringify(data, null, 2),
        "utf8"
      );

      uploadedCount++;
      console.log(`  Uploaded: ${receiptFilename} (QB ID: ${purchaseId})`);
    } catch (err) {
      failedCount++;
      console.error(`  Failed: ${receiptFilename} - ${err.message || JSON.stringify(err)}`);
    }
  }

  // Print summary
  console.log(`\nDone. ${uploadedCount} uploaded, ${failedCount} failed.`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
