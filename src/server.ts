#!/usr/bin/env node

/**
 * QA Intelligence MCP Server
 * A thin MCP server that orchestrates Playwright test execution and provides QA insights
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listTests, runTests, getFailures, getReleaseRisk, readSchema, readStepInventory, readPageSource, generateTests, autoResearch, coverageAnalysis, generateHtmlReport, scanFramework, scaffoldProject, listBlueprints, crawlPage, getCrawl, listCrawls, readDbSchema, getSchema, listSchemas, readRequirements, generateTestsFromRequirements, requirementsCoverage, getRequirements, listRequirements } from "./tools/simple-tools.js";
import { qaOrchestrate } from "./tools/qaOrchestrator.js";

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
    description: "Assess release risk based on test results and QA policies. When project_name is supplied, also checks requirements coverage — failing or uncovered requirements escalate the risk verdict.",
    inputSchema: z.object({
      project_name: z.string().optional()
        .describe("Optional project name — when supplied, also reads memory/requirements/{project_name}-coverage.json and adds requirements verdict to the output.")
    })
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

// Register scan_framework tool
mcpServer.registerTool(
  "scan_framework",
  {
    description: "Scan an existing C#/Reqnroll/Playwright test project and extract its coding patterns into a reusable blueprint. Reads *Page.cs, *Steps.cs, *DBHelper.cs, *TestContext.cs, *.runsettings and *.csproj files. Saves the blueprint to memory/frameworks/{project_name}-blueprint.json for later use with scaffold_project.",
    inputSchema: z.object({
      project_name: z.string()
        .describe("Identifier for the blueprint, e.g. 'CouponHive'. Used as the blueprint filename."),
      project_path: z.string()
        .describe("Absolute path to the root of the C# test project to scan, e.g. 'C:/repos/Explore/UIAutomationTests'.")
    })
  },
  async (input) => scanFramework(input)
);

// Register scaffold_project tool
mcpServer.registerTool(
  "scaffold_project",
  {
    description: "Generate a new C#/Reqnroll/Playwright test project skeleton from a saved framework blueprint. Produces Page.cs, Steps.cs, DBHelper.cs (optional), .feature, .runsettings and .csproj files — all matching the original project's base classes, constructor injection, naming conventions and async patterns.",
    inputSchema: z.object({
      blueprint_name: z.string()
        .describe("Name of the saved blueprint to use, e.g. 'CouponHive'. Must have been created by scan_framework first."),
      new_project_name: z.string()
        .describe("Name for the new project, e.g. 'BillingPortal'. Used as the class name prefix and file prefix."),
      output_path: z.string()
        .describe("Absolute directory path where generated files will be written, e.g. 'C:/repos/BillingPortal/Tests'."),
      page_url: z.string().optional()
        .describe("Optional URL of the page to document in the generated Page object as a comment reference."),
      db_tables: z.array(z.string()).optional()
        .describe("Optional list of database table names to generate DB helper methods for, e.g. ['BillingAccounts', 'Invoices'].")
    })
  },
  async (input) => scaffoldProject(input)
);

// Register list_blueprints tool
mcpServer.registerTool(
  "list_blueprints",
  {
    description: "List all saved framework blueprints in memory/frameworks/. Shows name, scan date, and source project path for each. Use this to see which blueprints are available before calling scaffold_project.",
    inputSchema: z.object({})
  },
  async (input) => listBlueprints(input)
);

// Register generate_html_report tool
mcpServer.registerTool(
  "generate_html_report",
  {
    description: "Generate a self-contained HTML QA report from the latest test run. Designed for sharing with BAs and managers — business-friendly test names, colour-coded release verdict, pass-rate trend chart, failure table grouped by feature area, screenshot gallery, coverage gaps, and optional requirements traceability matrix. Opens in any browser, printable to PDF.",
    inputSchema: z.object({
      title: z.string().optional()
        .describe("Report title shown in the header. Default: 'CouponHive QA Report'."),
      coverageText: z.string().optional()
        .describe("Plain-text output from the coverage_analysis tool to embed in the Coverage Gaps section."),
      riskText: z.string().optional()
        .describe("Plain-text output from get_release_risk to supplement the verdict."),
      openInBrowser: z.boolean().optional()
        .describe("Open the generated HTML file in the default browser immediately after saving. Default: false."),
      outputPath: z.string().optional()
        .describe("Override the output file path. Default: <reportsDir>/report-<timestamp>.html."),
      project_name: z.string().optional()
        .describe("Project name — when supplied, automatically reads memory/requirements/{project_name}-coverage.json and adds requirements traceability sections to the report."),
      include_requirements: z.boolean().optional()
        .describe("Include requirements traceability sections in the report. Default: true when project_name is supplied.")
    })
  },
  async (input) => generateHtmlReport(input)
);

// Register read_db_schema tool
mcpServer.registerTool(
  "read_db_schema",
  {
    description: "Connect to a SQL Server or PostgreSQL database, read INFORMATION_SCHEMA.COLUMNS for the specified tables, map each column to its C# type, save memory/schemas/{project_name}-schema.json, and optionally generate a fully-typed {ProjectName}DBHelper.cs with model classes and query method stubs. Connection string is read from an environment variable — never passed as a literal.",
    inputSchema: z.object({
      project_name: z.string()
        .describe("Project name for this schema, e.g. 'BillingPortal'. Used as the schema key and C# class prefix."),
      connection_env_key: z.string()
        .describe("Name of the environment variable that holds the DB connection string, e.g. 'DB_CONNECTION_STRING'. SQL Server format: 'Server=host;Database=db;User Id=sa;Password=xxx;'. PostgreSQL format: 'postgresql://user:pass@host:5432/db'."),
      tables: z.array(z.string())
        .describe("Table names to read, e.g. ['Invoices', 'BillingAccounts', 'PaymentHistory']."),
      blueprint_name: z.string().optional()
        .describe("Name of a saved framework blueprint to use for DBHelper generation, e.g. 'CouponHive'. If omitted, schema JSON is saved but no .cs file is generated.")
    })
  },
  async (input) => readDbSchema(input)
);

// Register get_schema tool
mcpServer.registerTool(
  "get_schema",
  {
    description: "Read the saved DB schema JSON for a project from memory/schemas/{project_name}-schema.json. Returns the full structured schema including all tables, columns, C# types, PK/FK flags. Used by scaffold_project internally to generate typed DBHelper files.",
    inputSchema: z.object({
      project_name: z.string()
        .describe("Project name whose schema to retrieve, e.g. 'BillingPortal'.")
    })
  },
  async (input) => getSchema(input)
);

// Register list_schemas tool
mcpServer.registerTool(
  "list_schemas",
  {
    description: "List all saved DB schemas in memory/schemas/. Returns project name, read date, database type (SQL Server / PostgreSQL), and table count for each. Use this to check if a schema exists before scaffold_project or to decide whether to re-read.",
    inputSchema: z.object({})
  },
  async (input) => listSchemas(input)
);

// Register crawl_page tool
mcpServer.registerTool(
  "crawl_page",
  {
    description: "Launch a real Chromium browser, visit a URL, discover all interactive UI elements (buttons, inputs, dropdowns, tables, links, modals), and generate a pre-filled C# Page Object .cs file from a framework blueprint. Saves a structured crawl JSON to memory/crawls/ for use by scaffold_project. Supports optional login via username + env-var password.",
    inputSchema: z.object({
      project_name: z.string()
        .describe("Name for this crawl / the new project, e.g. 'BillingPortal'. Used as the crawl key and C# class prefix."),
      url: z.string()
        .describe("Full URL to crawl, e.g. 'https://app.explorecredit.com/billing'."),
      blueprint_name: z.string().optional()
        .describe("Name of a saved framework blueprint to use for Page Object generation, e.g. 'CouponHive'. If omitted, crawl JSON is saved but no .cs file is generated."),
      login: z.object({
        username:         z.string().describe("Username or email to fill on the login form."),
        password_env_key: z.string().describe("Name of the environment variable that holds the password, e.g. 'TEST_PASSWORD'. The variable must be set in the server's process environment.")
      }).optional()
        .describe("Optional login credentials. When supplied and a password input is found, the tool fills and submits the login form before crawling.")
    })
  },
  async (input) => crawlPage(input)
);

// Register get_crawl tool
mcpServer.registerTool(
  "get_crawl",
  {
    description: "Read the saved crawl JSON for a project from memory/crawls/{project_name}-crawl.json. Returns the full structured crawl including all discovered elements and their selectors. Used by scaffold_project internally to auto-fill locators.",
    inputSchema: z.object({
      project_name: z.string()
        .describe("Project name whose crawl to retrieve, e.g. 'BillingPortal'.")
    })
  },
  async (input) => getCrawl(input)
);

// Register list_crawls tool
mcpServer.registerTool(
  "list_crawls",
  {
    description: "List all saved page crawls in memory/crawls/. Returns project name, crawl date, URL, and total element count for each. Use this to check if a crawl exists before calling scaffold_project or to decide whether to re-crawl.",
    inputSchema: z.object({})
  },
  async (input) => listCrawls(input)
);

// Register read_requirements tool
mcpServer.registerTool(
  "read_requirements",
  {
    description: "Read a requirements document (docx/pdf/xlsx/txt), parse individual requirements, assign REQ-NNN IDs, classify each by type (functional/validation/security/performance/ui/integration) and priority (high/medium/low), and save to memory/requirements/{project_name}-requirements.json.",
    inputSchema: z.object({
      project_name: z.string()
        .describe("Project name for this requirements set, e.g. 'BillingPortal'."),
      file_path: z.string()
        .describe("Absolute path to the requirements document, e.g. 'C:\\\\docs\\\\BillingPortal-Requirements.docx'."),
      file_type: z.enum(['docx', 'pdf', 'xlsx', 'txt'])
        .describe("Document format: docx (Word), pdf, xlsx (Excel), txt (plain text).")
    })
  },
  async (input) => readRequirements(input)
);

// Register generate_tests_from_requirements tool
mcpServer.registerTool(
  "generate_tests_from_requirements",
  {
    description: "ADDS requirement-traced Gherkin scenarios to an existing .feature file and ADDS only new step definitions to an existing steps file. Never overwrites scaffold output. Language (C#/TypeScript) is read from the blueprint automatically. Requires read_requirements and scaffold_project to have been run first.",
    inputSchema: z.object({
      project_name: z.string()
        .describe("Project name matching a saved requirements set, e.g. 'BillingPortal'."),
      blueprint_name: z.string()
        .describe("Blueprint name to determine language and coding patterns, e.g. 'CouponHive' (C#) or 'TSStarter' (TypeScript)."),
      output_path: z.string()
        .describe("Directory where scaffold_project wrote the existing .feature and steps files."),
      requirements_filter: z.object({
        sections:  z.array(z.string()).optional().describe("Only include requirements from these sections. Empty = all."),
        types:     z.array(z.string()).optional().describe("Only include these requirement types. Empty = all."),
        priority:  z.enum(['all', 'high', 'medium']).optional().describe("Filter by priority. Default: all.")
      }).optional()
        .describe("Optional filter to generate tests for a subset of requirements.")
    })
  },
  async (input) => generateTestsFromRequirements(input)
);

// Register requirements_coverage tool
mcpServer.registerTool(
  "requirements_coverage",
  {
    description: "Scan .feature files for @REQ-NNN tags, cross-reference saved requirements, optionally check test results, and save a coverage JSON to memory/requirements/{project_name}-coverage.json. Returns a plain text summary. Language agnostic — reads .feature files only. Run generate_html_report afterwards for the full traceability matrix.",
    inputSchema: z.object({
      project_name: z.string()
        .describe("Project name matching a saved requirements set, e.g. 'BillingPortal'."),
      feature_files_path: z.string()
        .describe("Root directory to scan recursively for *.feature files."),
      include_test_results: z.boolean().optional()
        .describe("Cross-reference latest test results from reports/latest.json. Default: true.")
    })
  },
  async (input) => requirementsCoverage(input)
);

// Register get_requirements tool
mcpServer.registerTool(
  "get_requirements",
  {
    description: "Read the saved requirements JSON for a project from memory/requirements/{project_name}-requirements.json. Returns the full structured document with all requirements, IDs, types, priorities, and test mapping status.",
    inputSchema: z.object({
      project_name: z.string()
        .describe("Project name whose requirements to retrieve, e.g. 'BillingPortal'.")
    })
  },
  async (input) => getRequirements(input)
);

// Register list_requirements tool
mcpServer.registerTool(
  "list_requirements",
  {
    description: "List all saved requirement sets in memory/requirements/. Shows project name, read date, source file, total requirements, and coverage percentage (if requirements_coverage has been run). Use this to check what requirements are available before running generate_tests_from_requirements.",
    inputSchema: z.object({})
  },
  async (input) => listRequirements(input)
);

// Register qa_orchestrate tool
mcpServer.registerTool(
  "qa_orchestrate",
  {
    description: "Intelligent QA agent that autonomously chains tools to analyze quality, detect failures, find coverage gaps, and generate test artifacts — without a fixed sequence. Decides dynamically which tools to call based on accumulated context. Returns a structured OrchestratorReport with risk level, coverage status, decisions taken, and generated artifact context.",
    inputSchema: z.object({
      featureArea: z.string().optional()
        .describe("Feature module to target, e.g. 'CouponHive', 'ChargeOff'. When supplied, all analysis and generation is scoped to this area."),
      pageUrl: z.string().optional()
        .describe("URL to crawl for UI element selectors. When supplied, enables page_object artifact generation."),
      tables: z.string().optional()
        .describe("Comma-separated DB table names to include in schema context, e.g. 'Coupons,AuditLogs'. Omit for all tables."),
      tags: z.string().optional()
        .describe("Comma-separated Gherkin tags for generated scenarios, e.g. 'regression,couponhive-ui'. Defaults to 'regression'."),
      isReleaseCheck: z.boolean().optional()
        .describe("When true, includes get_release_risk assessment in the pipeline. Default: false."),
      maxIterations: z.number().optional()
        .describe("Safety cap on agent loop iterations. Default: 12.")
    })
  },
  async (input) => qaOrchestrate(input) as any
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
  console.error("  Reporting:");
  console.error("  • generate_html_report: Self-contained HTML report for BA/manager sharing");
  console.error("  Framework Memory:");
  console.error("  • scan_framework:       Scan project → extract patterns → save blueprint");
  console.error("  • scaffold_project:     Load blueprint → generate new project skeleton");
  console.error("  • list_blueprints:      List all saved framework blueprints");
  console.error("  DB Schema Integration:");
  console.error("  • read_db_schema:       Connect to DB → read INFORMATION_SCHEMA → save + generate DBHelper.cs");
  console.error("  • get_schema:           Read saved schema JSON for a project");
  console.error("  • list_schemas:         List all saved DB schemas");
  console.error("  Live Page Crawler:");
  console.error("  • crawl_page:           Real browser → discover elements → generate Page.cs");
  console.error("  • get_crawl:            Read saved crawl JSON for a project");
  console.error("  • list_crawls:          List all saved page crawls");
  console.error("  Requirements Traceability:");
  console.error("  • read_requirements:               Read docx/pdf/xlsx/txt → parse REQ-NNN IDs");
  console.error("  • generate_tests_from_requirements: ADD @REQ-XXX scenarios to existing scaffold");
  console.error("  • requirements_coverage:           Scan .feature files → coverage JSON");
  console.error("  • get_requirements:                Read saved requirements JSON");
  console.error("  • list_requirements:               List all saved requirement sets");
  console.error("  Orchestration:");
  console.error("  • qa_orchestrate:      Intelligent agent loop — dynamically chains all tools above");
  console.error("\nServer is ready for MCP connections on stdio...");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
