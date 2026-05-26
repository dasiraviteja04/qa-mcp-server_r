/**
 * MCP Tool: Assess release risk based on UIAutomationTests results and QA policies.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { fileURLToPath }  from 'url';
import { PlaywrightService } from '../services/playwright.service.js';
import { PolicyService }     from '../services/policy.service.js';
import type { ToolInput, ToolOutput, ReleaseRiskAssessment } from '../types/mcp.types.js';
import { getEnvironmentConfig }       from '../config/environments.js';
import type { RequirementsCoverage }  from '../types/requirements.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function loadRequirementsCoverage(projectName: string): RequirementsCoverage | null {
  try {
    const coveragePath = path.join(
      __dirname, '..', '..', 'memory', 'requirements',
      `${projectName}-coverage.json`
    );
    if (!fs.existsSync(coveragePath)) return null;
    return JSON.parse(fs.readFileSync(coveragePath, 'utf-8')) as RequirementsCoverage;
  } catch {
    return null;
  }
}

let playwrightService: PlaywrightService | null = null;
let policyService: PolicyService | null = null;

function getServices(): { playwright: PlaywrightService; policy: PolicyService } {
  const config = getEnvironmentConfig();

  if (!playwrightService) {
    playwrightService = new PlaywrightService({
      projectRoot:     config.playwrightProjectRoot,
      csprojFile:      config.csprojFile,
      runSettingsFile: config.runSettingsFile,
      reportOutputDir: config.reportOutputDir
    });
  }

  if (!policyService) {
    policyService = new PolicyService(config.name);
  }

  return { playwright: playwrightService, policy: policyService };
}

// Tags that belong to financially critical workflows (chargeoff, payoff, settlement…)
const FINANCIAL_CRITICAL_TAGS = new Set([
  'chargeoff', 'paidoffsettlement', 'ontracksettlement', 'payoff', 'partialpayment'
]);

function isFinancialCritical(tags: string[]): boolean {
  return tags.some(t => FINANCIAL_CRITICAL_TAGS.has(t.toLowerCase()));
}

function assessRisk(data: {
  criticalFailures: string[];         // @production test failures
  financialRegressions: string[];     // chargeoff / payoff / settlement regressions
  flakyTests: string[];
  regressions: string[];
  environmentIssues: string[];
  passRate: number;
  totalTests: number;
}, policyService: PolicyService): ReleaseRiskAssessment {

  const validation = policyService.validateReleaseDecision({
    criticalFailures:    data.criticalFailures.length,
    flakyTests:          data.flakyTests.length,
    regressions:         data.regressions.length,
    environmentIssues:   data.environmentIssues.length,
    financialRegressions: data.financialRegressions.length
  });

  let risk: ReleaseRiskAssessment['risk'] = 'LOW';
  let recommendation = 'Proceed with deployment';

  // Escalate risk based on findings
  if (data.criticalFailures.length > 0) {
    risk = 'HIGH';
    recommendation = 'Do NOT proceed. @production health-check tests are failing.';
  } else if (data.financialRegressions.length > 0) {
    risk = 'HIGH';
    recommendation = 'Do NOT proceed. Regressions detected in financial-critical workflows (chargeoff / payoff / settlement).';
  } else if (data.regressions.length > 2) {
    risk = 'HIGH';
    recommendation = 'Do NOT proceed. Multiple regressions detected – requires QA investigation.';
  } else if (data.passRate < 0.95) {
    risk = 'MEDIUM';
    recommendation = 'Proceed with caution. Pass rate is below 95% – QA sign-off required.';
  } else if (data.flakyTests.length > 0) {
    risk = 'MEDIUM';
    recommendation = 'Proceed with monitoring. Flaky tests detected – watch closely after deployment.';
  } else if (data.regressions.length > 0) {
    risk = 'MEDIUM';
    recommendation = 'Proceed with caution. Regression(s) detected – QA lead sign-off required.';
  } else if (data.environmentIssues.length > 0) {
    risk = 'LOW';
    recommendation = 'Proceed. Only environment-specific issues detected (DB / network / Mailosaur) – not code regressions.';
  }

  // Policy can override to blocked
  if (!validation.allowed) {
    risk = 'HIGH';
    recommendation = 'Release blocked by QA policy. See policy warnings below.';
  }

  // Build summary line
  let summary = `Pass rate: ${(data.passRate * 100).toFixed(1)}% (${data.totalTests} tests run)`;
  if (data.criticalFailures.length > 0)
    summary += ` | ${data.criticalFailures.length} production health-check failure(s)`;
  if (data.financialRegressions.length > 0)
    summary += ` | ${data.financialRegressions.length} financial regression(s)`;
  if (data.flakyTests.length > 0)
    summary += ` | ${data.flakyTests.length} flaky test(s)`;
  if (data.regressions.length > 0)
    summary += ` | ${data.regressions.length} regression(s)`;
  if (data.environmentIssues.length > 0)
    summary += ` | ${data.environmentIssues.length} environment issue(s)`;
  if (validation.warnings.length > 0)
    summary += ` | Policies: ${validation.warnings.join('; ')}`;

  return {
    risk,
    summary,
    recommendation,
    failedCriticalTests: [...data.criticalFailures, ...data.financialRegressions],
    flakyTests:          data.flakyTests,
    regressions:         data.regressions,
    environmentIssues:   data.environmentIssues
  };
}

function formatRiskAssessment(assessment: ReleaseRiskAssessment): string {
  const icon = { LOW: '✅', MEDIUM: '⚠️', HIGH: '❌' }[assessment.risk];

  let output = `\n${icon} **Release Risk: ${assessment.risk}**\n\n`;
  output += `**Recommendation:** ${assessment.recommendation}\n\n`;
  output += `**Summary:** ${assessment.summary}\n\n`;

  if (assessment.failedCriticalTests.length > 0) {
    output += `**Failed Critical Tests (${assessment.failedCriticalTests.length}):**\n`;
    assessment.failedCriticalTests.forEach(t => { output += `  • ${t}\n`; });
    output += '\n';
  }

  if (assessment.regressions.length > 0) {
    output += `**Regressions (${assessment.regressions.length}):**\n`;
    assessment.regressions.forEach(t => { output += `  • ${t}\n`; });
    output += '\n';
  }

  if (assessment.flakyTests.length > 0) {
    output += `**Flaky Tests (${assessment.flakyTests.length}):**\n`;
    assessment.flakyTests.forEach(t => { output += `  • ${t}\n`; });
    output += '\n';
  }

  if (assessment.environmentIssues.length > 0) {
    output += `**Environment Issues (${assessment.environmentIssues.length}):**\n`;
    assessment.environmentIssues.forEach(t => { output += `  • ${t}\n`; });
    output += '\n';
  }

  return output;
}

/**
 * Get Release Risk Tool
 * Reads the latest test report, applies financial-domain QA policies,
 * and returns a LOW / MEDIUM / HIGH risk assessment with recommendation.
 *
 * Also checks memory/requirements/{project_name}-coverage.json when
 * project_name is supplied — failing/uncovered requirements escalate risk.
 */
