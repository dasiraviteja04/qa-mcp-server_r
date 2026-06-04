/**
 * AnalysisService — Phase 1 of the capability-based orchestration.
 *
 * Combines failure classification, deep research investigation, coverage gap
 * analysis, and release risk assessment into a single typed result.
 *
 * Execution strategy (lazy + parallel):
 *   1. Failures     — always fetched (synchronous read from latest.json)
 *   2. Coverage + Risk — run in parallel via Promise.allSettled
 *                        (both are independent I/O: git + SQL)
 *   3. Research     — sequential after failures
 *                        (depends on failure classification)
 *                        SKIPPED for persistent failures known to memory
 *
 * Memory integration:
 *   - Each classified failure is saved to MemoryService (fire-and-forget)
 *   - isPersistentFailure() short-circuits Research for known persistent bugs
 *   - Coverage gaps are saved to MemoryService for trend analysis
 *
 * No MCP tools are called here. Services are used directly to avoid
 * the tool → service → tool double-wrapping anti-pattern.
 */

import { ReportService } from './report.service.js';
import { GitService } from './git.service.js';
import { CoverageService } from './coverage.service.js';
import { ResearchService } from './research.service.js';
import { PolicyService } from './policy.service.js';
import { PlaywrightService } from './playwright.service.js';
import { MemoryService } from './memory.service.js';
import { getEnvironmentConfig } from '../config/environments.js';
import type { ExecutionReport, FailureAnalysis, ReleaseRiskAssessment } from '../types/mcp.types.js';
import type { ResearchReport, CoverageGap } from '../types/research.types.js';
import type { AnalysisResult, AnalysisSignals, QAContext } from '../types/qa-context.types.js';
import type { MemoryFailureClassification } from '../types/memory.types.js';

// Maps FailureAnalysis classification → MemoryFailureClassification
// (FailureAnalysis uses 'environment-issue'; memory layer uses shorter 'env-issue')
function toMemoryClassification(
  c: FailureAnalysis['classification'],
): MemoryFailureClassification {
  if (c === 'environment-issue') return 'env-issue';
  return c; // 'flaky' | 'regression' | 'new-failure' are identical in both types
}

