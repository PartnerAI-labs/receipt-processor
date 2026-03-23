import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn, execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let serverProcess = null;

const server = new McpServer({
  name: "receipt-processor",
  version: "1.0.0",
});

server.tool(
  "start_verification_ui",
  "Start the receipt verification web UI. Opens a browser at localhost:3000 for reviewing receipts.",
  {
    receipts_path: z.string().describe("Path to the receipts folder (e.g. ~/receipts)"),
  },
  async ({ receipts_path }) => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }

    const resolvedPath = receipts_path.replace(/^~/, homedir());
    const serverScript = join(__dirname, "server", "server.js");
    const logs = [];

    // Check if server script exists
    if (!existsSync(serverScript)) {
      return {
        content: [{ type: "text", text: `Server script not found at ${serverScript}` }],
        isError: true,
      };
    }

    // Check if node_modules exist
    const nodeModules = join(__dirname, "node_modules");
    if (!existsSync(nodeModules)) {
      logs.push("node_modules not found, running npm install...");
      try {
        execSync("npm install", { cwd: __dirname, timeout: 30000 });
        logs.push("npm install succeeded");
      } catch (e) {
        return {
          content: [{ type: "text", text: `npm install failed: ${e.message}` }],
          isError: true,
        };
      }
    }

    return new Promise((resolve) => {
      serverProcess = spawn("node", [serverScript, "--receipts", resolvedPath], {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PORT: "3000" },
      });

      let started = false;

      serverProcess.stdout.on("data", (data) => {
        const output = data.toString().trim();
        logs.push(`stdout: ${output}`);
        if (!started && output.includes("localhost")) {
          started = true;
          resolve({
            content: [{
              type: "text",
              text: [
                "Verification UI started at http://localhost:3000",
                "Browser should open automatically.",
                "",
                "Debug info:",
                ...logs,
              ].join("\n"),
            }],
          });
        }
      });

      serverProcess.stderr.on("data", (data) => {
        const output = data.toString().trim();
        logs.push(`stderr: ${output}`);
      });

      serverProcess.on("error", (err) => {
        logs.push(`error: ${err.message}`);
        if (!started) {
          started = true;
          resolve({
            content: [{ type: "text", text: `Failed to start:\n${logs.join("\n")}` }],
            isError: true,
          });
        }
      });

      serverProcess.on("exit", (code) => {
        logs.push(`process exited with code ${code}`);
        if (!started) {
          started = true;
          resolve({
            content: [{ type: "text", text: `Server exited immediately:\n${logs.join("\n")}` }],
            isError: true,
          });
        }
      });

      setTimeout(() => {
        if (!started) {
          started = true;
          resolve({
            content: [{
              type: "text",
              text: `Server may have started but no confirmation:\n${logs.join("\n")}`,
            }],
          });
        }
      }, 10000);
    });
  }
);

server.tool(
  "stop_verification_ui",
  "Stop the receipt verification web UI server.",
  {},
  async () => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
      return { content: [{ type: "text", text: "Server stopped." }] };
    }
    return { content: [{ type: "text", text: "No server was running." }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