export async function getReleaseRisk(
  input?: ToolInput & { project_name?: string }
): Promise<ToolOutput> {
  try {
    const { playwright, policy } = getServices();

    const report = playwright.getLatestReport();
    if (!report) {
      return {
        content: [{
          type: 'text',
          text: 'No test report found. Please run tests first using the run_tests tool.'
        }],
        isError: true
      };
    }

    const failures = playwright.analyzeFailures();

    // Bucket failures by category
    const criticalFailures:    string[] = [];  // @production tests
    const financialRegressions: string[] = []; // chargeoff / payoff / settlement
    const flakyTests:          string[] = [];
    const regressions:         string[] = [];
    const environmentIssues:   string[] = [];

    for (const failure of failures) {
      const testResult = report.tests.find(t => t.name === failure.name);
      const tags = testResult?.tags ?? [];

      if (failure.classification === 'flaky') {
        flakyTests.push(failure.name);
      } else if (failure.classification === 'environment-issue') {
        environmentIssues.push(failure.name);
      } else {
        // regression or new-failure – check if it's production-critical or financial-critical
        if (tags.includes('production')) {
          criticalFailures.push(failure.name);
        } else if (isFinancialCritical(tags)) {
          financialRegressions.push(failure.name);
        } else {
          regressions.push(failure.name);
        }
      }
    }

    const passRate = report.totalTests > 0
      ? report.passed / report.totalTests
      : 1;

    const assessment = assessRisk({
      criticalFailures,
      financialRegressions,
      flakyTests,
      regressions,
      environmentIssues,
      passRate,
      totalTests: report.totalTests
    }, policy);

    let output = formatRiskAssessment(assessment);

    // ── Requirements check (additive — skipped when no coverage file exists) ──
    if (input?.project_name) {
      const reqCoverage = loadRequirementsCoverage(input.project_name);
      if (reqCoverage) {
        const reqLines: string[] = ['\n**Requirements Traceability:**'];

        if (reqCoverage.failingRequirements.length > 0) {
          // Failing requirements escalate to HIGH risk
          if (assessment.risk !== 'HIGH') {
            assessment.risk = 'HIGH';
          }
          reqLines.push(
            `  ❌ ${reqCoverage.failingRequirements.length} requirement(s) failing: ` +
            reqCoverage.failingRequirements.join(', ')
          );
        }

        if (reqCoverage.notCoveredRequirements.length > 0) {
          if (assessment.risk === 'LOW') assessment.risk = 'MEDIUM';
          reqLines.push(
            `  ⚠️  ${reqCoverage.notCoveredRequirements.length} requirement(s) have no tests: ` +
            reqCoverage.notCoveredRequirements.slice(0, 8).join(', ') +
            (reqCoverage.notCoveredRequirements.length > 8 ? '…' : '')
          );
        }

        if (
          reqCoverage.failingRequirements.length === 0 &&
          reqCoverage.notCoveredRequirements.length === 0
        ) {
          reqLines.push(
            `  ✅ All ${reqCoverage.summary.total} requirements covered and passing ` +
            `(${reqCoverage.summary.coveragePercent}%)`
          );
        }

        reqLines.push(
          `\n  Coverage: ${reqCoverage.summary.covered}/${reqCoverage.summary.total} ` +
          `(${reqCoverage.summary.coveragePercent}%) — ` +
          `run generate_html_report for full traceability matrix.`
        );

        output += reqLines.join('\n');
      }
    }

    return {
      content: [{ type: 'text', text: output }]
    };
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error assessing release risk: ${error.message}\n\nRun tests first with the 'run_tests' tool.`
      }],
      isError: true
    };
  }
}
