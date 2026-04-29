#!/usr/bin/env node

/**
 * QA Intelligence MCP Server
 * A thin MCP server that orchestrates Playwright test execution and provides QA insights
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listTests, runTests, getFailures, getReleaseRisk, readSchema, readStepInventory, readPageSource, generateTests, autoResearch, coverageAnalysis } from "./tools/simple-tools.js";

const mcpServer = new McpServer({
  name: "qa-intelligence-explorecredit",
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
    description: "Execute dotnet test (UIAutomationTests / Reqnroll / NUnit / Playwright C#) and return structured pass/fail results with screenshot paths.\n\nFilter priority: filter > scenario > tags.\nDevice routing: iPhone 14 → mobile.runsettings | Pixel 5 → mobile-pixel.runsettings | iPad Pro 11 → mobile-tablet.runsettings | omit → auto.runsettings (desktop)\n\nExamples:\n  Desktop run:    { tags: 'couponhive-ui' }\n  Mobile iPhone:  { tags: 'couponhive-ui', device: 'iPhone 14' }\n  Mobile Android: { tags: 'couponhive-ui', device: 'Pixel 5' }\n  Mobile Tablet:  { tags: 'couponhive-ui', device: 'iPad Pro 11' }\n  Single scenario desktop: { scenario: 'CreateSingleCoupon' }\n  Single scenario mobile:  { scenario: 'CreateSingleCoupon', device: 'iPhone 14' }",
    inputSchema: z.object({
      tags: z.union([z.string(), z.array(z.string())]).optional()
        .describe("Gherkin category tags to filter tests, e.g. 'couponhive-ui' or ['couponhive-ui-export','regression']. Maps to NUnit TestCategory filter."),
      filter: z.string().optional()
        .describe("Raw VSTest --filter expression passed verbatim, e.g. 'FullyQualifiedName~BulkCoupon' or 'TestCategory=regression&FullyQualifiedName~Export'. Takes priority over tags."),
      scenario: z.string().optional()
        .describe("Single scenario name (partial match). Auto-wrapped as FullyQualifiedName~<value>. Takes priority over tags. Example: 'CreateSingleCouponViaUI'"),
      device: z.string().optional()
        .describe("Playwright device name for mobile emulation. Omit for desktop. Examples: 'iPhone 14', 'iPhone 14 Pro Max', 'Pixel 5', 'Galaxy S9+', 'iPad Pro 11', 'Nexus 10'. Automatically selects the correct mobile runsettings file."),
      workers: z.number().optional()
        .describe("Max parallel workers. Capped by environment config (default 2)."),
      timeout: z.number().optional()
        .describe("Per-test timeout hint in milliseconds. Capped by environment config (default 300000)."),
      autoResearch: z.boolean().optional()
        .describe("When true, automatically runs the research loop after tests complete and failures are found. Appends root-cause analysis, git correlation, and release verdict to the run output. Default: false.")
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

// Register read_schema tool
mcpServer.registerTool(
  "read_schema",
  {
    description: "Read the live SQL Server database schema — tables, columns, types, and foreign-key relationships. Use before writing DBMethods to get exact column names.",
    inputSchema: z.object({
      tables: z.string().optional().describe("Comma-separated table names to filter (e.g., 'Loans,Borrowers,BorrowerDetails'). Omit for all tables.")
    })
  },
  async (input) => readSchema(input)
);

// Register read_step_inventory tool
mcpServer.registerTool(
  "read_step_inventory",
  {
    description: "Scan all C# step-definition files and return every existing [Given]/[When]/[Then] binding pattern. Use before writing new steps to avoid AmbiguousMatchException.",
    inputSchema: z.object({
      filter: z.string().optional().describe("Optional substring filter — returns only bindings whose pattern, class, or method name contains this text."),
      stepDefsDir: z.string().optional().describe("Override path to the StepDefinitions directory (defaults to project root StepDefinitions/).")
    })
  },
  async (input) => readStepInventory(input)
);

// Register read_page_source tool
mcpServer.registerTool(
  "read_page_source",
  {
    description: "Launch a headless browser, navigate to a URL, and return only the interactive elements (inputs, buttons, selects, links) with their best CSS selectors. Use before writing page-object classes.",
    inputSchema: z.object({
      url: z.string().describe("Full URL of the page to crawl (e.g., 'https://app.explorecredit.com/csrd/search')."),
      stateFile: z.string().optional().describe("Path to Playwright state.json for authenticated browsing. Auto-resolved from project root if omitted.")
    })
  },
  async (input) => readPageSource(input)
);

// Register generate_tests tool
mcpServer.registerTool(
  "generate_tests",
  {
    description: "Assemble full code-generation context (DB schema + step inventory + existing features + page elements) and return a structured prompt for Claude to generate accurate, non-duplicate test artifacts.",
    inputSchema: z.object({
      artifact: z.enum(['feature', 'steps', 'page_object', 'db_methods', 'full_suite'])
        .describe("Type of artifact to generate: feature (Gherkin), steps (C# step class), page_object (C# page class), db_methods (EF Core queries), full_suite (all four)."),
      featureArea: z.string().describe("Feature module name, e.g. 'ChargeOff', 'Payoff', 'CustomerSearch'. Used to scope DB tables, step bindings, and existing features."),
      pageUrl: z.string().optional().describe("URL to crawl for page elements (required for page_object and full_suite artifacts)."),
      tables: z.string().optional().describe("Comma-separated DB table names to include in schema context."),
      tags: z.string().optional().describe("Comma-separated Gherkin tags for generated scenarios, e.g. 'regression,chargeoff'. Defaults to 'regression'.")
    })
  },
  async (input) => generateTests(input)
);

// Register auto_research tool
mcpServer.registerTool(
  "auto_research",
  {
    description: "Run the AutoResearch loop on the latest test execution. Investigates failures, correlates with git history, scans for coverage gaps, and returns a ResearchReport with a release verdict (SAFE / CAUTION / BLOCK) and suggested next steps — without further prompting.",
    inputSchema: z.object({
      depth: z.enum(['shallow', 'deep']).optional()
        .describe("Research depth. 'shallow' runs 3 iterations (classify + flakiness + verdict). 'deep' runs all 5 (adds git correlation + coverage gaps). Default: 'deep'."),
      includeGit: z.boolean().optional()
        .describe("Include git commit correlation analysis. Default: true."),
      includeCoverage: z.boolean().optional()
        .describe("Include coverage gap analysis for recently changed files. Default: true.")
    })
  },
  async (input) => autoResearch(input)
);

// Register coverage_analysis tool
mcpServer.registerTool(
  "coverage_analysis",
  {
    description: "Scan recently changed source files against .feature files to find test coverage gaps. Returns a list of changed areas with zero or insufficient scenario coverage.",
    inputSchema: z.object({
      since: z.string().optional()
        .describe("How far back to look in git history. Examples: '7d', '14d', '30d'. Default: '14d'."),
      area: z.string().optional()
        .describe("Optional: limit analysis to a specific feature area name. E.g. 'CouponExpiry', 'AuditLogger'.")
    })
  },
  async (input) => coverageAnalysis(input)
);

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  
  console.error("✓ QA Intelligence MCP Server started (explorecredit / UIAutomationTests)");
  console.error("  Execution & Reporting:");
  console.error("  • list_tests:          Parse .feature files, list all Gherkin scenarios");
  console.error("  • run_tests:           Execute dotnet test with NUnit category filtering");
  console.error("  • get_failures:        Classify TRX failures (flaky / regression / env-issue)");
  console.error("  • get_release_risk:    Financial-domain risk assessment with policy enforcement");
  console.error("  Code Generation:");
  console.error("  • read_schema:         Live SQL Server schema — exact column names + FK map");
  console.error("  • read_step_inventory: All existing [Given]/[When]/[Then] bindings in .cs files");
  console.error("  • read_page_source:    Headless browser → interactive elements + selectors");
  console.error("  • generate_tests:      Assemble full context for Claude to generate artifacts");
  console.error("  AutoResearch:");
  console.error("  • auto_research:       Investigate failures, correlate git, find coverage gaps");
  console.error("  • coverage_analysis:   Find test coverage gaps for recently changed files");
  console.error("\nServer is ready for MCP connections on stdio...");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
