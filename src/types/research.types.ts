/**
 * Type definitions for AutoResearch feature
 */

export type FindingType =
  | 'failure-root-cause'
  | 'coverage-gap'
  | 'flaky-pattern'
  | 'env-issue'
  | 'new-regression'
  | 'git-correlation';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'info';

export interface ResearchFinding {
  type: FindingType;
  testName?: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  evidence: string[];
  suggestedAction: string;
}

export interface CoverageGap {
  area: string;
  changedFile: string;
  commitMessage: string;
  commitDate: string;
  scenarioCount: number;
  recommendation: string;
}

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
  filesChanged: string[];
}

export interface ResearchReport {
  runId: string;
  researchedAt: string;
  iterationsUsed: number;
  totalTests: number;
  passed: number;
  failed: number;
  findings: ResearchFinding[];
  coverageGaps: CoverageGap[];
  releaseVerdict: 'SAFE' | 'CAUTION' | 'BLOCK';
  verdictReason: string;
  suggestedNextSteps: string[];
}
