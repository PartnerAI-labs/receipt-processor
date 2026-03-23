# Process Receipts

Extract data from business receipt photos, review them in a verification UI, and optionally upload approved expenses to QuickBooks Online. Designed for UK sole traders and small businesses.

## Activation Triggers

- "Process my receipts"
- "I have new receipts to log"
- "Extract data from these receipts"
- "Review my expenses"
- "Upload receipts to QuickBooks"

## Important: Local Execution

This plugin runs a web server that must be accessible at localhost:3000. ALL commands MUST run on the user's LOCAL Windows machine using Windows-MCP PowerShell. Do NOT run commands inside the Cowork VM or sandbox. Always use Google Chrome as the browser for verification.

## Step 0 — Environment Setup and Server Start (Always do this first)

Ask the user for their receipts folder path. Default to `$env:USERPROFILE\receipts`.

All commands below MUST run on the user's LOCAL Windows machine using Windows-MCP PowerShell.

**1. Check if Node.js is installed. If not, install it automatically:**

```powershell
$nodeCheck = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCheck) {
    Write-Output "Node.js not found. Installing via winget..."
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    # Refresh PATH so node/npm are available in this session
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    # Verify install succeeded
    $nodeCheck = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCheck) {
        Write-Error "Node.js installation failed. Please install manually from https://nodejs.org"
        return
    }
}
Write-Output "Node.js version: $(node --version)"
Write-Output "npm version: $(npm --version)"
```

If winget is not available, fall back to downloading the Node.js LTS installer from https://nodejs.org and running it silently.

**2. Check if Git is installed. If not, install it automatically:**

```powershell
$gitCheck = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCheck) {
    Write-Output "Git not found. Installing via winget..."
    winget install Git.Git --accept-source-agreements --accept-package-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
}
```

**3. Create the receipts folder if it doesn't exist:**

```powershell
$receiptsPath = "<receipts-path>"
if (-not (Test-Path $receiptsPath)) { New-Item -ItemType Directory -Path $receiptsPath -Force }
```

**4. Clone or update the plugin repo (run each command separately to avoid timeouts):**

First check if the repo already exists:

```powershell
Test-Path "<receipts-path>\.receipt-processor\.git"
```

If `True`, pull updates:

```powershell
cd "<receipts-path>\.receipt-processor"; git pull
```

If `False`, clone (this may take a moment):

```powershell
git clone https://github.com/PartnerAI-labs/receipt-processor.git "<receipts-path>\.receipt-processor"
```

Run each command as a separate PowerShell call. Do NOT combine them into one block.

**5. Install dependencies (background process to avoid 60s timeout):**

npm install can exceed the PowerShell timeout. Launch it as a background process and poll for completion:

```powershell
Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d `"<receipts-path>\.receipt-processor`" && npm install" -WindowStyle Hidden
```

Then poll until `node_modules` appears (check every 5 seconds, up to 120 seconds):

```powershell
Test-Path "<receipts-path>\.receipt-processor\node_modules"
```

Wait for `True` before proceeding. After npm install finishes, wait 5 seconds for any child processes to exit:

```powershell
Start-Sleep -Seconds 5
```

**6. Clean up any stray node processes from npm install before starting the server:**

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
```

**7. Initialise the folder structure:**

```powershell
node "<receipts-path>\.receipt-processor\lib\folders.js" init "<receipts-path>"
```

**8. Start the Express server:**

```powershell
Start-Process -FilePath "node" -ArgumentList "<receipts-path>\.receipt-processor\server\server.js", "--receipts", "<receipts-path>" -WorkingDirectory "<receipts-path>\.receipt-processor" -WindowStyle Hidden
Start-Sleep -Seconds 3
```

**9. Verify the server is running on the user's local machine:**

```powershell
try { (Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { "FAILED: $_" }
```

If the response is `200`, the server is running. If it fails, check the port is not in use and retry.

**10. Open localhost:3000 in Google Chrome explicitly.** Do NOT use the default browser or "desktop browser tools". Run this exact command:

```powershell
Start-Process "chrome.exe" -ArgumentList "http://localhost:3000"
```

Then take a screenshot to confirm the Receipt Verification page loaded successfully in Chrome.

Do NOT proceed to Step 1 until the server is confirmed running and visible in Google Chrome on the user's local machine.

## Step 1 — Extract Receipt Data

Read all files from the `inbox/` subfolder of the receipts folder. For each receipt image or PDF, examine it carefully and extract:

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
Match each receipt to a category from `<receipts-path>\.receipt-processor\config\categories.json` using the keyword lists and your own judgement about the nature of the expense.

**VAT calculation:**
If VAT amounts are not printed on the receipt but the vendor has a VAT registration number, calculate:
- Standard rate (20%): `net = gross / 1.20`, `vat = gross - net`
- Reduced rate (5%): `net = gross / 1.05`, `vat = gross - net`

**Save and organise:**
1. Save extracted data as JSON in `data/<filename>.json` inside the receipts folder — include all extracted fields plus `filename` (original receipt filename), `status: "awaiting-approval"`, `extracted_at` (ISO 8601 timestamp), and `notes: ""`
2. Move the receipt file from `inbox/` to `awaiting-approval/`

**After processing all receipts:**
Report a summary: number processed, total value, and flag any fields you were uncertain about.

## Step 2 — Review Receipts

The verification server is already running from Step 0. Open http://localhost:3000 in Google Chrome using Claude-in-Chrome tools. Take a screenshot to confirm the receipts are loaded in the UI.

Tell the user:

> I've processed [N] receipts totalling [amount]. The verification page is open at http://localhost:3000 in Chrome. Review each receipt and approve or reject. Let me know when you're done.

Wait for the user to confirm they have finished reviewing.

**When the user is done reviewing**, stop the server on the user's LOCAL machine using Windows-MCP PowerShell:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe' AND CommandLine LIKE '%server.js%'" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

If that stops nothing (no output), fall back to killing all node processes:

```powershell
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Step 3 — Upload to QuickBooks (Optional)

**Skip this step** if `<receipts-path>\.receipt-processor\config\quickbooks.json` does not exist. Instead, tell the user:

> Your approved receipts are in the `approved/` folder with data in `data/`. To enable QuickBooks upload, copy `config/quickbooks.example.json` to `config/quickbooks.json` and add your OAuth2 credentials (client ID, client secret, realm ID, refresh token, and default account ID).

**If QuickBooks is configured** and the user wants to upload, run the upload script on the user's LOCAL machine:

```powershell
cd "<receipts-path>\.receipt-processor"; npm run upload -- --receipts <receipts-path>
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
