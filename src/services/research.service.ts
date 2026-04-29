/**
 * ResearchService — the AutoResearch loop engine.
 *
 * Orchestrates up to MAX_ITERATIONS investigation passes over a completed
 * test run and returns a ResearchReport with findings, coverage gaps,
 * a release verdict, and concrete next steps.
 *
 * Iteration schedule:
 *   1. Classify every failure (always runs)
 *   2. Git correlation for regressions (runs if regressions found)
 *   3. Flakiness history scan (always runs)
 *   4. Coverage gap analysis (always runs)
 *   5. Build verdict + next steps (always runs)
 */

import type { ExecutionReport, FailureAnalysis } from '../types/mcp.types.js';
import type {
  ResearchFinding, ResearchReport, CoverageGap, GitCommit
} from '../types/research.types.js';
import { ReportService } from './report.service.js';
import { GitService } from './git.service.js';
import { CoverageService } from './coverage.service.js';

const MAX_ITERATIONS = 5;

// Error patterns that indicate infrastructure problems, not code regressions
const ENV_ISSUE_PATTERNS = [
  'connection refused', 'connection reset', 'err_connection',
  'timeout', 'network', 'sql', 'database', 'mailosaur',
  'unavailable', 'could not connect', 'firewall', 'vpn'
];

export class ResearchService {
  constructor(
    private reportService: ReportService,
    private gitService: GitService,
    private coverageService: CoverageService,
    private projectRoot: string
  ) {}

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  async investigate(executionReport: ExecutionReport): Promise<ResearchReport> {
    const findings: ResearchFinding[] = [];
    const gaps: CoverageGap[] = [];
    let iterations = 0;

    // ── Iteration 1: Classify every failure ────────────────────────────────
    const failureAnalyses = this.reportService.analyzeFailures();
    for (const fa of failureAnalyses) {
      findings.push(this.classifyFailure(fa, executionReport));
    }
    iterations++;

    // ── Iteration 2: Git correlation for new-regressions ───────────────────
    const regressionFindings = findings.filter(
      f => f.type === 'new-regression' || f.type === 'failure-root-cause'
    );
    let recentCommits: GitCommit[] = [];

    if (this.gitService.isGitAvailable()) {
      try {
        recentCommits = await this.gitService.getRecentCommits(14);
        if (regressionFindings.length > 0 && recentCommits.length > 0) {
          const gitFindings = this.correlateWithGit(regressionFindings, recentCommits);
          findings.push(...gitFindings);
        }
      } catch { /* git unavailable — skip */ }
    }
    iterations++;

    // ── Iteration 3: Flakiness history ─────────────────────────────────────
    const flakinessMap = this.reportService.getFlakinessMap();
    for (const [testName, rate] of flakinessMap) {
      if (rate >= 40) {
        // Only add if not already classified as flaky from analyzeFailures
        const alreadyFound = findings.some(
          f => f.testName === testName && f.type === 'flaky-pattern'
        );
        if (!alreadyFound) {
          findings.push({
            type: 'flaky-pattern',
            testName,
            severity: rate >= 70 ? 'high' : 'medium',
            title: `${testName} is historically flaky (${rate}% failure rate)`,
            detail: `This test has failed in ${rate}% of all stored historical runs, suggesting an intermittent issue rather than a hard regression.`,
            evidence: [`Historical failure rate: ${rate}% across all stored run reports`],
            suggestedAction: 'Investigate test isolation — likely auth state expiry, timing, or shared state between scenarios'
          });
        }
      }
    }
    iterations++;

    // ── Iteration 4: Coverage gaps ──────────────────────────────────────────
    if (recentCommits.length > 0) {
      const coverageGaps = this.coverageService.findGaps(recentCommits);
      gaps.push(...coverageGaps);
    } else {
      // No git — still try a static scan of the features dir
      const staticGap = this.staticCoverageCheck(executionReport);
      gaps.push(...staticGap);
    }
    iterations++;

    // ── Iteration 5: Verdict + next steps ──────────────────────────────────
    const { verdict, reason } = this.determineVerdict(findings, executionReport);
    const nextSteps = this.buildNextSteps(findings, gaps);
    iterations++;

    return {
      runId: executionReport.id,
      researchedAt: new Date().toISOString(),
      iterationsUsed: Math.min(iterations, MAX_ITERATIONS),
      totalTests: executionReport.totalTests,
      passed: executionReport.passed,
      failed: executionReport.failed,
      findings,
      coverageGaps: gaps,
      releaseVerdict: verdict,
      verdictReason: reason,
      suggestedNextSteps: nextSteps
    };
  }

