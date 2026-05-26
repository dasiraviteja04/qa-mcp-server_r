/**
 * MCP Tool: scaffold_project
 *
 * Loads a saved framework blueprint and generates a complete test project
 * skeleton that exactly matches the original project's coding patterns:
 * same base classes, same constructor injection, same naming style.
 *
 * Supports both C# (Reqnroll/NUnit) and TypeScript (Playwright/Cucumber) projects.
 * Language is determined by the blueprint's `language` field (defaults to 'csharp').
 *
 * Inputs:
 *   blueprint_name    — name of saved blueprint (e.g. "CouponHive")
 *   new_project_name  — name for the new project (e.g. "BillingPortal")
 *   output_path       — directory to write generated files into
 *   page_url          — (optional) crawl page for selectors as comments
 *   db_tables         — (optional) generate DBHelper with these table names (C# only)
 */

import * as fs   from 'fs';
import * as path from 'path';
import { FrameworkMemoryService }      from '../services/frameworkMemory.service.js';
import { LiveCrawlerService }          from '../services/liveCrawler.service.js';
import { DbSchemaService }             from '../services/dbSchema.service.js';
import { TypeScriptGeneratorService }  from '../services/typescriptGenerator.service.js';
import type { ToolOutput }             from '../types/mcp.types.js';
import type { FrameworkBlueprint, ScaffoldResult } from '../types/framework.types.js';

interface ScaffoldInput {
  blueprint_name:   string;
  new_project_name: string;
  output_path:      string;
  page_url?:        string;
  db_tables?:       string[];
}

// ---------------------------------------------------------------------------
// Template generators — each produces file content matching the blueprint
// ---------------------------------------------------------------------------

function genPageObject(bp: FrameworkBlueprint, name: string, pageUrl?: string): string {
  const po        = bp.pageObject;
  const ns        = po.namespace || `${name}.Tests.Pages`;
  const baseClass = po.baseClass ? ` : ${po.baseClass}` : '';
  const ctorArgs  = po.constructorParams.map(t => `${t} ${paramName(t)}`).join(', ');
  const ctorBody  = po.constructorParams
    .map(t => `        _${paramName(t)} = ${paramName(t)};`)
    .join('\n');
  const fields    = po.constructorParams
    .map(t => `    ${po.locatorStyle.includes('readonly') ? 'private readonly' : 'private'} ${t} _${paramName(t)};`)
    .join('\n');

  const urlComment = pageUrl
    ? `    // Page URL: ${pageUrl}\n    // TODO: Add locators discovered from the page below\n`
    : '';

  return `using Microsoft.Playwright;
using Reqnroll;

namespace ${ns}
{
    /// <summary>
    /// Page object for ${name}.
    /// Generated from blueprint: ${bp.projectName} (${bp.scannedAt.split('T')[0]})
    /// </summary>
    public class ${name}Page${baseClass}
    {
${fields}

        // ── Locators ────────────────────────────────────────────────────────
${urlComment}        // TODO: Define your locators here, e.g:
        // private ILocator SaveButton => _page.Locator("button[type='submit']");

        // ── Constructor ─────────────────────────────────────────────────────
        public ${name}Page(${ctorArgs})
        {
${ctorBody}
        }

        // ── Actions ─────────────────────────────────────────────────────────

        /// <summary>Navigate to the ${name} page.</summary>
        public ${po.asyncPattern.startsWith('async') ? 'async Task' : 'Task'} NavigateAsync()
        {
            // TODO: Replace with actual page URL
            await _page.GotoAsync("https://your-app.com/${name.toLowerCase()}");
        }

        /// <summary>Example action — replace with real implementation.</summary>
        public ${po.asyncPattern.startsWith('async') ? 'async Task' : 'Task'} ExampleActionAsync()
        {
            // TODO: Implement action
            throw new NotImplementedException();
        }
    }
}
`;
}

