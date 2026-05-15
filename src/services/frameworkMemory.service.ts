/**
 * FrameworkMemoryService
 *
 * Scans an existing C#/Reqnroll/Playwright test project, extracts coding
 * patterns from real source files, saves a blueprint JSON, and can later
 * load that blueprint for scaffolding new projects.
 *
 * Supported file patterns:
 *   *Page.cs        → page object pattern
 *   *Steps.cs       → step definition pattern
 *   *DBHelper.cs    → DB helper pattern
 *   *TestContext.cs → test context pattern
 *   *.runsettings   → project config pattern
 *   *.csproj        → project structure
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

    // Collect files by type
    const pageFiles     = await walk(projectPath, f => /Page\.cs$/i.test(f));
    const stepFiles     = await walk(projectPath, f => /Steps?\.cs$/i.test(f));
    const dbFiles       = await walk(projectPath, f => /DBHelper\.cs$/i.test(f));
    const contextFiles  = await walk(projectPath, f => /TestContext\.cs$/i.test(f));
    const runsettings   = await walk(projectPath, f => /\.runsettings$/i.test(f));
    const csprojFiles   = await walk(projectPath, f => /\.csproj$/i.test(f));

    const blueprint: FrameworkBlueprint = {
      projectName,
      scannedAt:   new Date().toISOString(),
      projectPath,
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
      }
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
