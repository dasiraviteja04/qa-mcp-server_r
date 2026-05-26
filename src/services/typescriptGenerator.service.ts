/**
 * TypeScriptGeneratorService
 *
 * Generates a complete TypeScript Playwright test project skeleton that
 * matches the patterns captured in a FrameworkBlueprint (language === 'typescript').
 *
 * Produces 9 files:
 *   tests/{Name}.page.ts          — Page class with typed locators
 *   tests/{Name}.steps.ts         — Cucumber / playwright-test step definitions
 *   tests/{Name}.db.ts            — TypeScript DB helper with interfaces
 *   tests/{Name}.feature          — Gherkin feature file
 *   playwright.config.ts          — Playwright config
 *   package.json                  — NPM package
 *   tsconfig.json                 — TypeScript config
 *   .env.template                 — Environment variable template
 *   .gitignore                    — Sensible ignores
 */

import * as fs   from 'fs';
import * as path from 'path';
import type { FrameworkBlueprint } from '../types/framework.types.js';
import type { SchemaTable }        from '../types/schema.types.js';

export interface TsScaffoldResult {
  filesGenerated: string[];
  warnings:       string[];
}

// ---------------------------------------------------------------------------
// Page object generator
// ---------------------------------------------------------------------------

function genTsPage(name: string, bp: FrameworkBlueprint, pageUrl?: string): string {
  const ts = bp.typescript;
  const locatorComment = pageUrl
    ? `  // Page URL: ${pageUrl}\n  // TODO: Add locators discovered from the live page below\n`
    : '';

  const useArrow = ts?.locatorStyle.includes('arrow') ?? true;
  const locatorExample = useArrow
    ? `  private saveButton = () => this.page.locator("button[type='submit']");`
    : `  private get saveButton() { return this.page.locator("button[type='submit']"); }`;

  return `import { type Page, type Locator } from '@playwright/test';

/**
 * Page object for ${name}.
 * Generated from blueprint: ${bp.projectName} (${bp.scannedAt.split('T')[0]})
 */
export class ${name}Page {
  constructor(private readonly page: Page) {}

  // ── Locators ──────────────────────────────────────────────────────────────
${locatorComment}
  // Example locator — replace with real selectors:
  // ${locatorExample}

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Navigate to the ${name} page. */
  async navigate(): Promise<void> {
    // TODO: Replace with actual page URL from environment
    await this.page.goto(process.env['BASE_URL'] + '/${name.toLowerCase()}');
  }

  /** Example action — replace with real implementation. */
  async exampleAction(): Promise<void> {
    // TODO: Implement action
    throw new Error('Not implemented: exampleAction');
  }

  /** Example assertion helper. */
  async expectVisible(locator: Locator): Promise<void> {
    await locator.waitFor({ state: 'visible' });
  }
}
`;
}

// ---------------------------------------------------------------------------
// Step definitions generator
// ---------------------------------------------------------------------------

function genTsSteps(name: string, bp: FrameworkBlueprint): string {
  const ts = bp.typescript;
  const isCucumber = ts?.testFramework === 'cucumber' ||
                     ts?.stepStyle.includes('@cucumber/cucumber') ||
                     bp.stepDefinition.bindingStyle.includes('@cucumber/cucumber');

  if (isCucumber) {
    return `import { Given, When, Then } from '@cucumber/cucumber';
import { expect }                    from '@playwright/test';
import type { IWorld }               from '@cucumber/cucumber';
import { ${name}Page }              from './${name}.page.js';

/**
 * Step definitions for ${name} (Cucumber).
 * Generated from blueprint: ${bp.projectName} (${bp.scannedAt.split('T')[0]})
 */

Given('I navigate to the ${name} page', async function(this: IWorld) {
  const page = new ${name}Page(this.page);
  await page.navigate();
});

When('I perform an action on ${name}', async function(this: IWorld) {
  const page = new ${name}Page(this.page);
  await page.exampleAction();
});

Then('the ${name} page should show the expected result', async function(this: IWorld) {
  // TODO: Implement assertion
  expect(await this.page.title()).toBeTruthy();
});
`;
  }

  // Default: @playwright/test style
  return `import { test, expect } from '@playwright/test';
import { ${name}Page }          from './${name}.page.js';

/**
 * Tests for ${name}.
 * Generated from blueprint: ${bp.projectName} (${bp.scannedAt.split('T')[0]})
 */

test.describe('${name}', () => {
  let page${name}: ${name}Page;

  test.beforeEach(async ({ page }) => {
    page${name} = new ${name}Page(page);
    await page${name}.navigate();
  });

  test('should show the expected result', async () => {
    // TODO: Implement test body
    await expect(page${name}['page']).toHaveTitle(/.+/);
  });

  test('should perform action on ${name}', async ({ page }) => {
    const pg = new ${name}Page(page);
    await pg.navigate();
    // TODO: call pg.yourAction()
  });
});
`;
}