function genStepDefinition(bp: FrameworkBlueprint, name: string): string {
  const sd        = bp.stepDefinition;
  const ns        = sd.namespace || `${name}.Tests.StepDefinitions`;
  const baseClass = sd.baseClass ? ` : ${sd.baseClass}` : '';
  const ctorArgs  = sd.injection.map(t => `${t} ${paramName(t)}`).join(', ');
  const fields    = sd.injection
    .map(t => `    private readonly ${t} _${paramName(t)};`)
    .join('\n');
  const ctorBody  = sd.injection
    .map(t => `        _${paramName(t)} = ${paramName(t)};`)
    .join('\n');

  const pageName  = `${name}Page`;
  const pageField = `    private readonly ${pageName} _page${name};`;
  const pageInit  = `        _page${name} = new ${pageName}(${sd.injection.map(t => `_${paramName(t)}`).join(', ')});`;

  return `using Reqnroll;
using ${sd.namespace || `${name}.Tests.Pages`};

namespace ${ns}
{
    /// <summary>
    /// Step definitions for ${name}.
    /// Generated from blueprint: ${bp.projectName} (${bp.scannedAt.split('T')[0]})
    /// </summary>
    [Binding]
    public class ${name}Steps${baseClass}
    {
${fields}
${pageField}

        public ${name}Steps(${ctorArgs})
        {
${ctorBody}
${pageInit}
        }

        // ── Given ────────────────────────────────────────────────────────────

        [Given(@"I navigate to the ${name} page")]
        public async Task GivenINavigateToThe${name}Page()
        {
            await _page${name}.NavigateAsync();
        }

        // ── When ─────────────────────────────────────────────────────────────

        [When(@"I perform an action on ${name}")]
        public async Task WhenIPerformAnActionOn${name}()
        {
            // TODO: Implement When step
            await _page${name}.ExampleActionAsync();
        }

        // ── Then ─────────────────────────────────────────────────────────────

        [Then(@"the ${name} page should show the expected result")]
        public async Task ThenThe${name}PageShouldShowTheExpectedResult()
        {
            // TODO: Implement Then assertion
            throw new NotImplementedException();
        }
    }
}
`;
}

function genDbHelper(bp: FrameworkBlueprint, name: string, tables: string[]): string {
  const db  = bp.dbHelper;
  const ns  = db.namespace  || `${name}.Tests.Support`;
  const orm = db.orm;

  const usings = orm.includes('EF Core')
    ? 'using Microsoft.EntityFrameworkCore;'
    : 'using Microsoft.Data.SqlClient;';

  const tableQueries = tables.map(table => {
    const methodName = `Get${table.replace(/s$/, '')}ByIdAsync`;
    if (orm.includes('EF Core')) {
      return `
        /// <summary>Get a ${table} record by ID.</summary>
        public async Task<dynamic?> ${methodName}(int id)
        {
            // TODO: Replace dynamic with your actual entity type
            await using var context = new ${name}DbContext(${db.connectionSource}.${db.connectionMethod}());
            return await context.${table}.FindAsync(id);
        }`;
    }
    return `
        /// <summary>Get a ${table} record by ID.</summary>
        public async Task<int> ${methodName}(int id)
        {
            await using var conn = new SqlConnection(${db.connectionSource}.${db.connectionMethod}());
            await conn.OpenAsync();
            await using var cmd = new SqlCommand(
                $"SELECT COUNT(*) FROM ${table} WHERE Id = @Id", conn);
            cmd.Parameters.AddWithValue("@Id", id);
            return (int)(await cmd.ExecuteScalarAsync() ?? 0);
        }`;
  }).join('\n');

  return `${usings}
using ${ns.split('.').slice(0, -1).join('.')}.Config;

namespace ${ns}
{
    /// <summary>
    /// Database helper for ${name}.
    /// Generated from blueprint: ${bp.projectName} (${bp.scannedAt.split('T')[0]})
    /// Tables: ${tables.join(', ')}
    /// </summary>
    public class ${name}DBHelper
    {
        // ORM pattern: ${orm}
        // Connection: ${db.connectionSource}.${db.connectionMethod}()
${tableQueries}
    }
}
`;
}

