# Process Receipts

Extract data from business receipt photos, review them in a verification UI, and optionally upload approved expenses to QuickBooks Online. Designed for UK sole traders and small businesses.

## Activation Triggers

- "Process my receipts"
- "I have new receipts to log"
- "Extract data from these receipts"
- "Review my expenses"
- "Upload receipts to QuickBooks"

## Important: Local Execution

This plugin requires running a web server on the user's LOCAL Windows machine so the verification UI is accessible in their browser. All commands MUST be executed on the user's local machine using desktop automation tools (Windows-MCP PowerShell, computer/browser tools). Do NOT run commands inside the Cowork VM or sandbox.

## Step 0 — Start the Verification Server (Always do this first)

Before anything else, start the Express server on the user's LOCAL machine. This ensures localhost:3000 is ready when receipts are processed.

**Start the server** using desktop PowerShell tools on the user's LOCAL machine (NOT bash, NOT sandboxed execution):

```powershell
cd "${CLAUDE_PLUGIN_ROOT}"
if (-not (Test-Path "node_modules")) { npm install }
Start-Process -FilePath "node" -ArgumentList "server/server.js", "--receipts", "<receipts-path>" -WorkingDirectory "${CLAUDE_PLUGIN_ROOT}" -WindowStyle Hidden
Start-Sleep -Seconds 3
```

Replace `<receipts-path>` with the user's receipts folder path.

**Verify the server is running** by making a request from the user's LOCAL machine:

```powershell
try { (Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { "FAILED: $_" }
```

If the response is `200`, the server is running. If it fails, check that node is installed and the port is not in use.

**Open the UI in the user's local browser** using desktop browser tools (e.g. navigate to http://localhost:3000 using computer/browser automation). Take a screenshot to visually confirm the Receipt Verification page loaded correctly.

Do NOT proceed to Step 1 until you have confirmed the server is running and the UI is visible in the user's local browser.

## Setup

Ask the user for their receipts folder path if not already known. Default to `~/receipts/`.

Initialise the folder structure by running the init script at `${CLAUDE_PLUGIN_ROOT}/lib/folders.js` with the receipts path. This creates the required subfolders: `inbox/`, `awaiting-approval/`, `approved/`, `uploaded/`, `needs-attention/`, and `data/`.

## Step 1 — Extract Receipt Data

Read all files from the `inbox/` subfolder. For each receipt image or PDF, examine it carefully and extract:

**Required fields:**
- `vendor_name` — the business that issued the receipt
- `date` — YYYY-MM-DD format
- `gross_amount` — total amount paid
- `currency` — currency code (typically GBP)

**Optional fields (include when visible):**
- `vendor_address` — full address
- `vat_registration_number` — UK VAT number (GB 123 4567 89)
- `invoice_number` — receipt or invoice reference
- `description` — brief summary of what was purchased
- `net_amount` — amount before VAT
- `vat_rate` — one of: 20, 5, or 0
- `vat_amount` — VAT charged
- `payment_method` — card, cash, bank transfer, etc.
- `line_items` — array of individual items if listed

**Category assignment:**
Match each receipt to a category from `${CLAUDE_PLUGIN_ROOT}/config/categories.json` using the keyword lists and your own judgement about the nature of the expense.

**VAT calculation:**
If VAT amounts are not printed on the receipt but the vendor has a VAT registration number, calculate:
- Standard rate (20%): `net = gross / 1.20`, `vat = gross - net`
- Reduced rate (5%): `net = gross / 1.05`, `vat = gross - net`

**Save and organise:**
1. Save extracted data as JSON in `data/<filename>.json` — include all extracted fields plus `filename` (original receipt filename), `status: "awaiting-approval"`, `extracted_at` (ISO 8601 timestamp), and `notes: ""`
2. Move the receipt file from `inbox/` to `awaiting-approval/`

**After processing all receipts:**
Report a summary: number processed, total value, and flag any fields you were uncertain about.

## Step 2 — Review Receipts

The verification server is already running from Step 0. Tell the user:

> I've processed [N] receipts totalling [amount]. The verification page is open at http://localhost:3000. Review each receipt and approve or reject. Let me know when you're done.

Wait for the user to confirm they have finished reviewing.

**When the user is done reviewing**, stop the server on the user's LOCAL machine using desktop PowerShell tools:

```powershell
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*server.js*" } | Stop-Process -Force
```

## Step 3 — Upload to QuickBooks (Optional)

**Skip this step** if `${CLAUDE_PLUGIN_ROOT}/config/quickbooks.json` does not exist. Instead, tell the user:

> Your approved receipts are in the `approved/` folder with data in `data/`. To enable QuickBooks upload, copy `config/quickbooks.example.json` to `config/quickbooks.json` and add your OAuth2 credentials (client ID, client secret, realm ID, refresh token, and default account ID).

**If QuickBooks is configured** and the user wants to upload, run the upload script on the user's LOCAL machine:

```powershell
cd "${CLAUDE_PLUGIN_ROOT}"; npm run upload -- --receipts <receipts-path>
```

Report results: how many succeeded, how many failed, and how many need attention.

## Best Practices

- Always confirm the receipts folder path before processing
- Flag low-confidence extractions rather than guessing — it is better to ask the user than to record incorrect data
- Never skip the verification step — human review is essential before anything reaches the books
- If a receipt is unreadable or ambiguous, move it to `needs-attention/` and note the issue

## Limitations

- VAT calculations are estimates when not printed on the receipt — the user should verify these
- QuickBooks upload requires the user to configure OAuth2 credentials themselves
- Category suggestions are based on keyword matching and may need manual correction
