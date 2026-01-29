/**
 * QA Governance Policies
 * Define what actions are allowed/blocked based on context
 */

import type { QAPolicy } from '../types/mcp.types.js';

export const DEFAULT_POLICIES: QAPolicy[] = [
  {
    name: 'critical-failures-block-release',
    description: 'Block release if critical tests fail',
    enabled: true,
    action: 'block'
  },
  {
    name: 'flaky-tests-warn',
    description: 'Warn about flaky tests but allow release',
    enabled: true,
    action: 'warn'
  },
  {
    name: 'environment-issues-allow',
    description: 'Allow release for environment-only issues',
    enabled: true,
    action: 'allow'
  },
  {
    name: 'regression-in-non-critical-warn',
    description: 'Warn about regressions in non-critical flows',
    enabled: true,
    action: 'warn'
  },
  {
    name: 'ai-suggestions-readonly',
    description: 'AI can only suggest, not execute',
    enabled: true,
    action: 'allow'
  },
  {
    name: 'self-healing-disabled-prod',
    description: 'Disable self-healing in production',
    enabled: true,
    action: 'block'
  }
];

export class PolicyService {
  private policies: Map<string, QAPolicy>;
  private environment: string;

  constructor(environment: string = process.env.TEST_ENV || 'staging') {
    this.environment = environment;
    this.policies = new Map();
    this.loadDefaultPolicies();
  }

  /**
   * Load default policies
   */
  private loadDefaultPolicies(): void {
    DEFAULT_POLICIES.forEach(policy => {
      // Disable self-healing in production
      if (policy.name === 'self-healing-disabled-prod' && this.environment === 'prod') {
        policy.enabled = true;
      }
      this.policies.set(policy.name, policy);
    });
  }

  /**
   * Check if a policy is enabled
   */
  isPolicyEnabled(policyName: string): boolean {
    const policy = this.policies.get(policyName);
    return policy?.enabled || false;
  }

  /**
   * Get policy action
   */
  getPolicyAction(policyName: string): QAPolicy['action'] | null {
    const policy = this.policies.get(policyName);
    return policy?.action || null;
  }

  /**
   * Check if critical test failures should block release
   */
  shouldBlockOnCriticalFailure(hasCriticalFailures: boolean): boolean {
    if (!hasCriticalFailures) return false;
    return this.getPolicyAction('critical-failures-block-release') === 'block';
  }

  /**
   * Check if we should warn about flaky tests
   */
  shouldWarnAboutFlaky(hasFlaky: boolean): boolean {
    if (!hasFlaky) return false;
    return this.isPolicyEnabled('flaky-tests-warn');
  }

  /**
   * Validate if release is allowed based on policies
   */
  validateReleaseDecision(context: {
    criticalFailures: number;
    flakyTests: number;
    regressions: number;
    environmentIssues: number;
  }): { allowed: boolean; warnings: string[] } {
    const warnings: string[] = [];
    let allowed = true;

    // Check critical failures
    if (context.criticalFailures > 0 && this.shouldBlockOnCriticalFailure(true)) {
      allowed = false;
      warnings.push(`Critical test failures found. Release blocked by policy.`);
    }

    // Check flaky tests
    if (context.flakyTests > 0 && this.shouldWarnAboutFlaky(true)) {
      warnings.push(`${context.flakyTests} flaky test(s) detected. Monitor in production.`);
    }

    // Check regressions in non-critical
    if (context.regressions > 0) {
      warnings.push(`${context.regressions} regression(s) detected in non-critical flows.`);
    }

    return { allowed, warnings };
  }

  /**
   * Get all policies
   */
  getAllPolicies(): QAPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Update a policy
   */
  updatePolicy(policyName: string, updates: Partial<QAPolicy>): void {
    const policy = this.policies.get(policyName);
    if (policy) {
      this.policies.set(policyName, { ...policy, ...updates });
    }
  }

  /**
   * Get environment
   */
  getEnvironment(): string {
    return this.environment;
  }
}
