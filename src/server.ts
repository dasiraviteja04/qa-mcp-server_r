#!/usr/bin/env node

/**
 * QA Intelligence MCP Server
 * A thin MCP server that orchestrates Playwright test execution and provides QA insights
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listTests, runTests, getFailures, getReleaseRisk } from "./tools/simple-tools.js";

const mcpServer = new McpServer({
  name: "qa-intelligence-mcp",
  version: "1.0.0"
});

// Register list_tests tool
mcpServer.registerTool(
  "list_tests",
  {
    description: "List all available tests with metadata (tags, criticality, feature)",
    inputSchema: z.object({
      tags: z.string().optional().describe("Filter tests by tag (e.g., 'critical', 'smoke', 'regression')")
    })
  },
  async (input) => listTests(input)
);

// Register run_tests tool
mcpServer.registerTool(
  "run_tests",
  {
    description: "Run Playwright tests with specified tags and parameters",
    inputSchema: z.object({
      tags: z.union([z.string(), z.array(z.string())]).optional().describe("Test tags to run"),
      workers: z.number().optional().describe("Number of parallel workers"),
      timeout: z.number().optional().describe("Test timeout in milliseconds")
    })
  },
  async (input) => runTests(input)
);

// Register get_failures tool
mcpServer.registerTool(
  "get_failures",
  {
    description: "Analyze and classify failures from the latest test execution",
    inputSchema: z.object({})
  },
  async (input) => getFailures(input)
);

// Register get_release_risk tool
mcpServer.registerTool(
  "get_release_risk",
  {
    description: "Assess release risk based on test results and QA policies",
    inputSchema: z.object({})
  },
  async (input) => getReleaseRisk(input)
);

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  
  console.error("✓ QA Intelligence MCP Server started");
  console.error("  • list_tests: List available tests with metadata");
  console.error("  • run_tests: Execute tests with controlled parameters");
  console.error("  • get_failures: Analyze test failures");
  console.error("  • get_release_risk: Assess if safe to release");
  console.error("\nServer is ready for MCP connections on stdio...");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
