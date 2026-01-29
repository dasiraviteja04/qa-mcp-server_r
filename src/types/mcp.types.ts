/**
 * Type definitions for MCP Server
 */

export interface TestMetadata {
  name: string;
  tags: string[];
  feature: string;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  location?: string;
}

export interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  duration: number;
  error?: string;
  tags: string[];
}

export interface ExecutionReport {
  id: string;
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  tests: TestResult[];
  environment?: string;
}

export interface FailureAnalysis {
  name: string;
  failureCount: number;
  lastFailureTime: string;
  classification: 'flaky' | 'regression' | 'environment-issue' | 'new-failure';
  error: string;
}

export interface ReleaseRiskAssessment {
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
  recommendation: string;
  failedCriticalTests: string[];
  flakyTests: string[];
  regressions: string[];
  environmentIssues: string[];
}

export interface ToolInput {
  [key: string]: string | string[] | number | boolean;
}

export interface ToolOutput {
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface QAPolicy {
  name: string;
  description: string;
  enabled: boolean;
  action: 'block' | 'warn' | 'allow';
}