  // ---------------------------------------------------------------------------
  // Iteration 1 helpers
  // ---------------------------------------------------------------------------

  private classifyFailure(
    fa: FailureAnalysis,
    report: ExecutionReport
  ): ResearchFinding {
    const error = (fa.error ?? '').toLowerCase();
    const isEnvIssue = ENV_ISSUE_PATTERNS.some(p => error.includes(p));

    if (isEnvIssue) {
      return {
        type: 'env-issue',
        testName: fa.name,
        severity: 'medium',
        title: `${fa.name} — infrastructure / environment issue`,
        detail: `Error message indicates a network, database, or environment problem rather than an application regression.`,
        evidence: [
          `Error: ${fa.error?.substring(0, 200) ?? 'no error captured'}`,
          `Classification: ${fa.classification}`
        ],
        suggestedAction: 'Check VPN connectivity, SQL Server firewall rules, and environment health before re-running'
      };
    }

    if (fa.classification === 'flaky') {
      return {
        type: 'flaky-pattern',
        testName: fa.name,
        severity: 'medium',
        title: `${fa.name} — flaky (failed ${fa.failureCount} of last 5 runs)`,
        detail: `This test has failed intermittently. Not a definitive regression but should be investigated for stability.`,
        evidence: [`Failed ${fa.failureCount} times in last 5 runs`],
        suggestedAction: 'Check for shared state, timing issues, or auth token expiry between scenarios'
      };
    }

    const pattern = this.reportService.getRegressionPattern(fa.name);
    const firstFailDate = this.reportService.getFirstFailureDate(fa.name);

    if (pattern === 'newly-failing') {
      return {
        type: 'new-regression',
        testName: fa.name,
        severity: 'high',
        title: `${fa.name} — NEW regression`,
        detail: `This test was previously passing and has started failing. This is a definitive regression that needs investigation.`,
        evidence: [
          `Pattern: newly-failing`,
          ...(firstFailDate ? [`First failure seen: ${new Date(firstFailDate).toLocaleString()}`] : []),
          `Error: ${fa.error?.substring(0, 200) ?? 'no error captured'}`
        ],
        suggestedAction: 'Check recent commits for changes to the related feature area. Use git correlation findings below.'
      };
    }

    return {
      type: 'failure-root-cause',
      testName: fa.name,
      severity: fa.classification === 'new-failure' ? 'critical' : 'high',
      title: `${fa.name} — ${fa.classification.replace('-', ' ')}`,
      detail: `Test failure requiring investigation.`,
      evidence: [`Error: ${fa.error?.substring(0, 200) ?? 'no error captured'}`],
      suggestedAction: 'Review error message and screenshot. Check if related application functionality is working.'
    };
  }

  // ---------------------------------------------------------------------------
  // Iteration 2 helpers
  // ---------------------------------------------------------------------------

  private correlateWithGit(
    regressionFindings: ResearchFinding[],
    commits: GitCommit[]
  ): ResearchFinding[] {
    const gitFindings: ResearchFinding[] = [];

    for (const finding of regressionFindings) {
      if (!finding.testName) continue;

      // Derive a feature-area keyword from the test name
      // e.g. "UpdateEndDateViaUICreatesAnEDITAuditLogEntry" → "AuditLog", "EndDate"
      const keywords = this.extractKeywords(finding.testName);

      for (const commit of commits.slice(0, 20)) { // limit to 20 most recent
        const matchedFiles = commit.filesChanged.filter(f =>
          keywords.some(kw => f.toLowerCase().includes(kw.toLowerCase()))
        );

        if (matchedFiles.length > 0) {
          gitFindings.push({
            type: 'git-correlation',
            testName: finding.testName,
            severity: 'critical',
            title: `Possible root cause: commit ${commit.hash.substring(0, 7)} touched ${matchedFiles[0]}`,
            detail: `A recent commit changed files that are likely related to this failing test. This may be the root cause of the regression.`,
            evidence: [
              `Commit: ${commit.hash.substring(0, 7)} by ${commit.author} on ${new Date(commit.date).toLocaleDateString()}`,
              `Message: "${commit.message}"`,
              `Related files changed: ${matchedFiles.slice(0, 3).join(', ')}`
            ],
            suggestedAction: `Review commit ${commit.hash.substring(0, 7)} ("${commit.message}"). Consider reverting or fixing the introduced change.`
          });
          break; // one correlation per failing test is enough
        }
      }
    }

    return gitFindings;
  }

  private extractKeywords(testName: string): string[] {
    // Split PascalCase into words: "UpdateEndDate" → ["Update", "End", "Date"]
    const words = testName
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 3); // skip short words like "Via", "The", "And"