// ---------------------------------------------------------------------------
// DB helper generator
// ---------------------------------------------------------------------------

function genTsDb(name: string, bp: FrameworkBlueprint, tables?: SchemaTable[]): string {
  const ts  = bp.typescript;
  const orm = ts?.testFramework === 'cucumber'
    ? bp.dbHelper.orm
    : bp.dbHelper.orm;

  // Generate typed interfaces + query methods for each table
  const tableBlocks = (tables ?? []).map(table => {
    const modelName = singularize(table.tableName);
    const cols = table.columns;

    const interfaceFields = cols.map(c => {
      const tsType = c.csharpType === 'int'         ? 'number'
                   : c.csharpType === 'long'        ? 'number'
                   : c.csharpType === 'decimal'     ? 'number'
                   : c.csharpType === 'bool'        ? 'boolean'
                   : c.csharpType === 'DateTime'    ? 'Date'
                   : c.csharpType === 'Guid'        ? 'string'
                   : 'string';
      const optional = c.isNullable ? '?' : '';
      return `  ${camelCase(c.columnName)}${optional}: ${tsType};`;
    }).join('\n');

    const pk = cols.find(c => c.isPrimaryKey);
    const pkName   = pk ? camelCase(pk.columnName) : 'id';
    const pkType   = pk?.csharpType === 'int' || pk?.csharpType === 'long' ? 'number' : 'string';

    return `
/** Row shape for ${table.tableName} */
export interface ${modelName} {
${interfaceFields}
}

/** Get all ${table.tableName} rows. */
async function getAll${table.tableName}(): Promise<${modelName}[]> {
  // TODO: Execute SELECT * FROM ${table.tableName}
  throw new Error('Not implemented: getAll${table.tableName}');
}

/** Get a single ${modelName} by primary key. */
async function get${modelName}By${pk ? pascal(pk.columnName) : 'Id'}(${pkName}: ${pkType}): Promise<${modelName} | null> {
  // TODO: Execute SELECT * FROM ${table.tableName} WHERE ${pk?.columnName ?? 'Id'} = ?
  throw new Error('Not implemented: get${modelName}By${pk ? pascal(pk.columnName) : 'Id'}');
}`;
  }).join('\n');

  const noTablesBlock = (tables ?? []).length === 0
    ? `
// TODO: Define interfaces and query methods for your tables.
// Example:
//
// export interface Invoice {
//   invoiceId: number;
//   amount: number;
//   createdAt: Date;
// }
//
// async function getAllInvoices(): Promise<Invoice[]> {
//   // ...
// }
`
    : '';

  return `/**
 * DB helper for ${name}.
 * Generated from blueprint: ${bp.projectName} (${bp.scannedAt.split('T')[0]})
 * ORM pattern: ${orm}
 */

// Connection is read from environment — never hard-code credentials.
const connectionString = process.env['DB_CONNECTION_STRING'];
if (!connectionString) {
  throw new Error('DB_CONNECTION_STRING environment variable is not set');
}
${noTablesBlock}${tableBlocks}

export {
${(tables ?? []).map(t => `  getAll${t.tableName},\n  get${singularize(t.tableName)}By${(t.columns.find(c => c.isPrimaryKey)?.columnName) ? pascal(t.columns.find(c => c.isPrimaryKey)!.columnName) : 'Id'},`).join('\n')}
};
`;
}

