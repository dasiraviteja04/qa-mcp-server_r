/**
 * generate_tests MCP tool
 *
 * This is the code-generation context assembler.
 *
 * It does NOT generate test code directly — Claude does that.
 * What this tool does is collect REAL data from all three context sources
 * and return it as a single structured prompt that Claude can act on to
 * produce accurate, non-duplicate, compilable test artifacts.
 *
 * Context sources assembled:
 *   1. DB Schema        — exact column names, types, FK relationships
 *   2. Step Inventory   — all existing [Given]/[When]/[Then] patterns
 *   3. Existing features — summary of what scenarios already exist
 *   4. Page source      — interactive elements (if pageUrl is provided)
 *
 * Output format: structured Markdown context block followed by a generation
 * prompt tailored to the requested artifact type.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SchemaService } from '../services/schema.service.js';
import { StepInventoryService } from '../services/stepinventory.service.js';
import { PageCrawlerService } from '../services/pagecrawler.service.js';
import { getEnvironmentConfig } from '../config/environments.js';
import type { ToolOutput } from '../types/mcp.types.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface GenerateTestsInput {
  /**
   * What to generate.
   *   feature       → Gherkin .feature file + scenario stubs
   *   steps         → C# Reqnroll step definition class
   *   page_object   → C# Playwright page object class
   *   db_methods    → C# DBMethods extension (EF Core queries)
   *   full_suite    → All of the above for a single feature area
   */
  artifact: 'feature' | 'steps' | 'page_object' | 'db_methods' | 'full_suite';

  /**
   * Feature area / module name, e.g. "ChargeOff", "Payoff", "CustomerSearch"
   */
  featureArea: string;

  /**
   * URL of the page to crawl for interactive elements (optional).
   * Required for page_object and full_suite artifacts.
   */
  pageUrl?: string;

  /**
   * Comma-separated list of DB tables relevant to this feature (optional).
   * When omitted, all tables are returned (may be large).
   */
  tables?: string;

  /**
   * Gherkin tags to apply to generated scenarios, e.g. "regression,chargeoff"
   */
  tags?: string;
}

// ---------------------------------------------------------------------------
// generate_tests implementation
// ---------------------------------------------------------------------------

