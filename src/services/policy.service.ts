/**
 * QA Governance Policies for UIAutomationTests (explorecredit financial platform).
 */

import type { QAPolicy } from '../types/mcp.types.js';

export const DEFAULT_POLICIES: QAPolicy[] = [
  {
    // @production health-check failures always block any release
    name: 'production-healthcheck-blocks-release',
    description: 'Block release if @production health-check tests fail. These tests verify core production paths (CSRD, LMS, VPortal).',
    enabled: true,
    action: 'block'
  },
  {
    // Any regression in a core financial flow (chargeoff, payoff, settlement) blocks release
    name: 'financial-regression-blocks-release',
    description: 'Block release on regressions in critical financial workflows: chargeoff, payoff, paidoffsettlement, ontracksettlement.',
    enabled: true,
    action: 'block'
  },
  {
    // General regression failures warn but do not hard-block (need QA sign-off)
    name: 'regression-failures-require-signoff',
    description: 'Regression test failures require QA lead sign-off before release proceeds.',
    enabled: true,
    action: 'warn'
  },
  {
    // Flaky tests warn – intermittent failures should be monitored but do not block
    name: 'flaky-tests-warn',
    description: 'Warn about flaky tests (failed 3+ times in last 5 runs). Monitor after deployment.',
    enabled: true,
    action: 'warn'
  },
  {
    // DB/infrastructure failures are environment issues, not code regressions – allow with note
    name: 'environment-issues-allow',
    description: 'Allow release for failures caused by DB timeouts, Mailosaur outages, or infra issues – not code regressions.',
    enabled: true,
    action: 'allow'
  },
  {
    // AI (Claude) may only suggest actions; actual test execution must be human-triggered in prod
    name: 'ai-suggestions-readonly',
    description: 'In production, AI can analyse results and suggest actions but cannot auto-trigger test runs.',
    enabled: true,
    action: 'allow'
  },
  {
    // Auto-healing selectors must not run in production to prevent unintended DOM mutations
    name: 'self-healing-disabled-prod',
    description: 'Disable auto-healing selector logic in production. Self-healing is permitted in dev/staging/qafence only.',
    enabled: true,
    action: 'block'
  }
];

// Tags that belong to financially critical workflows
const FINANCIAL_CRITICAL_TAGS = new Set([
  'chargeoff', 'paidoffsettlement', 'ontracksettlement', 'payoff', 'partialpayment'
]);

export class PolicyService {
  private policies: Map<string, QAPolicy>;
  private environment: string;

  constructor(environment: string = process.env.TEST_ENV || 'development') {
    this.environment = environment;
    this.policies = new Map();
    this.loadDefaultPolicies();
  }

  private loadDefaultPolicies(): void {
    for (const policy of DEFAULT_POLICIES) {
      this.policies.set(policy.name, { ...policy });
    }
  }

  isPolicyEnabled(policyName: string): boolean {
    return this.policies.get(policyName)?.enabled ?? false;
  }

  getPolicyAction(policyName: string): QAPolicy['action'] | null {
    return this.policies.get(policyName)?.action ?? null;
  }

  /**
   * Should a release be blocked due to critical test failures?
   * Blocks if: any @production test failed, OR any financial-critical test failed.
   */
  shouldBlockOnCriticalFailure(hasCriticalFailures: boolean): boolean {
    if (!hasCriticalFailures) return false;
    return this.getPolicyAction('production-healthcheck-blocks-release') === 'block';
  }

  /**
   * Should a release be blocked due to a financial workflow regression?
   */
  shouldBlockOnFinancialRegression(testTags: string[]): boolean {
    if (!this.isPolicyEnabled('financial-regression-blocks-release')) return false;
    return testTags.some(tag => FINANCIAL_CRITICAL_TAGS.has(tag.toLowerCase()));
  }

  shouldWarnAboutFlaky(hasFlaky: boolean): boolean {
    if (!hasFlaky) return false;
    return this.isPolicyEnabled('flaky-tests-warn');
  }

  /**
   * Evaluate the full set of test results and produce a release decision.
   */
  validateReleaseDecision(context: {
    criticalFailures: number;
    flakyTests: number;
    regressions: number;
    environmentIssues: number;
    financialRegressions?: number;
  }): { allowed: boolean; warnings: string[] } {
    const warnings: string[] = [];
    let allowed = true;

    // @production health-check failures hard-block
    if (context.criticalFailures > 0 && this.shouldBlockOnCriticalFailure(true)) {
      allowed = false;
      warnings.push(
        `${context.criticalFailures} @production health-check failure(s) detected. Release blocked by policy.`
      );
    }

    // Financial workflow regressions hard-block
    const finRegressions = context.financialRegressions ?? 0;
    if (finRegressions > 0 && this.isPolicyEnabled('financial-regression-blocks-release')) {
      allowed = false;
      warnings.push(
        `${finRegressions} financial workflow regression(s) detected (chargeoff / payoff / settlement). Release blocked.`
      );
    }

    // General regressions – warn, require sign-off
    if (context.regressions > 0 && this.isPolicyEnabled('regression-failures-require-signoff')) {
      warnings.push(
        `${context.regressions} regression(s) detected. QA lead sign-off required before proceeding.`
      );
    }

    // Flaky tests – warn only
    if (context.flakyTests > 0 && this.shouldWarnAboutFlaky(true)) {
      warnings.push(
        `${context.flakyTests} flaky test(s) detected. Monitor closely after deployment.`
      );
    }

    // Environment issues – inform but do not block
    if (context.environmentIssues > 0 && this.isPolicyEnabled('environment-issues-allow')) {
      warnings.push(
        `${context.environmentIssues} failure(s) classified as environment issues (DB/network/Mailosaur). Not code regressions.`
      );
    }

    return { allowed, warnings };
  }

  getAllPolicies(): QAPolicy[] {
    return Array.from(this.policies.values());
  }

  updatePolicy(policyName: string, updates: Partial<QAPolicy>): void {
    const policy = this.policies.get(policyName);
    if (policy) {
      this.policies.set(policyName, { ...policy, ...updates });
    }
  }

  getEnvironment(): string {
    return this.environment;
  }
}
