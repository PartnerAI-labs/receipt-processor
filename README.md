# Receipt Processor

A Claude Cowork plugin for processing business receipts. Extract data from receipt photos, review and approve via a web UI, then upload to QuickBooks Online.

Built for UK sole traders and small businesses.

## What it does

1. **Extract** — Drop receipt photos into your `inbox/` folder. Claude reads each one and pulls out vendor, date, amount, VAT, category, and more.
2. **Review** — A local web UI opens at localhost:3000 where you approve or reject each extraction before anything is recorded.
3. **Upload** — Approved receipts can be pushed to QuickBooks Online as expense entries (optional, requires OAuth2 setup).

## Getting started

1. Install the plugin in Claude Cowork
2. Say "process my receipts" — Claude will ask for your receipts folder and walk you through the rest
3. For QuickBooks integration, copy `config/quickbooks.example.json` to `config/quickbooks.json` and add your credentials

## Connectors

See [CONNECTORS.md](CONNECTORS.md) for details on connecting QuickBooks Online.

## Plugin structure

```
.claude-plugin/plugin.json   Plugin manifest
.mcp.json                    MCP server configuration
mcp-server.mjs               Verification UI server (start/stop tools)
skills/process-receipts/      Receipt processing workflow
config/                       Category definitions and QuickBooks config
server/                       Express server for the review UI
web/                          Review UI frontend
lib/                          Shared utilities
scripts/                      QuickBooks upload scripts
```

## License

Apache 2.0
