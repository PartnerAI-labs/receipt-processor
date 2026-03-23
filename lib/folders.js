const fs = require("fs");
const path = require("path");

const SUBFOLDERS = [
  "inbox",
  "awaiting-approval",
  "approved",
  "uploaded",
  "needs-attention",
  "data",
];

function ensureFolderStructure(basePath) {
  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true });
  }
  for (const sub of SUBFOLDERS) {
    const dir = path.join(basePath, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function moveReceipt(basePath, filename, fromFolder, toFolder) {
  const src = path.join(basePath, fromFolder, filename);
  const dest = path.join(basePath, toFolder, filename);
  fs.renameSync(src, dest);
}

function listReceipts(basePath, folder) {
  const dir = path.join(basePath, folder);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpg|jpeg|png|pdf|heic|webp)$/i.test(f));
}

// CLI support: `node lib/folders.js init <path>`
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === "init" && args[1]) {
    const targetPath = path.resolve(args[1]);
    ensureFolderStructure(targetPath);
    console.log(`Folder structure created at: ${targetPath}`);
    for (const sub of SUBFOLDERS) {
      console.log(`  - ${sub}/`);
    }
  } else {
    console.error("Usage: node lib/folders.js init <path>");
    process.exit(1);
  }
}

module.exports = { ensureFolderStructure, moveReceipt, listReceipts, SUBFOLDERS };