    // Also include common domain abbreviations
    const domainKeywords = words
      .filter(w => !['Creates', 'Should', 'Entry', 'Exist', 'Have', 'When', 'With', 'That',
                     'Test', 'Tests', 'After', 'Before', 'Given', 'Then', 'Does'].includes(w));

    return [...new Set(domainKeywords)];
  }

  // ---------------------------------------------------------------------------
  // Iteration 4 helpers (static fallback)
  // ---------------------------------------------------------------------------

  private staticCoverageCheck(report: ExecutionReport): CoverageGap[] {
    // Without git, we can only check if failing tests have very few scenarios
    // We return empty — git is required for meaningful gap analysis
    return [];
  }

  // ---------------------------------------------------------------------------
  // Iteration 5 helpers
  // ---------------------------------------------------------------------------

  private determineVerdict(
    findings: ResearchFinding[],
    report: ExecutionReport
  ): { verdict: 'SAFE' | 'CAUTION' | 'BLOCK'; reason: string } {

    const criticals = findings.filter(f => f.severity === 'critical');
    const highs     = findings.filter(f => f.severity === 'high');
    const gitCorrelations = findings.filter(f => f.type === 'git-correlation');
    const newRegressions  = findings.filter(f => f.type === 'new-regression');
    const envIssues       = findings.filter(f => f.type === 'env-issue');

    // All failures are env issues — safe to release
    if (report.failed > 0 && report.failed === envIssues.length) {
      return {
        verdict: 'CAUTION',
        reason: `All ${report.failed} failure(s) classified as environment/infrastructure issues, not code regressions. Monitor after deployment.`
      };
    }

    // Git correlation found — definitive regression
    if (gitCorrelations.length > 0 || newRegressions.length > 0) {
      const linked = gitCorrelations.length > 0
        ? gitCorrelations[0]!.evidence[0] ?? ''
        : '';
      return {
        verdict: 'BLOCK',
        reason: `${newRegressions.length + gitCorrelations.length} regression(s) detected${linked ? ` — ${linked}` : ''}. Fix before releasing.`
      };
    }

    // Critical failures
    if (criticals.length > 0) {
      return {
        verdict: 'BLOCK',
        reason: `${criticals.length} critical failure(s) detected. Requires immediate investigation.`
      };
    }

    // High severity findings
    if (highs.length > 2) {
      return {
        verdict: 'BLOCK',
        reason: `${highs.length} high-severity failures detected. Pass rate may be too low for safe release.`
      };
    }

    // Pass rate below 90%
    const passRate = report.totalTests > 0 ? report.passed / report.totalTests : 1;
    if (passRate < 0.90) {
      return {
        verdict: 'BLOCK',
        reason: `Pass rate ${(passRate * 100).toFixed(1)}% is below the 90% threshold.`
      };
    }

    if (passRate < 0.95) {
      return {
        verdict: 'CAUTION',
        reason: `Pass rate ${(passRate * 100).toFixed(1)}% is below 95%. QA sign-off recommended.`
      };
    }

    if (report.failed === 0) {
      return { verdict: 'SAFE', reason: 'All tests passed. No regressions detected.' };
    }

    return {
      verdict: 'CAUTION',
      reason: `${report.failed} failure(s) detected but no definitive regressions found. Review manually.`
    };
  }

  private buildNextSteps(
    findings: ResearchFinding[],
    gaps: CoverageGap[]
  ): string[] {
    const steps: string[] = [];

    // Git correlations — highest priority
    for (const f of findings.filter(f => f.type === 'git-correlation')) {
      steps.push(f.suggestedAction);
    }

    // New regressions
    for (const f of findings.filter(f => f.type === 'new-regression')) {
      steps.push(`Re-run failing test after fix: run_tests({ scenario: '${f.testName?.substring(0, 40)}' })`);
    }

    // Critical coverage gaps
    for (const gap of gaps.filter(g => g.scenarioCount === 0).slice(0, 3)) {
      steps.push(`Add test coverage: ${gap.recommendation}`);
    }

    // Partial coverage gaps
    for (const gap of gaps.filter(g => g.scenarioCount > 0).slice(0, 2)) {
      steps.push(`Improve coverage: ${gap.recommendation}`);
    }

    // Flaky tests
    const flaky = findings.filter(f => f.type === 'flaky-pattern');
    if (flaky.length > 0) {
      steps.push(`Investigate ${flaky.length} flaky test(s) for timing/isolation issues`);
    }

    return steps.slice(0, 8); // max 8 next steps
  }
}
