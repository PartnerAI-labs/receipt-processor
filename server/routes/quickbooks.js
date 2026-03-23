const express = require("express");
const crypto = require("crypto");
const https = require("https");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "quickbooks.json");
const CLIENT_ID = "ABZH8TOvOmO7BbEfCs6yoBCJaYS52LdAOBsUQFb1F3rbrxZOEv";
const CLIENT_SECRET = "fCcomYBi2hyQloI9UXpsyjTws8DtX7ZDPHFmALbZ";
const REDIRECT_URI_BASE = "http://localhost";
const SCOPES = "com.intuit.quickbooks.accounting";
const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

module.exports = function (receiptsPath, port) {
  const router = express.Router();
  const redirectUri = `${REDIRECT_URI_BASE}:${port}/api/qb/callback`;

  function configExists() {
    return fs.existsSync(CONFIG_PATH);
  }

  function readConfig() {
    if (!configExists()) return null;
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  }

  function writeConfig(config) {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  }

  function exchangeCode(code) {
    return new Promise((resolve, reject) => {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString();

      const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
      const url = new URL(TOKEN_URL);

      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(`${parsed.error}: ${parsed.error_description}`));
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Token parse failed: ${data}`));
          }
        });
      });

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  // GET /api/qb/status — check if QB is connected
  router.get("/status", (req, res) => {
    const config = readConfig();
    if (!config || !config.refreshToken || config.refreshToken.startsWith("YOUR_")) {
      return res.json({ connected: false });
    }
    res.json({
      connected: true,
      environment: config.environment || "sandbox",
      realmId: config.realmId,
      hasDefaultAccount: !!config.defaultAccountId && config.defaultAccountId !== "YOUR_BANK_OR_CC_ACCOUNT_ID",
    });
  });

  // GET /api/qb/authorize — redirect to Intuit OAuth
  router.get("/authorize", (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      state,
    });
    res.redirect(`${AUTH_URL}?${params}`);
  });

  // GET /api/qb/callback — handle OAuth callback
  router.get("/callback", async (req, res) => {
    const { code, realmId, error } = req.query;

    if (error) {
      return res.status(400).send(`<h2>Authorization failed</h2><p>${error}</p><p><a href="/">Back</a></p>`);
    }

    if (!code || !realmId) {
      return res.status(400).send(`<h2>Missing code or realmId</h2><p><a href="/">Back</a></p>`);
    }

    try {
      const tokens = await exchangeCode(code);

      writeConfig({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: redirectUri,
        environment: "sandbox",
        realmId,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        defaultAccountId: "",
        defaultExpenseAccountId: "",
      });

      // Redirect back to the main UI
      res.redirect("/?qb=connected");
    } catch (err) {
      res.status(500).send(`<h2>Token exchange failed</h2><p>${err.message}</p><p><a href="/">Back</a></p>`);
    }
  });

  // GET /api/qb/accounts — list QB accounts for configuration
  router.get("/accounts", async (req, res) => {
    try {
      const { createClient, refreshAndPersist } = require("../../lib/quickbooks");
      const qbo = createClient();

      try { await refreshAndPersist(qbo); } catch {}

      const accounts = await new Promise((resolve, reject) => {
        qbo.findAccounts({}, (err, result) => {
          if (err) return reject(err);
          resolve(result?.QueryResponse?.Account || []);
        });
      });

      const bank = accounts.filter((a) => a.AccountType === "Bank").map((a) => ({ id: a.Id, name: a.Name }));
      const creditCard = accounts.filter((a) => a.AccountType === "Credit Card").map((a) => ({ id: a.Id, name: a.Name }));
      const expense = accounts.filter((a) => a.AccountType === "Expense").map((a) => ({ id: a.Id, name: a.Name }));

      res.json({ bank, creditCard, expense });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/qb/configure — save defaultAccountId
  router.post("/configure", (req, res) => {
    try {
      const config = readConfig();
      if (!config) return res.status(400).json({ error: "Not connected to QuickBooks" });

      if (req.body.defaultAccountId) config.defaultAccountId = req.body.defaultAccountId;
      if (req.body.defaultExpenseAccountId) config.defaultExpenseAccountId = req.body.defaultExpenseAccountId;
      if (req.body.environment) config.environment = req.body.environment;

      writeConfig(config);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/qb/upload — upload all approved receipts to QB
  router.post("/upload", async (req, res) => {
    try {
      const { createClient, createPurchase, uploadAttachment, refreshAndPersist, loadConfig } = require("../../lib/quickbooks");
      const qbo = createClient();

      try { await refreshAndPersist(qbo); } catch {}
      const config = loadConfig();

      const dataDir = path.join(receiptsPath, "data");
      const approvedDir = path.join(receiptsPath, "approved");
      const uploadedDir = path.join(receiptsPath, "uploaded");

      if (!fs.existsSync(dataDir)) return res.json({ uploaded: 0, failed: 0, errors: [] });

      const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"));
      const approved = [];

      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
          if (data.status === "approved") approved.push({ file, data });
        } catch {}
      }

      if (approved.length === 0) return res.json({ uploaded: 0, failed: 0, errors: [] });

      let uploaded = 0;
      let failed = 0;
      const errors = [];

      for (const { file, data } of approved) {
        const receiptPath = path.join(approvedDir, data.filename);
        try {
          const purchase = await createPurchase(qbo, data, config);

          if (fs.existsSync(receiptPath)) {
            await uploadAttachment(qbo, purchase.Id, receiptPath);
            if (!fs.existsSync(uploadedDir)) fs.mkdirSync(uploadedDir, { recursive: true });
            fs.renameSync(receiptPath, path.join(uploadedDir, data.filename));
          }

          data.status = "uploaded";
          data.uploaded_at = new Date().toISOString();
          data.quickbooks_id = purchase.Id;
          fs.writeFileSync(path.join(dataDir, file), JSON.stringify(data, null, 2), "utf8");

          uploaded++;
        } catch (err) {
          failed++;
          errors.push({ filename: data.filename, error: err.message || JSON.stringify(err) });
        }
      }

      res.json({ uploaded, failed, errors });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