// ---------------------------------------------------------------------------
// Feature file
// ---------------------------------------------------------------------------

function genTsFeature(name: string): string {
  return `Feature: ${name}
    ${name} feature — generated from framework blueprint

    @regression @${name.toLowerCase()}
    Scenario: Example ${name} scenario
        Given I navigate to the ${name} page
        When I perform an action on ${name}
        Then the ${name} page should show the expected result

    # TODO: Add real business scenarios below
`;
}

// ---------------------------------------------------------------------------
// playwright.config.ts
// ---------------------------------------------------------------------------

function genPlaywrightConfig(name: string, bp: FrameworkBlueprint): string {
  const ts = bp.typescript;
  const isCucumber = ts?.testFramework === 'cucumber';

  if (isCucumber) {
    return `import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Playwright config for ${name} (Cucumber mode).
 * Generated from blueprint: ${bp.projectName}
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  timeout:    30_000,
  retries:    process.env['CI'] ? 2 : 0,
  workers:    process.env['CI'] ? 1 : undefined,
  reporter:   [['html', { outputFolder: 'playwright-report' }], ['list']],

  use: {
    baseURL:     process.env['BASE_URL'] ?? 'http://localhost:3000',
    headless:    process.env['HEADLESS'] !== 'false',
    screenshot:  'only-on-failure',
    video:       'retain-on-failure',
    trace:       'on-first-retry',
  },

  projects: [
    {
      name:  'chromium',
      use:   { ...devices['Desktop Chrome'] },
    },
  ],
});
`;
  }

  return `import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Playwright config for ${name}.
 * Generated from blueprint: ${bp.projectName}
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir:        './tests',
  timeout:        30_000,
  expect:         { timeout: 5_000 },
  fullyParallel:  true,
  forbidOnly:     !!process.env['CI'],
  retries:        process.env['CI'] ? 2 : 0,
  workers:        process.env['CI'] ? 1 : undefined,
  reporter:       [['html', { outputFolder: 'playwright-report' }], ['list']],

  use: {
    baseURL:    process.env['BASE_URL'] ?? 'http://localhost:3000',
    headless:   process.env['HEADLESS'] !== 'false',
    screenshot: 'only-on-failure',
    video:      'retain-on-failure',
    trace:      'on-first-retry',
  },

  projects: [
    {
      name:  'chromium',
      use:   { ...devices['Desktop Chrome'] },
    },
    {
      name:  'firefox',
      use:   { ...devices['Desktop Firefox'] },
    },
  ],
});
`;
}

// ---------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------

function genPackageJson(name: string, bp: FrameworkBlueprint): string {
  const ts  = bp.typescript;
  const ver = ts?.playwrightVersion ?? '*';
  const isCucumber = ts?.testFramework === 'cucumber';

  const testScript = isCucumber
    ? 'cucumber-js --config cucumber.json'
    : 'playwright test';

  const devDeps: Record<string, string> = {
    '@playwright/test':   ver,
    'typescript':         '^5.0.0',
    'dotenv':             '^16.0.0',
    '@types/node':        '^20.0.0',
  };

  if (isCucumber) {
    devDeps['@cucumber/cucumber']         = '^10.0.0';
    devDeps['@cucumber/pretty-formatter'] = '^1.0.0';
  }

  return JSON.stringify({
    name:        `${name.toLowerCase()}-tests`,
    version:     '1.0.0',
    description: `Playwright test project for ${name} — generated from blueprint: ${bp.projectName}`,
    scripts: {
      test:         testScript,
      'test:headed': `${testScript} --headed`,
      'test:debug':  `${testScript} --debug`,
      report:       'playwright show-report',
      install_browsers: 'playwright install',
    },
    devDependencies: devDeps,
  }, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// tsconfig.json
// ---------------------------------------------------------------------------

function genTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target:                    'ES2022',
      module:                    'NodeNext',
      moduleResolution:          'NodeNext',
      lib:                       ['ES2022'],
      outDir:                    './dist',
      rootDir:                   './',
      strict:                    true,
      esModuleInterop:           true,
      skipLibCheck:               true,
      resolveJsonModule:         true,
      declaration:               true,
      declarationMap:            true,
      sourceMap:                 true,
      noUncheckedIndexedAccess:  true,
      forceConsistentCasingInFileNames: true,
    },
    include: ['./**/*.ts'],
    exclude: ['node_modules', 'dist', 'playwright-report', 'test-results'],
  }, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// .env.template
