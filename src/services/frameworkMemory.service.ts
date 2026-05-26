/**
 * FrameworkMemoryService
 *
 * Scans an existing C#/Reqnroll/Playwright or TypeScript/Playwright test
 * project, extracts coding patterns from real source files, saves a blueprint
 * JSON, and can later load that blueprint for scaffolding new projects.
 *
 * Supported file patterns (C#):
 *   *Page.cs        → page object pattern
 *   *Steps.cs       → step definition pattern
 *   *DBHelper.cs    → DB helper pattern
 *   *TestContext.cs → test context pattern
 *   *.runsettings   → project config pattern
 *   *.csproj        → project structure
 *
 * Supported file patterns (TypeScript):
 *   *.page.ts       → page object pattern
 *   *.steps.ts      → step definition pattern
 *   *.db.ts         → DB helper pattern
 *   playwright.config.ts → config pattern
 *   package.json    → package manager + dependencies
 */

import * as fs   from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type {
  FrameworkBlueprint,
  BlueprintSummary,
  PageObjectPattern,
  StepDefinitionPattern,
  DbHelperPattern,
  TestContextPattern,
  ProjectSetupPattern,
  TypeScriptPatterns,
  ProjectLanguage,
} from '../types/framework.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk a directory recursively and return all files matching a predicate. */
async function walk(dir: string, predicate: (f: string) => boolean): Promise<string[]> {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    // Skip build output and hidden dirs
    if (['bin', 'obj', 'node_modules', '.git', '.vs'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walk(full, predicate));
    } else if (entry.isFile() && predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

function readFile(p: string): string {
  try { return fs.readFileSync(p, 'utf-8'); }
  catch { return ''; }
}

/** Extract the first regex group match from content. */
function extract(content: string, regex: RegExp): string | null {
  const m = content.match(regex);
  return m ? (m[1] ?? null) : null;
}

/** Extract all non-null matches of group 1 from a global regex. */
function extractAll(content: string, regex: RegExp): string[] {
  const results: string[] = [];
  let m: RegExpExecArray | null;
  const r = new RegExp(regex.source, 'g');
  while ((m = r.exec(content)) !== null) {
    if (m[1]) results.push(m[1]);
  }
  return results;
}

// ---------------------------------------------------------------------------
// File-type extractors
// ---------------------------------------------------------------------------

function extractPageObjectPattern(files: string[]): PageObjectPattern {
  // Prefer the first file that is clearly a page (not base class)
  const sorted = files.sort((a, b) => a.length - b.length);
  const first  = sorted[0] ?? '';
  const content = first ? readFile(first) : '';

  const baseClass        = extract(content, /class\s+\w+\s*:\s*(\w+)/);
  const namespace        = extract(content, /namespace\s+([\w.]+)/) ?? '';
  const constructorMatch = content.match(/public\s+\w+Page\s*\(([^)]+)\)/);
  const constructorParams = constructorMatch
    ? constructorMatch[1]!.split(',').map(p => p.trim().split(/\s+/)[0] ?? '').filter(Boolean)
    : [];

  const hasReadonly = content.includes('private readonly ILocator') || content.includes('private readonly');
  const locatorStyle = hasReadonly
    ? 'private readonly ILocator properties'
    : content.includes('private ILocator')
      ? 'private ILocator properties'
      : 'ILocator properties';

  const asyncPattern = content.includes('async Task')
    ? 'async Task methods'
    : content.includes('Task<')
      ? 'Task<T> return methods'
      : 'synchronous methods';

  // Collect public async method names across all page files
  const allContent = files.map(readFile).join('\n');
  const exampleMethods = extractAll(allContent, /public\s+async\s+Task\s+(\w+)\s*\(/)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 5);

  return { baseClass, constructorParams, locatorStyle, asyncPattern, exampleMethods, namespace };
}

function extractStepDefinitionPattern(files: string[]): StepDefinitionPattern {
  const allContent = files.map(readFile).join('\n');
  const first      = files[0] ?? '';
  const content    = first ? readFile(first) : '';

  const baseClass  = extract(content, /class\s+\w+Steps\s*:\s*(\w+)/);
  const namespace  = extract(content, /namespace\s+([\w.]+)/) ?? '';

  const constructorMatch = content.match(/public\s+\w+Steps\s*\(([^)]+)\)/);
  const injection = constructorMatch
    ? constructorMatch[1]!.split(',').map(p => p.trim().split(/\s+/)[0] ?? '').filter(Boolean)
    : [];

  const hasGiven = allContent.includes('[Given(');
  const hasWhen  = allContent.includes('[When(');
  const hasThen  = allContent.includes('[Then(');
  const bindingStyle = [
    hasGiven ? '[Given]' : '',
    hasWhen  ? '[When]'  : '',
    hasThen  ? '[Then]'  : '',
  ].filter(Boolean).join('/') + ' attributes';

  // Detect naming convention from method names
  const methods = extractAll(allContent, /public\s+async\s+Task\s+(When\w+|Given\w+|Then\w+|And\w+)\s*\(/)
    .filter((v, i, a) => a.indexOf(v) === i);
  const hasWhenI  = methods.some(m => m.startsWith('WhenI'));
  const hasThenThe = methods.some(m => m.startsWith('ThenThe'));
  const namingConvention = hasWhenI && hasThenThe
    ? 'WhenI... / ThenThe... / GivenI...'
    : methods.length > 0
      ? `${methods[0]} style`
      : 'Standard Reqnroll naming';

  // Extract example step texts from attributes
  const exampleSteps = extractAll(allContent, /\[(?:Given|When|Then)\(\s*@?"([^"]+)"\s*\)\]/)
    .slice(0, 5);

  return { baseClass, injection, bindingStyle, namingConvention, exampleSteps, namespace };
}

function extractDbHelperPattern(files: string[]): DbHelperPattern {
  const allContent = files.map(readFile).join('\n');
  const first      = files[0] ?? '';
  const content    = first ? readFile(first) : '';
  const namespace  = extract(content, /namespace\s+([\w.]+)/) ?? '';

  const orm = allContent.includes('DbContext')
    ? 'EF Core DbContext'
    : allContent.includes('SqlConnection')
      ? 'raw SqlConnection'
      : allContent.includes('SqlCommand')
        ? 'raw SqlCommand'
        : 'unknown ORM';

  // Find the class that provides the connection string
  const connSource = extract(allContent, /(\w+Helper|LibraryHelper|ConnectionHelper)\.(Get\w+ConnectionString|GetConnection)/);
  const connectionSource = connSource ?? extract(allContent, /(\w+Helper)\s*\.\s*Get\w+/) ?? 'AzureDevOpsLibraryHelper';
  const connectionMethod = extract(allContent, /\.(Get\w+ConnectionString)\s*\(/) ?? 'GetConnectionString';

  const exampleMethods = extractAll(allContent, /public\s+(?:async\s+Task(?:<\w+>)?\s+|static\s+\w+\s+)(\w+)\s*\(/)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 5);

  return { orm, connectionSource, connectionMethod, exampleMethods, namespace };
}

function extractTestContextPattern(files: string[]): TestContextPattern {
  const allContent = files.map(readFile).join('\n');

  // Find fields: e.g. private readonly IPage _page;
  const fields = extractAll(allContent, /private\s+(?:readonly\s+)?(\w+)\s+_\w+\s*;/)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 8);

  const constructorMatch = allContent.match(/public\s+\w+Context\s*\(([^)]+)\)/);
  const constructorParams = constructorMatch
    ? constructorMatch[1]!.split(',').map(p => p.trim().split(/\s+/)[0] ?? '').filter(Boolean)
    : [];

  const namespace = extract(allContent, /namespace\s+([\w.]+)/) ?? '';
  return { fields, constructorParams, namespace };
}

function extractProjectSetupPattern(csprojFiles: string[], runsettingsFiles: string[]): ProjectSetupPattern {
  const csprojContent    = csprojFiles.map(readFile).join('\n');
  const runsettingsContent = runsettingsFiles.map(readFile).join('\n');

  const targetFramework = extract(csprojContent, /<TargetFramework>(.*?)<\/TargetFramework>/) ?? 'net8.0';
  const rootNamespace   = extract(csprojContent, /<RootNamespace>(.*?)<\/RootNamespace>/) ?? '';

  // Gather package references
  const packages = extractAll(csprojContent, /<PackageReference\s+Include="([^"]+)"/)
    .filter((v, i, a) => a.indexOf(v) === i);

  const hasReqnroll = packages.some(p => p.toLowerCase().includes('reqnroll'));
  const hasNunit    = packages.some(p => p.toLowerCase().includes('nunit'));
  const hasSpecFlow  = packages.some(p => p.toLowerCase().includes('specflow'));
  const testFramework = hasReqnroll
    ? `NUnit + Reqnroll`
    : hasSpecFlow
      ? 'NUnit + SpecFlow'
      : hasNunit
        ? 'NUnit'
        : 'MSTest';

  const runsettingsPattern = runsettingsContent.includes('TestRunParameters')
    ? 'TestRunParameters block'
    : runsettingsContent.includes('<RunSettings>')
      ? 'RunSettings block'
      : 'standard runsettings';

  return { targetFramework, testFramework, packages, runsettingsPattern, rootNamespace };
}