function genFeatureFile(name: string, sd: FrameworkBlueprint['stepDefinition']): string {
  const exStep = sd.exampleSteps[0] ?? `I navigate to the ${name} page`;
  return `Feature: ${name}
    ${name} feature — generated from framework blueprint

    @regression @${name.toLowerCase()}
    Scenario: Example ${name} scenario
        Given I navigate to the ${name} page
        When I perform an action on ${name}
        Then the ${name} page should show the expected result

    # TODO: Add real business scenarios below
    # Use naming: Given / When / Then matching step definitions in ${name}Steps.cs
`;
}

function genRunsettings(bp: FrameworkBlueprint, name: string): string {
  const ps = bp.projectSetup;
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated from blueprint: ${bp.projectName} | Pattern: ${ps.runsettingsPattern} -->
<RunSettings>
  <TestRunParameters>
    <!-- Environment configuration for ${name} -->
    <Parameter name="Environment"   value="development" />
    <Parameter name="BaseUrl"       value="https://your-app.com" />
    <Parameter name="Headless"      value="true" />
    <Parameter name="SlowMo"        value="0" />
    <Parameter name="Timeout"       value="30000" />
  </TestRunParameters>

  <RunConfiguration>
    <MaxCpuCount>2</MaxCpuCount>
    <ResultsDirectory>testresults</ResultsDirectory>
  </RunConfiguration>

  <NUnit>
    <NumberOfTestWorkers>2</NumberOfTestWorkers>
  </NUnit>
</RunSettings>
`;
}

function genCsproj(bp: FrameworkBlueprint, name: string): string {
  const ps = bp.projectSetup;
  const ns = ps.rootNamespace ? `${ps.rootNamespace}.${name}` : `${name}.Tests`;

  // Keep the same key packages as the original
  const keyPackages = ps.packages
    .filter(p =>
      p.toLowerCase().includes('reqnroll') ||
      p.toLowerCase().includes('nunit') ||
      p.toLowerCase().includes('playwright') ||
      p.toLowerCase().includes('shouldly') ||
      p.toLowerCase().includes('microsoft.data')
    )
    .map(p => `    <PackageReference Include="${p}" Version="*" />`)
    .join('\n');

  return `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <!-- Generated from blueprint: ${bp.projectName} -->
    <TargetFramework>${ps.targetFramework}</TargetFramework>
    <RootNamespace>${ns}</RootNamespace>
    <IsPackable>false</IsPackable>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <!-- Inherited from ${bp.projectName} blueprint -->
${keyPackages || `    <PackageReference Include="Reqnroll.NUnit" Version="*" />
    <PackageReference Include="Microsoft.Playwright" Version="*" />
    <PackageReference Include="NUnit" Version="*" />
    <PackageReference Include="Shouldly" Version="*" />`}
  </ItemGroup>

  <ItemGroup>
    <Content Include="*.runsettings">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </Content>
  </ItemGroup>

</Project>
`;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function paramName(typeName: string): string {
  const map: Record<string, string> = {
    IPage:           'page',
    ScenarioContext: 'scenarioContext',
    IObjectContainer: 'objectContainer',
    ITestOutputHelper: 'output',
  };
  return map[typeName] ?? typeName.charAt(0).toLowerCase() + typeName.slice(1);
}

// ---------------------------------------------------------------------------
// Main scaffold function
// ---------------------------------------------------------------------------

async function scaffold(input: ScaffoldInput): Promise<ScaffoldResult & { usedCrawl: boolean; usedSchema: boolean }> {
  const service   = new FrameworkMemoryService();
  const blueprint = service.loadBlueprint(input.blueprint_name);
  const name      = input.new_project_name.trim();
  const outDir    = input.output_path.trim();
  const tables    = input.db_tables ?? [];

  fs.mkdirSync(outDir, { recursive: true });

  const filesGenerated: string[] = [];
  const warnings: string[]       = [];

  const write = async (filename: string, content: string) => {
    const p = path.join(outDir, filename);
    await fs.promises.writeFile(p, content, 'utf-8');
    filesGenerated.push(p);
  };

  // 1. Page object — prefer real selectors from a saved crawl
  const crawlSvc  = new LiveCrawlerService();
  let usedCrawl   = false;
  if (crawlSvc.hasCrawl(name)) {
    try {
      const crawl   = crawlSvc.loadCrawl(name);
      const content = crawlSvc.buildPageObjectCs(crawl, blueprint);
      await write(`${name}Page.cs`, content);
      usedCrawl = true;
    } catch {
      // Crawl load failed — fall through to placeholder template
    }
  }
  if (!usedCrawl) {
    await write(`${name}Page.cs`, genPageObject(blueprint, name, input.page_url));
  }

  // 2. Step definitions
  await write(`${name}Steps.cs`, genStepDefinition(blueprint, name));

  // 3. DB helper — prefer real columns from a saved schema
  const schemaSvc  = new DbSchemaService();
  let   usedSchema = false;
  if (schemaSvc.hasSchema(name)) {
    try {
      const schema   = schemaSvc.loadSchema(name);
      const { content } = schemaSvc.buildDbHelperCs(schema, blueprint, warnings);
      await write(`${name}DBHelper.cs`, content);
      usedSchema = true;
    } catch {
      // Schema load failed — fall through
    }
  }
  if (!usedSchema) {
    if (tables.length > 0) {
      await write(`${name}DBHelper.cs`, genDbHelper(blueprint, name, tables));
    } else {
      warnings.push(
        'DBHelper not generated — no db_tables provided and no saved schema found. ' +
        'Run read_db_schema first, or pass db_tables to scaffold_project.'
      );
    }
  }

  // 4. Feature file
  await write(`${name}.feature`, genFeatureFile(name, blueprint.stepDefinition));

  // 5. Runsettings
  await write(`${name}.runsettings`, genRunsettings(blueprint, name));

  // 6. .csproj
  await write(`${name}Tests.csproj`, genCsproj(blueprint, name));

  return { filesGenerated, warnings, usedCrawl, usedSchema };
}

// ---------------------------------------------------------------------------
// TypeScript scaffold (additive — does NOT touch the C# scaffold() above)
// ---------------------------------------------------------------------------

async function scaffoldTypeScript(
  input:     ScaffoldInput,
  blueprint: FrameworkBlueprint,
): Promise<{ filesGenerated: string[]; warnings: string[]; usedSchema: boolean }> {
  const name   = input.new_project_name.trim();
  const outDir = input.output_path.trim();

  const schemaSvc  = new DbSchemaService();
  let   usedSchema = false;
  let   dbTables   = undefined;

  if (schemaSvc.hasSchema(name)) {
    try {
      const schema = schemaSvc.loadSchema(name);
      dbTables     = schema.tables;
      usedSchema   = true;
    } catch { /* fall through */ }
  }

  const generator = new TypeScriptGeneratorService();
  const result    = await generator.generateProject(name, outDir, blueprint, {
    ...(input.page_url ? { pageUrl: input.page_url } : {}),
    ...(dbTables       ? { dbTables }                : {}),
  });

  return { ...result, usedSchema };
}

// ---------------------------------------------------------------------------
// MCP Tool export
// ---------------------------------------------------------------------------

export async function scaffoldProject(input: ScaffoldInput): Promise<ToolOutput> {
  try {
    if (!input.blueprint_name?.trim()) {
      return { content: [{ type: 'text', text: '❌ blueprint_name is required.' }], isError: true };
    }
    if (!input.new_project_name?.trim()) {
      return { content: [{ type: 'text', text: '❌ new_project_name is required.' }], isError: true };
    }
    if (!input.output_path?.trim()) {
      return { content: [{ type: 'text', text: '❌ output_path is required.' }], isError: true };
    }

    const memSvc    = new FrameworkMemoryService();
    const blueprint = memSvc.loadBlueprint(input.blueprint_name.trim());
    const name      = input.new_project_name.trim();
    const language  = blueprint.language ?? 'csharp';

    // ── Route by language ────────────────────────────────────────────────────
    if (language === 'typescript') {
      const { filesGenerated, warnings, usedSchema } = await scaffoldTypeScript(input, blueprint);

      const lines: string[] = [
        `✅ TypeScript project "${name}" scaffolded from blueprint "${input.blueprint_name}"`,
        ``,
        `📁 Output directory: ${input.output_path}`,
        usedSchema
          ? `🗄️  DB helper : typed interfaces from memory/schemas/${name}-schema.json`
          : `📝 DB helper : placeholder template (run read_db_schema to get real columns)`,
        ``,
        `📄 Files generated (${filesGenerated.length}):`,
        ...filesGenerated.map(f => `   • ${path.relative(input.output_path, f)}`),
        ``,
      ];

      if (warnings.length > 0) {
        lines.push(`⚠️  Warnings:`);
        warnings.forEach(w => lines.push(`   • ${w}`));
        lines.push('');
      }

      const isCucumber = blueprint.typescript?.testFramework === 'cucumber' ||
                         blueprint.stepDefinition.bindingStyle.includes('@cucumber/cucumber');

      lines.push(
        `🚀 Next steps:`,
        `   1. cd ${input.output_path}`,
        `   2. cp .env.template .env  →  fill in BASE_URL and DB_CONNECTION_STRING`,
        `   3. npm install`,
        `   4. npx playwright install`,
        `   5. Review locators in tests/${name}.page.ts`,
        isCucumber
          ? `   6. Write scenarios in tests/${name}.feature`
          : `   6. Write tests in tests/${name}.steps.ts`,
        ``,
        `💡 All files follow the "${input.blueprint_name}" TypeScript pattern:`,
        `   Same locator style, same async/await, same export conventions.`,
      );

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── C# path — unchanged from original ───────────────────────────────────
    const { usedCrawl, usedSchema, ...result } = await scaffold(input);

    const lines: string[] = [
      `✅ Project "${name}" scaffolded from blueprint "${input.blueprint_name}"`,
      ``,
      `📁 Output directory: ${input.output_path}`,
      usedCrawl
        ? `🌐 Page object : real selectors from memory/crawls/${name}-crawl.json`
        : `📝 Page object : placeholder template (run crawl_page to get real selectors)`,
      usedSchema
        ? `🗄️  DBHelper     : real typed columns from memory/schemas/${name}-schema.json`
        : `📝 DBHelper     : placeholder template (run read_db_schema to get real columns)`,
      ``,
      `📄 Files generated (${result.filesGenerated.length}):`,
      ...result.filesGenerated.map(f => `   • ${path.basename(f)}`),
      ``,
    ];

    if (result.warnings.length > 0) {
      lines.push(`⚠️  Warnings:`);
      result.warnings.forEach(w => lines.push(`   • ${w}`));
      lines.push('');
    }

    lines.push(
      `🚀 Next steps:`,
      `   1. Open ${name}Tests.csproj in Visual Studio`,
      `   2. Review and fill in locators in ${name}Page.cs`,
      `   3. Write real business scenarios in ${name}.feature`,
      `   4. Implement step logic in ${name}Steps.cs`,
      input.db_tables
        ? `   5. Adjust DB queries in ${name}DBHelper.cs for your schema`
        : `   5. Add db_tables to scaffold_project to generate ${name}DBHelper.cs`,
      ``,
      `💡 All files follow the "${input.blueprint_name}" pattern:`,
      `   Same base classes, same constructor injection, same naming style.`,
    );

    return { content: [{ type: 'text', text: lines.join('\n') }] };

  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `❌ scaffold_project failed: ${error.message}` }],
      isError: true
    };
  }
}
