const express = require("express");
const path = require("path");
const apiRoutes = require("./routes/api");
const qbRoutes = require("./routes/quickbooks");

const app = express();
const PORT = process.env.PORT || 3000;

// Parse the --receipts flag from process.argv
const receiptsIdx = process.argv.indexOf("--receipts");
const receiptsPath =
  receiptsIdx !== -1
    ? process.argv[receiptsIdx + 1]
    : path.join(require("os").homedir(), "receipts");

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "web")));

// Serve receipt images from awaiting-approval folder
app.use(
  "/receipts",
  express.static(path.join(receiptsPath, "awaiting-approval"))
);

// API routes
app.use("/api", apiRoutes(receiptsPath));
app.use("/api/qb", qbRoutes(receiptsPath, PORT));

app.listen(PORT, () => {
  console.log(`Receipt verification UI running at http://localhost:${PORT}`);
  console.log(`Receipts folder: ${receiptsPath}`);

  // Auto-open browser
  import("open").then((open) => open.default(`http://localhost:${PORT}`));
});
