/**
 * Service for running UIAutomationTests (C# / Reqnroll / NUnit) via dotnet test.
 *
 * Uses async spawn (not execSync) so the Node.js event loop stays responsive
 * during long-running UI test suites (which can take 5-15 minutes).
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { ReportService } from './report.service.js';

export interface PlaywrightConfig {
  projectRoot:     string;
  csprojFile?:     string;
  runSettingsFile?: string;
  reportOutputDir?: string;
}

export interface RunTestsOptions {
  /** Gherkin category tags  — e.g. ['couponhive-ui'] */
  tags?:           string[];
  /** Raw VSTest --filter expression — e.g. 'FullyQualifiedName~CreateSingleCoupon' */
  filter?:         string;
  /** Convenience: run a single named scenario  — wraps into FullyQualifiedName~ filter */
  scenario?:       string;
  workers?:        number;
  timeout?:        number;
  runSettingsFile?: string;
}

export interface RunResult {
  success:        boolean;
  consoleOutput:  string;
  screenshotDir:  string;
  screenshots:    string[];    // relative paths of any .png files written during this run
}

export class PlaywrightService {
  private config: PlaywrightConfig;
  private reportService: ReportService;

  constructor(config: PlaywrightConfig) {
    this.config = config;
    this.reportService = new ReportService(config.reportOutputDir);

    if (!fs.existsSync(config.projectRoot)) {
      throw new Error(`C# project folder not found at: ${config.projectRoot}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Main runner
  // ---------------------------------------------------------------------------

  /**
   * Run dotnet test asynchronously and return when the process exits.
   *
   * Filter priority (highest to lowest):
   *   1. options.filter   – raw VSTest filter expression passed verbatim
   *   2. options.scenario – wrapped as  FullyQualifiedName~<value>
   *   3. options.tags     – wrapped as  TestCategory=tag1|TestCategory=tag2
   *
   * dotnet test exits with code 1 when any test fails – we catch that and
   * still parse the TRX that was written before exit so results are captured.
   */
  async runTests(options: RunTestsOptions = {}): Promise<RunResult> {
    const reportsDir = this.config.reportOutputDir || path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const csprojFile  = this.config.csprojFile     || 'UIAutomationTests.csproj';
    const runSettings = options.runSettingsFile
                     || this.config.runSettingsFile || 'auto.runsettings';
    const trxPath     = path.join(reportsDir, 'results.trx');

    // Remove stale TRX so we can tell whether this run produced one
    if (fs.existsSync(trxPath)) fs.unlinkSync(trxPath);

    // ── Build arguments array ──────────────────────────────────────────────
    const args: string[] = [
      'test', csprojFile,
      '--settings', runSettings,
      '--logger', `trx;LogFileName=results.trx`,
      '--results-directory', reportsDir,
      '--no-build',
      '--configuration', 'Release'
    ];

    // Filter precedence: raw filter > scenario name > category tags
    if (options.filter) {
      args.push('--filter', options.filter);
    } else if (options.scenario) {
      args.push('--filter', `FullyQualifiedName~${options.scenario}`);
    } else if (options.tags && options.tags.length > 0) {
      const filterExpr = options.tags
        .map(tag => `TestCategory=${tag}`)
        .join('|');
      args.push('--filter', filterExpr);
    }

    // ── Snapshot screenshot folder before run ─────────────────────────────
    const screenshotDir = path.join(this.config.projectRoot,
      'bin', 'Release', 'net8.0', 'testresults', 'screenshots');
    const screenshotsBefore = this.listScreenshots(screenshotDir);

    // ── Spawn dotnet test (async — does NOT block the event loop) ─────────
    const { success, output } = await this.spawnDotnet(args, this.config.projectRoot);

    // ── Parse TRX into JSON regardless of exit code ───────────────────────
    if (fs.existsSync(trxPath)) {
      this.reportService.parseTrxToLatest(trxPath);
    }

    // ── Detect new screenshots written during this run ────────────────────
    const screenshotsAfter = this.listScreenshots(screenshotDir);
    const newScreenshots   = screenshotsAfter.filter(s => !screenshotsBefore.includes(s));

    return {
      success,
      consoleOutput: output,
      screenshotDir,
      screenshots: newScreenshots
    };
  }

  // ---------------------------------------------------------------------------
  // Convenience runners
  // ---------------------------------------------------------------------------

  async runCriticalTests():  Promise<RunResult> { return this.runTests({ tags: ['production'] }); }
  async runSmokeTests():     Promise<RunResult> { return this.runTests({ tags: ['staging'] }); }
  async runRegressionTests():Promise<RunResult> { return this.runTests({ tags: ['regression'] }); }

  // ---------------------------------------------------------------------------
  // Report / analysis delegation
  // ---------------------------------------------------------------------------

  getLatestReport()              { return this.reportService.getLatestReport(); }
  analyzeFailures()              { return this.reportService.analyzeFailures(); }
  getTestHistory(name: string)   { return this.reportService.getTestHistory(name); }
  getProjectRoot(): string       { return this.config.projectRoot; }

  validateProject(): boolean {
    const f = this.config.csprojFile || 'UIAutomationTests.csproj';
    return fs.existsSync(path.join(this.config.projectRoot, f));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Spawn `dotnet <args>` and resolve when the process exits.
   * stdout + stderr are captured and returned as a single string.
   */
  private spawnDotnet(
    args: string[],
    cwd: string
  ): Promise<{ success: boolean; output: string }> {
    return new Promise(resolve => {
      const chunks: string[] = [];

      const child = spawn('dotnet', args, {
        cwd,
        shell: false,
        env: process.env
      });

      child.stdout.on('data', (data: Buffer) => chunks.push(data.toString()));
      child.stderr.on('data', (data: Buffer) => chunks.push(data.toString()));

      child.on('close', (code: number | null) => {
        resolve({
          success: code === 0,
          output:  chunks.join('')
        });
      });

      child.on('error', (err: Error) => {
        resolve({ success: false, output: `Failed to start dotnet: ${err.message}` });
      });
    });
  }

  /** Return sorted list of .png files in a directory (empty if dir missing). */
  private listScreenshots(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.png'))
        .sort();
    } catch {
      return [];
    }
  }
}