export async function generateTests(input: GenerateTestsInput): Promise<ToolOutput> {
  const config = getEnvironmentConfig();

  const tableFilter = input.tables
    ? input.tables.split(',').map(t => t.trim()).filter(Boolean)
    : undefined;

  const tags = input.tags
    ? input.tags.split(',').map(t => t.trim()).filter(Boolean)
    : ['regression'];

  // Run all context fetches in parallel
  const [schemaResult, inventoryResult, existingFeatures, pageResult] = await Promise.allSettled([
    new SchemaService().readSchema(tableFilter),
    new StepInventoryService().readInventory(),
    loadExistingFeatureSummary(config.featuresDir, input.featureArea),
    input.pageUrl
      ? new PageCrawlerService().crawlPage(input.pageUrl)
      : Promise.resolve(null)
  ]);

  const schema     = schemaResult.status     === 'fulfilled' ? schemaResult.value     : null;
  const inventory  = inventoryResult.status  === 'fulfilled' ? inventoryResult.value  : null;
  const features   = existingFeatures.status === 'fulfilled' ? existingFeatures.value : null;
  const page       = pageResult.status       === 'fulfilled' ? pageResult.value       : null;

  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push(`# Code Generation Context — ${input.featureArea}`);
  lines.push(`**Artifact:** ${input.artifact}  |  **Tags:** ${tags.join(', ')}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');

  // ── 1. DB Schema ────────────────────────────────────────────────────────
  lines.push('## 1. Database Schema (live from SQL Server)');
  lines.push('');
  if (!schema || schema.tables.length === 0) {
    lines.push('_Schema unavailable — set DB_SERVER / DB_NAME / DB_USER / DB_PASSWORD env vars_');
  } else {
    for (const table of schema.tables) {
      lines.push(`### ${table.table}`);
      const cols = table.columns.map(c => {
        const flags = [
          c.isPrimaryKey ? 'PK' : '',
          c.isForeignKey ? `FK→${c.referencesTable}` : '',
          c.nullable ? '' : 'NOT NULL'
        ].filter(Boolean).join(' ');
        return `  - **${c.name}** \`${c.dataType}\` ${flags}`.trimEnd();
      });
      lines.push(...cols);
      lines.push('');
    }
  }

  // ── 2. Existing Step Bindings ────────────────────────────────────────────
  lines.push('## 2. Existing Step Bindings (reuse these — do NOT duplicate)');
  lines.push('');
  if (!inventory || inventory.totalBindings === 0) {
    lines.push('_No existing step bindings found_');
  } else {
    // Only show bindings relevant to this feature area (loose name match)
    const relevant = inventory.bindings.filter(b =>
      b.pattern.toLowerCase().includes(input.featureArea.toLowerCase()) ||
      b.className.toLowerCase().includes(input.featureArea.toLowerCase())
    );
    const all = relevant.length > 0 ? relevant : inventory.bindings.slice(0, 40);
    const note = relevant.length > 0
      ? `_${relevant.length} bindings matching "${input.featureArea}"_`
      : `_Showing first 40 of ${inventory.totalBindings} total bindings_`;
    lines.push(note);
    lines.push('');
    for (const b of all) {
      lines.push(`- **[${b.type}]** \`${b.pattern}\` → \`${b.className}.${b.methodName}\``);
    }
  }
  lines.push('');

  // ── 3. Existing Feature Scenarios ────────────────────────────────────────
  lines.push('## 3. Existing Feature Scenarios (do NOT duplicate these scenarios)');
  lines.push('');
  if (!features || features.length === 0) {
    lines.push('_No existing feature files found for this area_');
  } else {
    for (const f of features) {
      lines.push(`**${f.file}**`);
      for (const s of f.scenarios) {
        lines.push(`  - ${s}`);
      }
    }
  }
  lines.push('');

  // ── 4. Page Elements (if crawled) ────────────────────────────────────────
  if (page) {
    lines.push(`## 4. Page Elements — ${page.url}`);
    lines.push(`_Title: ${page.title}  |  Auth: ${page.authenticated ? 'yes' : 'no'}_`);
    lines.push('');
    for (const el of page.elements) {
      const attrs = [
        el.label       ? `label="${el.label}"`             : '',
        el.placeholder ? `placeholder="${el.placeholder}"` : '',
        el.ariaLabel   ? `aria-label="${el.ariaLabel}"`    : '',
        el.dataTestId  ? `data-testid="${el.dataTestId}"`  : '',
        el.text        ? `text="${el.text}"`               : ''
      ].filter(Boolean).join(', ');
      lines.push(`- **${el.tag}${el.type ? `[${el.type}]` : ''}** \`${el.selector}\` ${attrs}`);
    }
    lines.push('');
  }

  // ── 5. Generation Instructions ───────────────────────────────────────────
  lines.push('---');
  lines.push('## Generation Instructions');
  lines.push('');
  lines.push(`Using ONLY the context above, generate the following artifact for the **${input.featureArea}** feature area:`);
  lines.push('');

  switch (input.artifact) {
    case 'feature':
      lines.push('### Generate: Gherkin Feature File');
      lines.push('');
      lines.push('Requirements:');
      lines.push(`- File path: Features/RegressionTests/${input.featureArea}/${input.featureArea}Tests.feature`);
      lines.push(`- Tags: @${tags.join(' @')} on each Scenario`);
      lines.push('- Background: include login + post loan steps if the feature area requires a loan');
      lines.push('- Use ONLY step text that matches existing bindings from Section 2 above');
      lines.push('- Do NOT duplicate scenarios listed in Section 3 above');
      lines.push('- Write 3-5 meaningful scenarios covering happy path and key edge cases');
      lines.push('- Use Scenario Outline + Examples table for data-driven tests');
      break;

    case 'steps':
      lines.push('### Generate: C# Reqnroll Step Definition Class');
      lines.push('');
      lines.push('Requirements:');
      lines.push(`- Namespace: UIAutomationTests.StepDefinitions.${input.featureArea}`);
      lines.push(`- Class name: ${input.featureArea}Steps`);
      lines.push('- Constructor inject: IPage (from ScenarioContext["page"]), SessionContext, DBMethods');
      lines.push('- Do NOT redefine [Given]/[When]/[Then] patterns from Section 2 — call the existing class instead');
      lines.push('- Use async/await throughout');
      lines.push('- Property access must use exact column names from Section 1 (DB Schema)');
      break;

    case 'page_object':
      lines.push('### Generate: C# Playwright Page Object Class');
      lines.push('');
      lines.push('Requirements:');
      lines.push(`- Namespace: UIAutomationTests.Pages.${input.featureArea}`);
      lines.push(`- Class name: ${input.featureArea}Page`);
      lines.push('- Constructor: public ${input.featureArea}Page(IPage page)');
      lines.push('- One property per interactive element from Section 4 (Page Elements)');
      lines.push('- Use GetByLabel() for form fields, GetByRole() for buttons, Locator() for data-testid');
      lines.push('- One async method per user action (click, fill, select, verify)');
      break;

    case 'db_methods':
      lines.push('### Generate: C# DBMethods Extension');
      lines.push('');
      lines.push('Requirements:');
      lines.push('- Add methods to the existing partial class DBMethods in Support/DBMethods.cs');
      lines.push('- Use Entity Framework Core (async, no raw SQL)');
      lines.push(`- Only query tables relevant to ${input.featureArea} from Section 1`);
      lines.push('- Navigation paths MUST match FK relationships in Section 1 (not assumed)');
      lines.push('- Populate the exact SessionContext properties defined in Support/SessionContext.cs');
      lines.push('- Use exact property names from Section 1 — never guess column names');
      break;

    case 'full_suite':
      lines.push('### Generate: Full Test Suite (Feature + Steps + Page Object + DBMethods)');
      lines.push('');
      lines.push('Generate all four artifacts above in order:');
      lines.push('1. Feature file (Gherkin)');
      lines.push('2. Step definition class (C#)');
      lines.push('3. Page object class (C#) — only if Page Elements (Section 4) are available');
      lines.push('4. DBMethods extension (C#) — only if DB Schema (Section 1) is available');
      lines.push('');
      lines.push('Apply all requirements listed for each individual artifact above.');
      break;
  }

  lines.push('');
  lines.push('**Important rules:**');
  lines.push('- Column names and navigation paths must come from Section 1 only');
  lines.push('- Step patterns must either reuse Section 2 exactly or introduce genuinely new patterns');
  lines.push('- Scenarios must not duplicate Section 3');
  lines.push('- All code must compile against .NET 8 + Reqnroll + NUnit + Microsoft.Playwright');

  return {
    content: [{ type: 'text', text: lines.join('\n') }]
  };
}

// ---------------------------------------------------------------------------
// Helper — summarize existing .feature files for the requested area
// ---------------------------------------------------------------------------

interface FeatureSummary {
  file: string;
  scenarios: string[];
}

async function loadExistingFeatureSummary(
  featuresDir: string,
  featureArea: string
): Promise<FeatureSummary[]> {
  if (!fs.existsSync(featuresDir)) return [];

  const results: FeatureSummary[] = [];
  collectFeatureFiles(featuresDir, featureArea.toLowerCase(), results);
  return results;
}

function collectFeatureFiles(
  dir: string,
  areaLower: string,
  results: FeatureSummary[]
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFeatureFiles(fullPath, areaLower, results);
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.feature') &&
      (entry.name.toLowerCase().includes(areaLower) ||
        fullPath.toLowerCase().includes(areaLower))
    ) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const scenarios = extractScenarioNames(content);
        results.push({
          file: entry.name,
          scenarios
        });
      } catch {
        // skip unreadable files
      }
    }
  }
}

function extractScenarioNames(content: string): string[] {
  const scenarios: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('Scenario:') ||
      trimmed.startsWith('Scenario Outline:')
    ) {
      scenarios.push(trimmed);
    }
  }
  return scenarios;
}
