# Connectors

The receipt-processor plugin uses one optional connector.

## QuickBooks Online

**Purpose:** Upload approved receipt data as expense entries to your QuickBooks Online account.

**Required for:** Step 3 (Upload to QuickBooks). Steps 1 and 2 work without any connectors.

**Setup:**

1. Create an app at [developer.intuit.com](https://developer.intuit.com)
2. Copy `config/quickbooks.example.json` to `config/quickbooks.json`
3. Fill in your credentials:
   - `clientId` and `clientSecret` — from your Intuit Developer app
   - `realmId` — your QuickBooks company ID
   - `refreshToken` — from the OAuth2 authorization flow
   - `environment` — `"sandbox"` or `"production"`
   - `defaultAccountId` — the bank or credit card account expenses are paid from (find in QuickBooks > Chart of Accounts)

**Category:** Accounting / Finance

**Alternatives:** If you don't use QuickBooks, the plugin still extracts and organises your receipts. Approved data is saved as JSON in the `data/` folder — you can import it into any accounting tool.
