/**
 * Service for interacting with Playwright test execution
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { ReportService } from './report.service.js';

export interface PlaywrightConfig {
  projectRoot: string;
  reporter?: string;
  reportOutputDir?: string;
}

export class PlaywrightService {
  private config: PlaywrightConfig;
  private reportService: ReportService;

  constructor(config: PlaywrightConfig) {
    this.config = config;
    this.reportService = new ReportService(config.reportOutputDir);

    // Validate project exists
    if (!fs.existsSync(config.projectRoot)) {
      throw new Error(`Playwright project not found at ${config.projectRoot}`);
    }
  }

  /**
   * Get list of available tests from Playwright
   */
  getTestList(): string[] {
    try {
      const output = execSync(
        'npx playwright test --list',
        { 
          cwd: this.config.projectRoot,
          encoding: 'utf-8'
        }
      );

      // Parse test names from output
      const tests = output
        .split('\n')
        .filter(line => line.includes('.spec.ts') || line.includes('.spec.js'))
        .map(line => line.trim())
        .filter(line => line.length > 0);

      return tests;
    } catch (error) {
      console.error('Error listing tests:', error);
      return [];
    }
  }

  /**
   * Run tests with specific grep pattern
   * Supports tags like @critical, @smoke, @regression
   */
  runTests(options: {
    grep?: string;
    tags?: string[];
    project?: string;
    workers?: number;
    timeout?: number;
  } = {}): boolean {
    try {
      // Create a temporary directory for this test run
      const testResultsDir = path.join(this.config.projectRoot, '.test-results-temp');
      if (!fs.existsSync(testResultsDir)) {
        fs.mkdirSync(testResultsDir, { recursive: true });
      }

      let command = 'npx playwright test';

      // Build grep pattern from tags
      if (options.tags && options.tags.length > 0) {
        const grepPattern = options.tags.map(tag => `@${tag}`).join('|');
        command += ` --grep "${grepPattern}"`;
      } else if (options.grep) {
        command += ` --grep "${options.grep}"`;
      }

      // Add project if specified
      if (options.project) {
        command += ` --project=${options.project}`;
      }

      // Add workers configuration
      if (options.workers) {
        command += ` --workers=${options.workers}`;
      }

      // Add timeout if specified
      if (options.timeout) {
        command += ` --timeout=${options.timeout}`;
      }

      // Use JSON reporter and specify output location
      command += ` --reporter=json --reporter-output="${testResultsDir}/results.json"`;

      // Executing test command
      
      execSync(command, {
        cwd: this.config.projectRoot,
        stdio: 'pipe' // Changed from 'inherit' to 'pipe' to capture output
      });

      // Copy results to reports directory as latest.json
      const resultsFile = path.join(testResultsDir, 'results.json');
      if (fs.existsSync(resultsFile)) {
        const reportsDir = this.config.reportOutputDir || path.join(process.cwd(), 'reports');
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }
        const latestFile = path.join(reportsDir, 'latest.json');
        fs.copyFileSync(resultsFile, latestFile);
      }

      return true;
    } catch (error: any) {
      // Playwright returns non-zero exit code if tests fail
      // This is expected behavior, not necessarily an error
      return false;
    }
  }

  /**
   * Run only critical tests
   */
  runCriticalTests(): boolean {
    return this.runTests({ tags: ['critical'] });
  }

  /**
   * Run only smoke tests
   */
  runSmokeTests(): boolean {
    return this.runTests({ tags: ['smoke'] });
  }

  /**
   * Run regression tests
   */
  runRegressionTests(): boolean {
    return this.runTests({ tags: ['regression'] });
  }

  /**
   * Get the latest test report
   */
  getLatestReport() {
    return this.reportService.getLatestReport();
  }

  /**
   * Analyze failures from latest report
   */
  analyzeFailures() {
    return this.reportService.analyzeFailures();
  }

  /**
   * Get test history
   */
  getTestHistory(testName: string) {
    return this.reportService.getTestHistory(testName);
  }

  /**
   * Get project root path
   */
  getProjectRoot(): string {
    return this.config.projectRoot;
  }

  /**
   * Check if project has valid Playwright config
   */
  validateProject(): boolean {
    const configPath = path.join(this.config.projectRoot, 'playwright.config.ts');
    const configJsPath = path.join(this.config.projectRoot, 'playwright.config.js');
    
    return fs.existsSync(configPath) || fs.existsSync(configJsPath);
  }
}