// ---------------------------------------------------------------------------

function genEnvTemplate(name: string): string {
  return `# Environment configuration for ${name} tests
# Copy this file to .env and fill in real values — never commit .env

# ── App ───────────────────────────────────────────────────────────────────────
BASE_URL=https://your-app.com
HEADLESS=true

# ── Auth (if required) ────────────────────────────────────────────────────────
TEST_USERNAME=your_username
TEST_PASSWORD=your_password

# ── Database ──────────────────────────────────────────────────────────────────
# SQL Server  : Server=host;Database=db;User Id=sa;Password=xxx;
# PostgreSQL  : postgresql://user:password@localhost:5432/mydb
DB_CONNECTION_STRING=

# ── CI / Test settings ────────────────────────────────────────────────────────
CI=false
`;
}

// ---------------------------------------------------------------------------
// .gitignore
// ---------------------------------------------------------------------------

function genGitIgnore(): string {
  return `# Dependencies
node_modules/

# TypeScript build output
dist/

# Playwright artifacts
playwright-report/
test-results/
*.zip

# Environment — NEVER commit real credentials
.env
.env.local
.env.*.local

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.suo
*.user
`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function singularize(name: string): string {
  if (name.endsWith('ies'))  return name.slice(0, -3) + 'y';
  if (name.endsWith('ses'))  return name.slice(0, -2);
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return name;
}

function camelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function pascal(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export class TypeScriptGeneratorService {

  async generateProject(
    name:       string,
    outDir:     string,
    blueprint:  FrameworkBlueprint,
    options:    { pageUrl?: string; dbTables?: SchemaTable[] } = {},
  ): Promise<TsScaffoldResult> {
    fs.mkdirSync(path.join(outDir, 'tests'), { recursive: true });

    const filesGenerated: string[] = [];
    const warnings:       string[] = [];

    const write = async (relPath: string, content: string) => {
      const full = path.join(outDir, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, content, 'utf-8');
      filesGenerated.push(full);
    };

    // 1. Page object
    await write(`tests/${name}.page.ts`, genTsPage(name, blueprint, options.pageUrl));

    // 2. Step definitions
    await write(`tests/${name}.steps.ts`, genTsSteps(name, blueprint));

    // 3. DB helper
    if (options.dbTables && options.dbTables.length > 0) {
      await write(`tests/${name}.db.ts`, genTsDb(name, blueprint, options.dbTables));
    } else {
      await write(`tests/${name}.db.ts`, genTsDb(name, blueprint));
      warnings.push(
        'DB helper generated with placeholder only — no schema tables available. ' +
        'Run read_db_schema first, or the C# path will auto-use saved schemas.',
      );
    }

    // 4. Feature file (only for Cucumber mode)
    const isCucumber = blueprint.typescript?.testFramework === 'cucumber' ||
                       blueprint.stepDefinition.bindingStyle.includes('@cucumber/cucumber');
    if (isCucumber) {
      await write(`tests/${name}.feature`, genTsFeature(name));
    }

    // 5. Config files at project root
    await write('playwright.config.ts', genPlaywrightConfig(name, blueprint));
    await write('package.json',         genPackageJson(name, blueprint));
    await write('tsconfig.json',        genTsConfig());
    await write('.env.template',        genEnvTemplate(name));
    await write('.gitignore',           genGitIgnore());

    return { filesGenerated, warnings };
  }
}