// ---------------------------------------------------------------------------
// TypeScript-specific extractors
// ---------------------------------------------------------------------------

/**
 * Detect whether a project is TypeScript-first by comparing TS vs C# file counts.
 * Returns 'typescript' if TS files dominate, otherwise 'csharp'.
 */
function detectLanguage(
  csPageFiles: string[], csStepFiles: string[],
  tsPageFiles: string[], tsStepFiles: string[],
): ProjectLanguage {
  const csCount = csPageFiles.length + csStepFiles.length;
  const tsCount = tsPageFiles.length + tsStepFiles.length;
  return tsCount > csCount ? 'typescript' : 'csharp';
}

/** Extract TypeScript page object patterns from *.page.ts files */
function extractTsPageObjectPattern(files: string[]): PageObjectPattern {
  const allContent = files.map(readFile).join('\n');
  const first      = files[0] ?? '';
  const content    = first ? readFile(first) : '';

  // Detect locator style: arrow fn props vs get accessors
  const hasArrow   = /private\s+\w+\s*=\s*(?:async\s*)?\(/.test(allContent) ||
                     /private\s+readonly\s+\w+\s*=\s*/.test(allContent);
  const hasLocator = allContent.includes('this.page.locator') || allContent.includes('page.locator');
  const locatorStyle = hasArrow
    ? 'private arrow function properties'
    : hasLocator
      ? 'this.page.locator() properties'
      : 'ILocator properties';

  // Async pattern
  const asyncPattern = allContent.includes('async ')
    ? 'async/await'
    : 'synchronous';

  // Namespace → TypeScript uses export class, not namespace
  const namespace = extract(content, /export\s+class\s+(\w+)Page/) ?? '';

  // Base class
  const baseClass = extract(content, /class\s+\w+Page\s+extends\s+(\w+)/) ?? null;

  // Constructor params — TS style: constructor(private readonly page: Page)
  const ctorMatch = content.match(/constructor\s*\(([^)]+)\)/);
  const constructorParams = ctorMatch
    ? ctorMatch[1]!.split(',')
        .map(p => p.trim().split(/\s*:\s*/)[1]?.trim() ?? p.trim())
        .filter(Boolean)
    : [];

  const exampleMethods = extractAll(allContent, /async\s+(\w+)\s*\(/)
    .filter((v, i, a) => a.indexOf(v) === i && v !== 'constructor')
    .slice(0, 5);

  return { baseClass, constructorParams, locatorStyle, asyncPattern, exampleMethods, namespace };
}

/** Extract TypeScript step definition patterns from *.steps.ts files */
function extractTsStepDefinitionPattern(files: string[]): StepDefinitionPattern {
  const allContent = files.map(readFile).join('\n');
  const first      = files[0] ?? '';
  const content    = first ? readFile(first) : '';

  // Cucumber vs Playwright-test style
  const hasCucumber = allContent.includes('@cucumber/cucumber') ||
                      allContent.includes('cucumber-js');
  const bindingStyle = hasCucumber
    ? 'Given/When/Then from @cucumber/cucumber'
    : 'test() / step() from @playwright/test';

  // Base class
  const baseClass = extract(content, /class\s+\w+Steps\s+extends\s+(\w+)/) ?? null;

  // Injection (constructor params)
  const ctorMatch = content.match(/constructor\s*\(([^)]+)\)/);
  const injection = ctorMatch
    ? ctorMatch[1]!.split(',')
        .map(p => p.trim().split(/\s*:\s*/)[1]?.trim() ?? p.trim())
        .filter(Boolean)
    : [];

  const namingConvention = hasCucumber ? 'Given/When/Then lambda style' : 'test.step style';

  // Extract step texts
  const exampleSteps = extractAll(allContent, /(?:Given|When|Then)\s*\(\s*['"`]([^'"`]+)['"`]/)
    .slice(0, 5);

  const namespace = '';  // TS uses module exports, not namespaces

  return { baseClass, injection, bindingStyle, namingConvention, exampleSteps, namespace };
}

/** Extract TypeScript DB helper patterns from *.db.ts files */
function extractTsDbHelperPattern(files: string[]): DbHelperPattern {
  const allContent = files.map(readFile).join('\n');
  const first      = files[0] ?? '';

  const orm = allContent.includes('prisma')
    ? 'Prisma'
    : allContent.includes('typeorm') || allContent.includes('TypeORM')
      ? 'TypeORM'
      : allContent.includes('knex') || allContent.includes('Knex')
        ? 'Knex'
        : allContent.includes('mssql') || allContent.includes('sql.connect')
          ? 'mssql'
          : allContent.includes('pg') || allContent.includes('Pool')
            ? 'pg'
            : 'raw SQL';

  const connectionSource = extract(allContent, /process\.env\.(\w+)/) ?? 'process.env.DB_CONNECTION_STRING';
  const connectionMethod = 'process.env';

  const exampleMethods = extractAll(allContent, /async\s+(\w+)\s*\(/)
    .filter((v, i, a) => a.indexOf(v) === i && v !== 'constructor')
    .slice(0, 5);

  const namespace = '';

  return { orm, connectionSource, connectionMethod, exampleMethods, namespace };
}

/** Extract TypeScript-specific patterns from playwright.config.ts + package.json */
function extractTypeScriptPatterns(
  configFiles: string[],
  packageJsonFiles: string[],
  tsPageFiles: string[],
  tsStepFiles: string[],
): TypeScriptPatterns {
  const configContent  = configFiles.map(readFile).join('\n');
  const pkgContent     = packageJsonFiles.map(readFile).join('\n');
  const allStepContent = tsStepFiles.map(readFile).join('\n');
  const allPageContent = tsPageFiles.map(readFile).join('\n');

  // Playwright version from package.json
  let playwrightVersion = '*';
  try {
    if (pkgContent) {
      const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
      const deps = { ...(pkg['dependencies'] as Record<string,string> ?? {}),
                     ...(pkg['devDependencies'] as Record<string,string> ?? {}) };
      playwrightVersion = deps['@playwright/test'] ?? deps['playwright'] ?? '*';
    }
  } catch { /* ignore */ }

  // Detect step framework
  const hasCucumber = allStepContent.includes('@cucumber/cucumber') || pkgContent.includes('@cucumber/cucumber');
  const testFramework = hasCucumber ? 'cucumber' : 'playwright/test';

  // Locator style
  const hasArrow = /private\s+\w+\s*=\s*/.test(allPageContent);
  const locatorStyle = hasArrow ? 'private arrow function properties' : 'page.locator() calls';

  // Fixture style
  const fixtureStyle = configContent.includes('use:')
    ? '{ page } destructuring'
    : 'page parameter injection';

  // Package manager
  const hasYarnLock  = configFiles.some(f => f.includes('yarn.lock'));
  const hasPnpmLock  = configFiles.some(f => f.includes('pnpm-lock'));
  const packageManager = hasPnpmLock ? 'pnpm' : hasYarnLock ? 'yarn' : 'npm';

  const configFile = configFiles.find(f => path.basename(f) === 'playwright.config.ts')
    ? 'playwright.config.ts'
    : 'playwright.config.js';

  return {
    locatorStyle,
    asyncPattern:      'async/await',
    exportStyle:       'named export class',
    stepStyle:         hasCucumber ? 'Given/When/Then from @cucumber/cucumber' : 'test.step from @playwright/test',
    fixtureStyle,
    configFile,
    packageManager,
    playwrightVersion,
    testFramework,
  };
}

// ---------------------------------------------------------------------------
// FrameworkMemoryService
// ---------------------------------------------------------------------------

export class FrameworkMemoryService {
  private frameworksDir: string;

  constructor(serverRoot?: string) {
    const root = serverRoot ?? path.join(__dirname, '..', '..');
    this.frameworksDir = path.join(root, 'memory', 'frameworks');
    fs.mkdirSync(this.frameworksDir, { recursive: true });
  }

  // ── Scan ──────────────────────────────────────────────────────────────────

  async scanProject(projectName: string, projectPath: string): Promise<FrameworkBlueprint> {
    if (!fs.existsSync(projectPath)) {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }

    // ── Collect C# files ──────────────────────────────────────────────────
    const pageFiles    = await walk(projectPath, f => /Page\.cs$/i.test(f));
    const stepFiles    = await walk(projectPath, f => /Steps?\.cs$/i.test(f));
    const dbFiles      = await walk(projectPath, f => /DBHelper\.cs$/i.test(f));
    const contextFiles = await walk(projectPath, f => /TestContext\.cs$/i.test(f));
    const runsettings  = await walk(projectPath, f => /\.runsettings$/i.test(f));
    const csprojFiles  = await walk(projectPath, f => /\.csproj$/i.test(f));

    // ── Collect TypeScript files ───────────────────────────────────────────
    const tsPageFiles   = await walk(projectPath, f => /\.page\.ts$/i.test(f));
    const tsStepFiles   = await walk(projectPath, f => /\.steps\.ts$/i.test(f));
    const tsDbFiles     = await walk(projectPath, f => /\.db\.ts$/i.test(f));
    const tsConfigFiles = await walk(projectPath, f => /playwright\.config\.ts$/i.test(f));
    const pkgJsonFiles  = await walk(projectPath, f => path.basename(f) === 'package.json');

    // ── Auto-detect language ───────────────────────────────────────────────
    const language = detectLanguage(pageFiles, stepFiles, tsPageFiles, tsStepFiles);

    if (language === 'typescript') {
      // Use TS file counts for scanSummary, fill C# fields with sensible stubs
      const tsPatterns = extractTypeScriptPatterns(tsConfigFiles, pkgJsonFiles, tsPageFiles, tsStepFiles);

      const blueprint: FrameworkBlueprint = {
        projectName,
        scannedAt:   new Date().toISOString(),
        projectPath,
        language,
        pageObject:    extractTsPageObjectPattern(tsPageFiles),
        stepDefinition: extractTsStepDefinitionPattern(tsStepFiles),
        dbHelper:      extractTsDbHelperPattern(tsDbFiles),
        testContext:   { fields: [], constructorParams: [], namespace: '' },
        projectSetup:  {
          targetFramework:    'node',
          testFramework:      tsPatterns.testFramework,
          packages:           [],
          runsettingsPattern: 'playwright.config.ts',
          rootNamespace:      '',
        },
        typescript:  tsPatterns,
        scanSummary: {
          pageFiles:      pageFiles.length,
          stepFiles:      stepFiles.length,
          dbHelperFiles:  dbFiles.length,
          contextFiles:   contextFiles.length,
          runsettings:    runsettings.length,
          csprojFiles:    csprojFiles.length,
          tsPageFiles:    tsPageFiles.length,
          tsStepFiles:    tsStepFiles.length,
          tsDbFiles:      tsDbFiles.length,
          tsConfigFiles:  tsConfigFiles.length,
        },
      };

      return blueprint;
    }

    // ── C# path (default) ─────────────────────────────────────────────────
    const blueprint: FrameworkBlueprint = {
      projectName,
      scannedAt:   new Date().toISOString(),
      projectPath,
      language:    'csharp',
      pageObject:    extractPageObjectPattern(pageFiles),
      stepDefinition: extractStepDefinitionPattern(stepFiles),
      dbHelper:      extractDbHelperPattern(dbFiles),
      testContext:   extractTestContextPattern(contextFiles),
      projectSetup:  extractProjectSetupPattern(csprojFiles, runsettings),
      scanSummary: {
        pageFiles:     pageFiles.length,
        stepFiles:     stepFiles.length,
        dbHelperFiles: dbFiles.length,
        contextFiles:  contextFiles.length,
        runsettings:   runsettings.length,
        csprojFiles:   csprojFiles.length,
        tsPageFiles:   tsPageFiles.length,
        tsStepFiles:   tsStepFiles.length,
      },
    };

    return blueprint;
  }

  // ── Persist ───────────────────────────────────────────────────────────────

  async saveBlueprint(blueprint: FrameworkBlueprint): Promise<string> {
    const filename = `${blueprint.projectName}-blueprint.json`;
    const outPath  = path.join(this.frameworksDir, filename);
    const tmp      = outPath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(blueprint, null, 2), 'utf-8');
    await fs.promises.rename(tmp, outPath);
    return outPath;
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  loadBlueprint(projectName: string): FrameworkBlueprint {
    // Accept with or without "-blueprint" suffix
    const base    = projectName.replace(/-blueprint$/i, '');
    const filePath = path.join(this.frameworksDir, `${base}-blueprint.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Blueprint not found: ${base}. ` +
        `Run scan_framework first, or check list_blueprints for available names.`
      );
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FrameworkBlueprint;
  }

  // ── List ──────────────────────────────────────────────────────────────────

  listBlueprints(): BlueprintSummary[] {
    try {
      return fs.readdirSync(this.frameworksDir)
        .filter(f => f.endsWith('-blueprint.json'))
        .map(f => {
          try {
            const raw = fs.readFileSync(path.join(this.frameworksDir, f), 'utf-8');
            const bp  = JSON.parse(raw) as FrameworkBlueprint;
            return {
              name:        bp.projectName,
              scannedAt:   bp.scannedAt,
              projectPath: bp.projectPath,
              filePath:    path.join(this.frameworksDir, f)
            };
          } catch {
            return null;
          }
        })
        .filter((s): s is BlueprintSummary => s !== null)
        .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    } catch {
      return [];
    }
  }

  getBlueprintsDir(): string { return this.frameworksDir; }
}
