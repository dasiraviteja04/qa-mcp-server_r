/**
 * Service for reading and managing Playwright test reports
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ExecutionReport, TestResult, FailureAnalysis } from '../types/mcp.types.js';

export class ReportService {
  private reportsDir: string;

  constructor(reportsDir: string = path.join(process.cwd(), 'reports')) {
    this.reportsDir = reportsDir;
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  /**
   * Get the latest report from reports directory
   */
  getLatestReport(): ExecutionReport | null {
    try {
      const latestPath = path.join(this.reportsDir, 'latest.json');
      
      if (!fs.existsSync(latestPath)) {
        console.log('No latest.json report found');
        return null;
      }

      const content = fs.readFileSync(latestPath, 'utf-8');
      const playwrightReport = JSON.parse(content);
      
      return this.transformPlaywrightReport(playwrightReport);
    } catch (error) {
      console.error('Error reading latest report:', error);
      return null;
    }
  }

  /**
   * Get all historical reports
   */
  getAllReports(): ExecutionReport[] {
    try {
      const files = fs.readdirSync(this.reportsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();

      return files
        .map(file => {
          try {
            const content = fs.readFileSync(path.join(this.reportsDir, file), 'utf-8');
            return this.transformPlaywrightReport(JSON.parse(content), file);
          } catch {
            return null;
          }
        })
        .filter((r): r is ExecutionReport => r !== null);
    } catch (error) {
      console.error('Error reading reports:', error);
      return [];
    }
  }

  /**
   * Transform Playwright JSON format to our internal format
   */
  private transformPlaywrightReport(playwrightReport: any, filename?: string): ExecutionReport {
    const tests: TestResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    // Parse test results from Playwright format
    if (playwrightReport.suites) {
      this.flattenSuites(playwrightReport.suites, tests);
    }

    // Count results
    tests.forEach(test => {
      if (test.status === 'passed') passed++;
      else if (test.status === 'failed') failed++;
      else if (test.status === 'skipped') skipped++;
    });

    return {
      id: filename || `report-${Date.now()}`,
      timestamp: new Date(playwrightReport.metadata?.startTime || Date.now()).toISOString(),
      totalTests: tests.length,
      passed,
      failed,
      skipped,
      duration: playwrightReport.metadata?.duration || 0,
      tests,
      environment: process.env.TEST_ENV || 'default'
    };
  }

  /**
   * Flatten Playwright's nested suite structure
   */
  private flattenSuites(suites: any[], results: TestResult[], parentTags: string[] = []) {
    suites.forEach(suite => {
      const currentTags = [...parentTags];
      
      // Extract tags from title
      const titleMatch = suite.title?.match(/@\w+/g) || [];
      currentTags.push(...titleMatch.map((t: string) => t.substring(1)));

      if (suite.tests) {
        suite.tests.forEach((test: any) => {
          const testTags = [...currentTags];
          const testTitleMatch = test.title?.match(/@\w+/g) || [];
          testTags.push(...testTitleMatch.map((t: string) => t.substring(1)));

          results.push({
            name: test.title || 'Unknown',
            status: this.mapPlaywrightStatus(test),
            duration: test.duration || 0,
            error: test.results?.[0]?.error?.message,
            tags: testTags
          });
        });
      }

      if (suite.suites) {
        this.flattenSuites(suite.suites, results, currentTags);
      }
    });
  }

  /**
   * Map Playwright test status to our enum
   */
  private mapPlaywrightStatus(test: any): TestResult['status'] {
    const status = test.status || 'unknown';
    
    if (status === 'passed') return 'passed';
    if (status === 'failed') return 'failed';
    if (status === 'skipped') return 'skipped';
    
    // Mark as flaky if it was retried and passed
    if (test.results && test.results.length > 1) {
      const hasFailure = test.results.some((r: any) => r.status === 'fail');
      const hasPass = test.results.some((r: any) => r.status === 'pass');
      if (hasFailure && hasPass) return 'flaky';
    }
    
    return 'failed';
  }

  /**
   * Get test execution history (last N runs)
   */
  getTestHistory(testName: string, limit: number = 5): TestResult[] {
    const reports = this.getAllReports().slice(0, limit);
    const history: TestResult[] = [];

    reports.forEach(report => {
      const test = report.tests.find(t => t.name === testName);
      if (test) {
        history.push(test);
      }
    });

    return history;
  }

  /**
   * Analyze failures and classify them
   */
  analyzeFailures(): FailureAnalysis[] {
    const latestReport = this.getLatestReport();
    if (!latestReport) return [];

    const failedTests = latestReport.tests.filter(t => t.status === 'failed');
    const historicalReports = this.getAllReports().slice(1, 6); // Exclude latest, get last 5

    const analyses: FailureAnalysis[] = failedTests.map(test => {
      const history = this.getTestHistory(test.name);
      const failureCount = history.filter(t => t.status === 'failed').length;
      
      let classification: FailureAnalysis['classification'] = 'new-failure';
      
      // Classify the failure
      if (failureCount >= 3) {
        classification = 'flaky';
      } else if (failureCount > 0) {
        classification = 'regression';
      }

      return {
        name: test.name,
        failureCount,
        lastFailureTime: latestReport.timestamp,
        classification,
        error: test.error || 'Unknown error'
      };
    });

    return analyses;
  }

  /**
   * Save a new report to disk
   */
  saveReport(report: ExecutionReport): void {
    try {
      // Save as timestamped file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filepath = path.join(this.reportsDir, `run-${timestamp}.json`);
      fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

      // Also update latest.json
      const latestPath = path.join(this.reportsDir, 'latest.json');
      fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

      console.log(`Report saved: ${filepath}`);
    } catch (error) {
      console.error('Error saving report:', error);
    }
  }
}