// Tags that belong to financially critical workflows
const FINANCIAL_CRITICAL_TAGS = new Set([
  'chargeoff', 'paidoffsettlement', 'ontracksettlement', 'payoff', 'partialpayment',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Signal derivation — typed, replaces raw string scanning
// ─────────────────────────────────────────────────────────────────────────────

function deriveSignals(
  failures:    FailureAnalysis[],
  coverage:    CoverageGap[],
  research:    ResearchReport | undefined,
  risk:        ReleaseRiskAssessment | undefined,
  context:     Pick<QAContext, 'featureArea' | 'pageUrl'>,
): AnalysisSignals {
  const hasRegressions =
    failures.some(f => f.classification === 'regression' || f.classification === 'new-failure') ||
    (research?.findings.some(f => f.type === 'new-regression') ?? false);

  const hasCriticalGaps = coverage.some(g => g.scenarioCount === 0);
  const hasPartialGaps  = coverage.some(g => g.scenarioCount > 0 && g.scenarioCount < 2);

  // DB methods needed when gap areas touch service / audit / repo layers
  const areaLower = context.featureArea.toLowerCase();
  const needsDBMethods =
    coverage.some(g =>
      g.area.toLowerCase().includes('audit')      ||
      g.area.toLowerCase().includes('coupon')     ||
      g.changedFile.toLowerCase().includes('service') ||
      g.changedFile.toLowerCase().includes('repository')
    ) ||
    areaLower.includes('audit') ||
    areaLower.includes('coupon');

  return {
    hasFailures:               failures.length > 0,
    hasRegressions,
    hasEnvIssues:              failures.some(f => f.classification === 'environment-issue'),
    hasFlaky:                  failures.some(f => f.classification === 'flaky'),
    isHighRisk:
      risk?.risk === 'HIGH'                      ||
      research?.releaseVerdict === 'BLOCK'       ||
      research?.releaseVerdict === 'CAUTION',
    hasCriticalGaps,
    hasPartialGaps,
    hasCoverageGaps:           hasCriticalGaps || hasPartialGaps,
    needsUIArtifacts:          !!context.pageUrl,
    needsDBMethods,
    isNewModule:               hasCriticalGaps,
    featureExistsStepsMissing: false, // updated by orchestrator after DiscoveryService runs
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk assessment (inline — avoids calling the getReleaseRisk MCP tool)
// ─────────────────────────────────────────────────────────────────────────────

function buildRiskAssessment(
  failures:       FailureAnalysis[],
  report:         ExecutionReport,
  policyService:  PolicyService,
): ReleaseRiskAssessment {
  const criticalFailures:     string[] = [];
  const financialRegressions: string[] = [];
  const flakyTests:           string[] = [];
  const regressions:          string[] = [];
  const environmentIssues:    string[] = [];

  for (const failure of failures) {
    const testResult = report.tests.find(t => t.name === failure.name);
    const tags       = testResult?.tags ?? [];

    if (failure.classification === 'flaky') {
      flakyTests.push(failure.name);
    } else if (failure.classification === 'environment-issue') {
      environmentIssues.push(failure.name);
    } else if (tags.includes('production')) {
      criticalFailures.push(failure.name);
    } else if (tags.some(t => FINANCIAL_CRITICAL_TAGS.has(t.toLowerCase()))) {
      financialRegressions.push(failure.name);
    } else {
      regressions.push(failure.name);
    }
  }

  const passRate = report.totalTests > 0 ? report.passed / report.totalTests : 1;

  const validation = policyService.validateReleaseDecision({
    criticalFailures:     criticalFailures.length,
    flakyTests:           flakyTests.length,
    regressions:          regressions.length,
    environmentIssues:    environmentIssues.length,
    financialRegressions: financialRegressions.length,
  });

  let risk: ReleaseRiskAssessment['risk'] = 'LOW';
  let recommendation = 'Proceed with deployment';

  if (criticalFailures.length > 0) {
    risk = 'HIGH';
    recommendation = 'Do NOT proceed. @production health-check tests are failing.';
  } else if (financialRegressions.length > 0) {
    risk = 'HIGH';
    recommendation = 'Do NOT proceed. Regressions detected in financial-critical workflows.';
  } else if (regressions.length > 2) {
    risk = 'HIGH';
    recommendation = 'Do NOT proceed. Multiple regressions detected — requires QA investigation.';
  } else if (passRate < 0.95) {
    risk = 'MEDIUM';
    recommendation = 'Proceed with caution. Pass rate is below 95% — QA sign-off required.';
  } else if (flakyTests.length > 0) {
    risk = 'MEDIUM';
    recommendation = 'Proceed with monitoring. Flaky tests detected.';
  } else if (regressions.length > 0) {
    risk = 'MEDIUM';
    recommendation = 'Proceed with caution. Regression(s) detected — QA lead sign-off required.';
  } else if (!validation.allowed) {
    risk = 'HIGH';
    recommendation = 'Release blocked by QA policy. See policy warnings below.';
  }

  const summary =
    `Pass rate: ${(passRate * 100).toFixed(1)}% (${report.totalTests} tests)` +
    (criticalFailures.length    ? ` | ${criticalFailures.length} production failure(s)`    : '') +
    (financialRegressions.length ? ` | ${financialRegressions.length} financial regression(s)` : '') +
    (flakyTests.length           ? ` | ${flakyTests.length} flaky test(s)`                  : '') +
    (regressions.length          ? ` | ${regressions.length} regression(s)`                 : '') +
    (environmentIssues.length    ? ` | ${environmentIssues.length} environment issue(s)`    : '') +
    (validation.warnings.length  ? ` | Policies: ${validation.warnings.join('; ')}`         : '');

  return {
    risk,
    summary,
    recommendation,
    failedCriticalTests: [...criticalFailures, ...financialRegressions],
    flakyTests,
    regressions,
    environmentIssues,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AnalysisService
// ─────────────────────────────────────────────────────────────────────────────

export class AnalysisService {
  /**
   * Runs lazy, selective analysis of the current test state.
   *
   * Execution order:
   *   1. Failures      — synchronous read, always performed
   *   2. Coverage + Risk — parallel I/O (git + SQL), skipped when not needed
   *   3. Research      — sequential, only when regressions are found
   *
   * @param context  Slice of QAContext with inputs needed for analysis
   * @returns        AnalysisResult with typed failures, research, coverage, risk, signals
   */
  async analyzeSystem(
    context: Pick<QAContext, 'featureArea' | 'pageUrl' | 'isReleaseCheck'>,
  ): Promise<AnalysisResult> {
    const config = getEnvironmentConfig();

    // ── Instantiate services (no MCP tool calls) ──────────────────────────
    const reportService     = new ReportService(config.reportOutputDir);
    const playwrightService = new PlaywrightService({
      projectRoot:     config.playwrightProjectRoot,
      reportOutputDir: config.reportOutputDir,
    });
    const gitService        = new GitService(config.playwrightProjectRoot);
    const appGitService     = config.appCodeRoot
      ? new GitService(config.appCodeRoot)
      : undefined;
    const coverageService   = new CoverageService(
      config.featuresDir,
      config.playwrightProjectRoot,
    );
    const memoryService     = new MemoryService(config.reportOutputDir);

    // ── Step 1: Failures (synchronous — reads latest.json) ────────────────
    const failures: FailureAnalysis[] = playwrightService.analyzeFailures();

    // Fire-and-forget: persist each failure to memory for trend analysis
    for (const failure of failures) {
      const failureEntry: Parameters<typeof memoryService.saveFailure>[0] = {
        testName:       failure.name,
        classification: toMemoryClassification(failure.classification),
        error:          failure.error.slice(0, 200),
      };
      if (context.featureArea.length > 0) failureEntry.featureArea = context.featureArea;
      memoryService.saveFailure(failureEntry);
    }

    const hasRegressions = failures.some(
      f => f.classification === 'regression' || f.classification === 'new-failure',
    );

    // Memory check: skip research if ALL regression failures are persistent known bugs
    const regressionFailures = failures.filter(
      f => f.classification === 'regression' || f.classification === 'new-failure',
    );
    const allPersistent =
      regressionFailures.length > 0 &&
      regressionFailures.every(f => memoryService.isPersistentFailure(f.name));

    const shouldCheckCoverage = context.featureArea.length > 0 || hasRegressions;
    const shouldCheckRisk     = context.isReleaseCheck;

    // ── Step 2: Coverage + Risk in parallel (independent I/O) ─────────────
    const [coverageSettled, riskSettled] = await Promise.allSettled([

      // Coverage — only when a feature area is given or regressions exist
      (async (): Promise<CoverageGap[]> => {
        if (!shouldCheckCoverage) return [];
        const testCommits = await gitService.getRecentCommits(14);
        const appCommits  = appGitService
          ? await appGitService.getRecentCommits(14)
          : [];
        // Deduplicate commits from both repos
        const seen = new Set<string>();
        const allCommits = [...testCommits, ...appCommits].filter(c => {
          if (seen.has(c.hash)) return false;
          seen.add(c.hash);
          return true;
        });
        return coverageService.findGaps(allCommits);
      })(),

      // Risk — only on explicit release gate check
      (async (): Promise<ReleaseRiskAssessment | undefined> => {
        if (!shouldCheckRisk) return undefined;
        const latestReport = reportService.getLatestReport();
        if (!latestReport) return undefined;
        const policyService = new PolicyService(config.name);
        return buildRiskAssessment(failures, latestReport, policyService);
      })(),
    ]);

    const coverage: CoverageGap[] =
      coverageSettled.status === 'fulfilled' ? coverageSettled.value : [];
    const risk: ReleaseRiskAssessment | undefined =
      riskSettled.status === 'fulfilled' ? riskSettled.value : undefined;

    // Fire-and-forget: persist coverage gaps for chronic gap detection
    for (const gap of coverage) {
      memoryService.saveCoverage({
        featureArea:   gap.area,
        scenarioCount: gap.scenarioCount,
        missingAreas:  [],            // populated externally if known; CoverageGap has no field
      });
    }

    // Fire-and-forget: persist risk assessment if performed
    if (risk) {
      const area = context.featureArea || 'global';
      memoryService.saveRisk({
        area,
        riskLevel: risk.risk,
        verdict:   risk.risk === 'HIGH' ? 'BLOCK' : risk.risk === 'MEDIUM' ? 'CAUTION' : 'SAFE',
      });
    }

    // ── Step 3: Research (sequential — depends on failure classification) ──
    // Skipped when ALL regression failures are known persistent bugs
    let research: ResearchReport | undefined;

    if (failures.length > 0 && hasRegressions && !allPersistent) {
      const latestReport = reportService.getLatestReport();
      if (latestReport) {
        const researchService = new ResearchService(
          reportService,
          gitService,
          coverageService,
          config.playwrightProjectRoot,
          appGitService,
        );
        research = await researchService.investigate(latestReport);
      }
    } else if (allPersistent) {
      console.error(
        `[AnalysisService] Skipping deep research — all regressions are known persistent failures`,
      );
    }

    // ── Step 4: Derive typed signals ──────────────────────────────────────
    const signals = deriveSignals(failures, coverage, research, risk, context);

    const result: AnalysisResult = { failures, coverage, signals };
    if (research !== undefined) result.research = research;
    if (risk     !== undefined) result.risk     = risk;
    return result;
  }
}
