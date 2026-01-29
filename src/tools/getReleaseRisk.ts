/**
 * MCP Tool: Assess release risk based on test results
 */

import { PlaywrightService } from '../services/playwright.service.js';
import { PolicyService } from '../services/policy.service.js';
import type { ToolInput, ToolOutput, ReleaseRiskAssessment } from '../types/mcp.types.js';
import { getEnvironmentConfig } from '../config/environments.js';

let playwrightService: PlaywrightService | null = null;
let policyService: PolicyService | null = null;

/**
 * Initialize services
 */
function getServices(): { playwright: PlaywrightService; policy: PolicyService } {
  if (!playwrightService) {
    const config = getEnvironmentConfig();
    playwrightService = new PlaywrightService({
      projectRoot: config.playwrightProjectRoot,
      reportOutputDir: config.reportOutputDir
    });
  }

  if (!policyService) {
    const config = getEnvironmentConfig();
    policyService = new PolicyService(config.testEnvironment);
  }

  return { playwright: playwrightService, policy: policyService };
}

/**
 * Assess release risk based on test results and policies
 */
function assessRisk(data: {
  criticalFailures: string[];
  flakyTests: string[];
  regressions: string[];
  environmentIssues: string[];
  passRate: number;
  totalTests: number;
}, policyService: PolicyService): ReleaseRiskAssessment {
  const context = {
    criticalFailures: data.criticalFailures.length,
    flakyTests: data.flakyTests.length,
    regressions: data.regressions.length,
    environmentIssues: data.environmentIssues.length
  };

  // Validate against policies
  const validation = policyService.validateReleaseDecision(context);

  let risk: ReleaseRiskAssessment['risk'] = 'LOW';
  let recommendation = 'Proceed with deployment';

  // Determine risk level
  if (data.criticalFailures.length > 0) {
    risk = 'HIGH';
    recommendation = 'Do NOT proceed. Critical tests are failing.';
  } else if (data.regressions.length > 2) {
    risk = 'HIGH';
    recommendation = 'Do NOT proceed. Multiple regressions detected.';
  } else if (data.passRate < 0.95) {
    risk = 'MEDIUM';
    recommendation = 'Proceed with caution. Pass rate is below 95%.';
  } else if (data.flakyTests.length > 0) {
    risk = 'MEDIUM';
    recommendation = 'Proceed but monitor flaky tests in production.';
  } else if (data.environmentIssues.length > 0) {
    risk = 'LOW';
    recommendation = 'Proceed. Only environment-specific issues detected.';
  }

  // Override with policy validation
  if (!validation.allowed) {
    risk = 'HIGH';
    recommendation = 'Release blocked by QA policy.';
  }

  // Build summary
  let summary = `Pass rate: ${(data.passRate * 100).toFixed(1)}% (${data.totalTests} tests)`;
  if (data.criticalFailures.length > 0) {
    summary += ` | ${data.criticalFailures.length} critical failures`;
  }
  if (data.flakyTests.length > 0) {
    summary += ` | ${data.flakyTests.length} flaky test(s)`;
  }
  if (data.regressions.length > 0) {
    summary += ` | ${data.regressions.length} regression(s)`;
  }
  if (data.environmentIssues.length > 0) {
    summary += ` | ${data.environmentIssues.length} environment issue(s)`;
  }

  // Add policy warnings
  if (validation.warnings.length > 0) {
    summary += ` | Policies: ${validation.warnings.join('; ')}`;
  }

  return {
    risk,
    summary,
    recommendation,
    failedCriticalTests: data.criticalFailures,
    flakyTests: data.flakyTests,
    regressions: data.regressions,
    environmentIssues: data.environmentIssues
  };
}

/**
 * Format release risk assessment for display
 */
function formatRiskAssessment(assessment: ReleaseRiskAssessment): string {
  const riskIcon = {
    'LOW': '✅',
    'MEDIUM': '⚠️',
    'HIGH': '❌'
  }[assessment.risk];

  let output = `\n${riskIcon} **Release Risk: ${assessment.risk}**\n\n`;
  output += `**Recommendation:** ${assessment.recommendation}\n\n`;
  output += `**Summary:**\n${assessment.summary}\n\n`;

  if (assessment.failedCriticalTests.length > 0) {
    output += `**Failed Critical Tests (${assessment.failedCriticalTests.length}):**\n`;
    assessment.failedCriticalTests.forEach(test => {
      output += `  • ${test}\n`;
    });
    output += '\n';
  }

  if (assessment.flakyTests.length > 0) {
    output += `**Flaky Tests (${assessment.flakyTests.length}):**\n`;
    assessment.flakyTests.forEach(test => {
      output += `  • ${test}\n`;
    });
    output += '\n';
  }

  if (assessment.regressions.length > 0) {
    output += `**Regressions (${assessment.regressions.length}):**\n`;
    assessment.regressions.forEach(test => {
      output += `  • ${test}\n`;
    });
    output += '\n';
  }

  if (assessment.environmentIssues.length > 0) {
    output += `**Environment Issues (${assessment.environmentIssues.length}):**\n`;
    assessment.environmentIssues.forEach(test => {
      output += `  • ${test}\n`;
    });
    output += '\n';
  }

  return output;
}

/**
 * Get Release Risk Tool
 * Determines if a release is safe based on test results and policies
 */
export async function getReleaseRisk(input?: ToolInput): Promise<ToolOutput> {
  try {
    const { playwright, policy } = getServices();

    // Get the latest report
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

    // Get failure analysis
    const failures = playwright.analyzeFailures();

    // Categorize failures
    const criticalFailures: string[] = [];
    const flakyTests: string[] = [];
    const regressions: string[] = [];
    const environmentIssues: string[] = [];

    failures.forEach(failure => {
      if (failure.classification === 'flaky') {
        flakyTests.push(failure.name);
      } else if (failure.classification === 'regression') {
        regressions.push(failure.name);
      } else if (failure.classification === 'environment-issue') {
        environmentIssues.push(failure.name);
      } else if (failure.classification === 'new-failure') {
        // Check if test is critical
        const testResult = report.tests.find(t => t.name === failure.name);
        if (testResult?.tags.includes('critical')) {
          criticalFailures.push(failure.name);
        } else {
          regressions.push(failure.name);
        }
      }
    });

    // Calculate pass rate
    const passRate = report.totalTests > 0 ? report.passed / report.totalTests : 1;

    // Assess risk
    const assessment = assessRisk({
      criticalFailures,
      flakyTests,
      regressions,
      environmentIssues,
      passRate,
      totalTests: report.totalTests
    }, policy);

    const output = formatRiskAssessment(assessment);

    return {
      content: [{
        type: 'text',
        text: output
      }]
    };
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error assessing release risk: ${error.message}\n\nMake sure tests have been executed. Try running tests first with the 'run_tests' tool.`
      }],
      isError: true
    };
  }
}
