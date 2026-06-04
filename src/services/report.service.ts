/**
 * Service for reading and managing test reports.
 * Parses dotnet test TRX (XML) output and converts to internal ExecutionReport format.
 */

import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { ExecutionReport, TestResult, FailureAnalysis } from '../types/mcp.types.js';

export class ReportService {
  private reportsDir: string;

  constructor(reportsDir: string = path.join(process.cwd(), 'reports')) {
    this.reportsDir = reportsDir;
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // TRX parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse a TRX file and save the result as latest.json (+ timestamped copy).
   * Called by PlaywrightService immediately after dotnet test completes.
   */
  parseTrxToLatest(trxPath: string): void {
    const report = this.parseTrxFile(trxPath);
    if (report) {
      this.saveReport(report);
    }
  }

  /**
   * Parse a TRX XML file into our internal ExecutionReport format.
   *
   * TRX key structure:
   *   <TestRun>
   *     <TestDefinitions>
   *       <UnitTest name="..." id="...">
   *         <TestCategory>
   *           <TestCategoryItem TestCategory="regression" />
   *         </TestCategory>
   *       </UnitTest>
   *     </TestDefinitions>
   *     <Results>
   *       <UnitTestResult testId="..." testName="..." outcome="Passed|Failed|NotExecuted"
   *                       duration="00:00:05.1234567" startTime="..." endTime="...">
   *         <Output>
   *           <ErrorInfo><Message>...</Message></ErrorInfo>
   *         </Output>
   *       </UnitTestResult>
   *     </Results>
   *     <Times start="..." finish="..." />
   *     <ResultSummary>
   *       <Counters total="5" passed="4" failed="1" />
   *     </ResultSummary>
   *   </TestRun>
   */
  private parseTrxFile(trxPath: string): ExecutionReport | null {
    try {
      const content = fs.readFileSync(trxPath, 'utf-8');

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        removeNSPrefix: true,
        // Raise entity-expansion limit so large full-suite TRX files parse correctly.
        // fast-xml-parser v4 reads this from processEntities.maxTotalExpansions.
        // The default 1000 is exceeded by full couponhive-ui suites (1000+ expansions).
        processEntities: { enabled: true, maxTotalExpansions: 100_000 } as any,
        isArray: (name) =>
          ['UnitTestResult', 'UnitTest', 'TestCategoryItem'].includes(name)
      });

      const trx = parser.parse(content);
      const testRun = trx?.TestRun;
      if (!testRun) return null;

      // Build testId → tags map from TestDefinitions
      const tagsByTestId = this.extractTagsByTestId(testRun);

      // Parse individual test results
      const tests: TestResult[] = [];
      const rawResults = testRun?.Results?.UnitTestResult ?? [];
      for (const r of rawResults) {
        const testId: string = r['@_testId'] ?? '';
        const name: string = r['@_testName'] ?? 'Unknown';
        const outcome: string = r['@_outcome'] ?? '';
        const duration: number = this.parseTrxDuration(r['@_duration'] ?? '');
        const tags: string[] = tagsByTestId.get(testId) ?? [];

        const errorMsg = r?.Output?.ErrorInfo?.Message
          ? String(r.Output.ErrorInfo.Message).trim()
          : undefined;

        tests.push({
          name,
          status: this.mapTrxOutcome(outcome),
          duration,
          ...(errorMsg !== undefined ? { error: errorMsg } : {}),
          tags
        });
      }

      // Counts from ResultSummary counters (fast path)
      const counters = testRun?.ResultSummary?.Counters;
      const passed  = Number(counters?.['@_passed']  ?? 0);
      const failed  = Number(counters?.['@_failed']  ?? 0);
      const total   = Number(counters?.['@_total']   ?? tests.length);
      // "NotExecuted" maps to skipped
      const skipped = total - passed - failed;

      // Total duration from <Times> element
      const times = testRun?.Times;
      let durationMs = 0;
      if (times) {
        const start  = Date.parse(times['@_start']  ?? '');
        const finish = Date.parse(times['@_finish'] ?? '');
        if (!isNaN(start) && !isNaN(finish)) {
          durationMs = finish - start;
        }
      }

      const timestamp = times?.['@_start']
        ? new Date(times['@_start']).toISOString()
        : new Date().toISOString();

      return {
        id: `report-${Date.now()}`,
        timestamp,
        totalTests: total,
        passed,
        failed,
        skipped: Math.max(skipped, 0),
        duration: durationMs,
        tests,
        environment: process.env.TEST_ENV || 'development'
      };
    } catch (error) {
      console.error('Error parsing TRX file:', error);
      return null;
    }
  }

  /**
   * Build a map of testId → tags[] from the TestDefinitions section.
   * Reqnroll converts @gherkin-tags to NUnit [Category] attributes which
   * appear as <TestCategoryItem TestCategory="..." /> in the TRX.
   */
  private extractTagsByTestId(testRun: any): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const defs = testRun?.TestDefinitions?.UnitTest ?? [];
    for (const def of defs) {
      const id: string = def['@_id'] ?? '';
      const items = def?.TestCategory?.TestCategoryItem ?? [];
      const tags: string[] = items.map((item: any) =>
        String(item['@_TestCategory'] ?? '').toLowerCase()
      ).filter(Boolean);
      if (id) map.set(id, tags);
    }
    return map;
  }

  /**
   * Convert TRX outcome string to our internal status enum.
   * TRX outcomes: Passed | Failed | NotExecuted | Error | Inconclusive | Timeout | Aborted
   */
  private mapTrxOutcome(outcome: string): TestResult['status'] {
    switch (outcome.toLowerCase()) {
      case 'passed':      return 'passed';
      case 'failed':
      case 'error':
      case 'timeout':
      case 'aborted':     return 'failed';
      case 'notexecuted':
      case 'inconclusive':
      default:            return 'skipped';
    }
  }

  /**
   * Parse TRX duration string "HH:MM:SS.FFFFFFF" to milliseconds.
   */
  private parseTrxDuration(duration: string): number {
    if (!duration) return 0;
    const parts = duration.split(':');
    if (parts.length !== 3) return 0;
    const hours   = parseInt(parts[0] ?? '0', 10);
    const minutes = parseInt(parts[1] ?? '0', 10);
    const secParts = (parts[2] ?? '0').split('.');
    const seconds  = parseInt(secParts[0] ?? '0', 10);
    // Keep first 3 decimal digits as milliseconds
    const ms = secParts[1]
      ? Math.round(parseInt((secParts[1] + '000').substring(0, 3), 10))
      : 0;
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + ms;
  }

  // ---------------------------------------------------------------------------
  // Report storage and retrieval
  // ---------------------------------------------------------------------------

  /**
   * Read the latest saved report (JSON format).
   */
  getLatestReport(): ExecutionReport | null {
    try {
      const latestPath = path.join(this.reportsDir, 'latest.json');
      if (!fs.existsSync(latestPath)) return null;
      const content = fs.readFileSync(latestPath, 'utf-8');
      return JSON.parse(content) as ExecutionReport;
    } catch (error) {
      console.error('Error reading latest report:', error);
      return null;
    }
  }

  /**
   * Read all historical reports (JSON files in reports dir).
   */
  getAllReports(): ExecutionReport[] {
    try {
      return fs.readdirSync(this.reportsDir)
        .filter(f => f.startsWith('run-') && f.endsWith('.json'))
        .sort()
        .reverse()
        .map(file => {
          try {
            const content = fs.readFileSync(path.join(this.reportsDir, file), 'utf-8');
            return JSON.parse(content) as ExecutionReport;
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
   * Get the execution history for a single test (last N runs).
   */
  getTestHistory(testName: string, limit: number = 5): TestResult[] {
    const reports = this.getAllReports().slice(0, limit);
    const history: TestResult[] = [];
    for (const report of reports) {
      const test = report.tests.find(t => t.name === testName);
      if (test) history.push(test);
    }
    return history;
  }

  /**
   * Build a map of testName → failure rate percentage across ALL stored runs.
   * A rate of 80 means the test failed in 80% of runs where it appeared.
   */
  getFlakinessMap(): Map<string, number> {
    const reports = this.getAllReports();
    if (reports.length === 0) return new Map();

    const runCount  = new Map<string, number>(); // testName → how many runs included it
    const failCount = new Map<string, number>(); // testName → how many of those failed

    for (const report of reports) {
      for (const test of report.tests) {
        runCount.set(test.name,  (runCount.get(test.name)  ?? 0) + 1);
        if (test.status === 'failed') {
          failCount.set(test.name, (failCount.get(test.name) ?? 0) + 1);
        }
      }
    }

    const map = new Map<string, number>();
    for (const [name, runs] of runCount) {
      const fails = failCount.get(name) ?? 0;
      map.set(name, Math.round((fails / runs) * 100));
    }
    return map;
  }

  /**
   * Determine the failure pattern for a single test across all stored runs.
   *   'always-failing'  – failed in every run
   *   'newly-failing'   – passed in earlier runs, failing in recent ones
   *   'flaky'           – mixed pass/fail with no clear trend
   *   'passing'         – no failures recorded
   */
  getRegressionPattern(
    testName: string
  ): 'always-failing' | 'newly-failing' | 'flaky' | 'passing' {
    const reports = this.getAllReports();
    const results = reports
      .map(r => r.tests.find(t => t.name === testName))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);

    if (results.length === 0) return 'passing';

    const failCount = results.filter(t => t.status === 'failed').length;
    if (failCount === 0) return 'passing';
    if (failCount === results.length) return 'always-failing';

    // Check if failures are concentrated in the most recent half
    const mid = Math.floor(results.length / 2);
    const recentFails = results.slice(0, mid).filter(t => t.status === 'failed').length;
    const olderFails  = results.slice(mid).filter(t => t.status === 'failed').length;

    if (recentFails > 0 && olderFails === 0) return 'newly-failing';
    return 'flaky';
  }

  /**
   * ISO timestamp of the first stored run where this test was seen failing.
   * Returns null if the test has never failed in stored history.
   */
  getFirstFailureDate(testName: string): string | null {
    const reports = this.getAllReports().reverse(); // oldest first
    for (const report of reports) {
      const test = report.tests.find(t => t.name === testName && t.status === 'failed');
      if (test) return report.timestamp;
    }
    return null;
  }

  /**
   * Classify failures from the latest report using historical data.
   *
   * Classification rules:
   *   flaky          – failed 3+ times in last 5 runs (intermittent)
   *   regression     – newly failing (1-2 recent failures, was passing before)
   *   environment-issue – error message suggests infra/DB/network problem
   *   new-failure    – first time seen failing
   */
  analyzeFailures(): FailureAnalysis[] {
    const latestReport = this.getLatestReport();
    if (!latestReport) return [];

    const failedTests = latestReport.tests.filter(t => t.status === 'failed');

    return failedTests.map(test => {
      const history = this.getTestHistory(test.name, 5);
      const failureCount = history.filter(t => t.status === 'failed').length;

      let classification: FailureAnalysis['classification'] = 'new-failure';

      if (failureCount >= 3) {
        classification = 'flaky';
      } else if (failureCount > 0) {
        classification = 'regression';
      } else if (this.looksLikeEnvironmentIssue(test.error ?? '')) {
        classification = 'environment-issue';
      }

      return {
        name: test.name,
        failureCount,
        lastFailureTime: latestReport.timestamp,
        classification,
        error: test.error ?? 'No error details captured'
      };
    });
  }

  /**
   * Heuristic: does the error message suggest an infra/DB/network problem
   * rather than a real application regression?
   */
  private looksLikeEnvironmentIssue(errorMessage: string): boolean {
    const lower = errorMessage.toLowerCase();
    return (
      lower.includes('connection refused') ||
      lower.includes('timeout') ||
      lower.includes('network') ||
      lower.includes('database') ||
      lower.includes('sql') ||
      lower.includes('unavailable') ||
      lower.includes('could not connect') ||
      lower.includes('mailosaur')
    );
  }

  /**
   * Persist a report as both latest.json and a timestamped history file.
   */
  saveReport(report: ExecutionReport): void {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const timestampedPath = path.join(this.reportsDir, `run-${timestamp}.json`);
      const latestPath      = path.join(this.reportsDir, 'latest.json');

      const json = JSON.stringify(report, null, 2);
      fs.writeFileSync(timestampedPath, json);
      fs.writeFileSync(latestPath, json);
    } catch (error) {
      console.error('Error saving report:', error);
    }
  }
}
