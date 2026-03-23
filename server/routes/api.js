const express = require("express");
const fs = require("fs");
const path = require("path");

module.exports = function (receiptsPath) {
  const router = express.Router();

  const dataDir = () => path.join(receiptsPath, "data");
  const awaitingDir = () => path.join(receiptsPath, "awaiting-approval");
  const approvedDir = () => path.join(receiptsPath, "approved");
  const needsAttentionDir = () => path.join(receiptsPath, "needs-attention");

  /**
   * Helper: read a JSON data file for a given receipt filename.
   * Data files are stored as <receipt-filename>.json in data/.
   */
  function readDataFile(filename) {
    const jsonPath = path.join(dataDir(), filename + ".json");
    if (!fs.existsSync(jsonPath)) return null;
    return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  }

  /**
   * Helper: write a JSON data file for a given receipt filename.
   */
  function writeDataFile(filename, data) {
    const jsonPath = path.join(dataDir(), filename + ".json");
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf8");
  }

  // ----------------------------------------------------------------
  // GET /api/receipts
  // List all receipts with status "awaiting-approval" from data/ folder
  // ----------------------------------------------------------------
  router.get("/receipts", (req, res) => {
    try {
      const dir = dataDir();
      if (!fs.existsSync(dir)) {
        return res.json([]);
      }

      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      const receipts = [];

      for (const file of files) {
        try {
          const data = JSON.parse(
            fs.readFileSync(path.join(dir, file), "utf8")
          );
          if (data.status === "awaiting-approval") {
            receipts.push(data);
          }
        } catch {
          // Skip malformed JSON files
        }
      }

      res.json(receipts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ----------------------------------------------------------------
  // POST /api/receipts/:filename/approve
  // Accept optional edits in body, apply them, set status to approved,
  // move receipt file from awaiting-approval/ to approved/
  // ----------------------------------------------------------------
  router.post("/receipts/:filename/approve", (req, res) => {
    try {
      const { filename } = req.params;
      const data = readDataFile(filename);

      if (!data) {
        return res
          .status(404)
          .json({ error: `Data file not found for ${filename}` });
      }

      // Apply optional edits
      if (req.body.edits && typeof req.body.edits === "object") {
        Object.assign(data, req.body.edits);
      }

      data.status = "approved";
      data.approved_at = new Date().toISOString();

      writeDataFile(filename, data);

      // Move receipt image from awaiting-approval to approved
      const src = path.join(awaitingDir(), filename);
      const dest = path.join(approvedDir(), filename);

      if (fs.existsSync(src)) {
        // Ensure destination directory exists
        if (!fs.existsSync(approvedDir())) {
          fs.mkdirSync(approvedDir(), { recursive: true });
        }
        fs.renameSync(src, dest);
      }

      res.json({ ok: true, receipt: data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ----------------------------------------------------------------
  // POST /api/receipts/:filename/reject
  // Accept optional notes in body, set status to needs-attention,
  // move receipt file from awaiting-approval/ to needs-attention/
  // ----------------------------------------------------------------
  router.post("/receipts/:filename/reject", (req, res) => {
    try {
      const { filename } = req.params;
      const data = readDataFile(filename);

      if (!data) {
        return res
          .status(404)
          .json({ error: `Data file not found for ${filename}` });
      }

      data.status = "needs-attention";
      data.rejected_at = new Date().toISOString();

      if (req.body.notes) {
        data.rejection_notes = req.body.notes;
      }

      writeDataFile(filename, data);

      // Move receipt image from awaiting-approval to needs-attention
      const src = path.join(awaitingDir(), filename);
      const dest = path.join(needsAttentionDir(), filename);

      if (fs.existsSync(src)) {
        if (!fs.existsSync(needsAttentionDir())) {
          fs.mkdirSync(needsAttentionDir(), { recursive: true });
        }
        fs.renameSync(src, dest);
      }

      res.json({ ok: true, receipt: data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ----------------------------------------------------------------
  // POST /api/receipts/:filename/edit
  // Accept edits in body, merge into JSON, set edited_at timestamp
  // ----------------------------------------------------------------
  router.post("/receipts/:filename/edit", (req, res) => {
    try {
      const { filename } = req.params;
      const data = readDataFile(filename);

      if (!data) {
        return res
          .status(404)
          .json({ error: `Data file not found for ${filename}` });
      }

      if (req.body.edits && typeof req.body.edits === "object") {
        Object.assign(data, req.body.edits);
      }

      data.edited_at = new Date().toISOString();

      writeDataFile(filename, data);

      res.json({ ok: true, receipt: data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ----------------------------------------------------------------
  // GET /api/categories
  // Read config/categories.json, return array of category names only
  // ----------------------------------------------------------------
  router.get("/categories", (req, res) => {
    try {
      const categoriesPath = path.join(
        __dirname, "..", "..", "config", "categories.json"
      );

      if (!fs.existsSync(categoriesPath)) {
        return res.status(404).json({ error: "categories.json not found" });
      }

      const categoriesData = JSON.parse(
        fs.readFileSync(categoriesPath, "utf8")
      );
      const names = categoriesData.categories.map((c) => c.name);
      res.json(names);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ----------------------------------------------------------------
  // GET /api/summary
  // Return counts: total, awaiting, approved, rejected, uploaded,
  // plus total_value of awaiting receipts
  // ----------------------------------------------------------------
  router.get("/summary", (req, res) => {
    try {
      const dir = dataDir();
      if (!fs.existsSync(dir)) {
        return res.json({
          total: 0,
          awaiting: 0,
          approved: 0,
          rejected: 0,
          uploaded: 0,
          total_value: 0,
        });
      }

      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

      let total = 0;
      let awaiting = 0;
      let approved = 0;
      let rejected = 0;
      let uploaded = 0;
      let totalValue = 0;

      for (const file of files) {
        try {
          const data = JSON.parse(
            fs.readFileSync(path.join(dir, file), "utf8")
          );
          total++;

          switch (data.status) {
            case "awaiting-approval":
              awaiting++;
              if (data.gross_amount) {
                totalValue += parseFloat(data.gross_amount) || 0;
              }
              break;
            case "approved":
              approved++;
              break;
            case "needs-attention":
              rejected++;
              break;
            case "uploaded":
              uploaded++;
              break;
          }
        } catch {
          // Skip malformed JSON files
        }
      }

      res.json({
        total,
        awaiting,
        approved,
        rejected,
        uploaded,
        total_value: Math.round(totalValue * 100) / 100,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
