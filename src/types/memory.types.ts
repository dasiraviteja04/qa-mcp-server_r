/**
 * Memory Layer type definitions for the QA AI Agent.
 *
 * These types define the 5 memory domains persisted to disk:
 *   1. FailureHistoryEntry      — historical test failures with flaky scoring
 *   2. CoverageHistoryEntry     — scenario count snapshots per feature area
 *   3. GeneratedArtifactEntry   — generated test artifact records
 *   4. RiskHistoryEntry         — release risk verdicts over time
 *   5. DecisionHistoryEntry     — orchestration decisions and outcomes
 *
 * All timestamps are ISO-8601 strings (Date.toISOString()).
 * No `any` types — strict typing throughout.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Failure History
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classification values for memory storage.
 * Extends the FailureAnalysis classification with 'persistent-app-bug'
 * which is a memory-layer classification (not in the base report).
 */
export type MemoryFailureClassification =
  | 'flaky'
  | 'regression'
  | 'env-issue'
  | 'persistent-app-bug'
  | 'new-failure';

export interface FailureHistoryEntry {
  /** NUnit/Reqnroll test name exactly as it appears in the TRX report */
  testName: string;
  /** Classification at the time of this failure */
  classification: MemoryFailureClassification;
  /** Short error message (first 200 chars) */
  error?: string;
  /** Environment name (e.g. "auto_qa", "staging") */
  environment?: string;
  /** ISO-8601 timestamp of this failure observation */
  timestamp: string;
  /** Feature area this test belongs to (e.g. "CouponHive", "AuditLog") */
  featureArea?: string;
  /** Flaky score at the time of save: 0.0–1.0 or null if insufficient data */
  flakyScore?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Coverage History
// ─────────────────────────────────────────────────────────────────────────────

export interface CoverageHistoryEntry {
  /** Feature area name (e.g. "CouponHive", "AuditLog") */
  featureArea: string;
  /** Number of Gherkin scenarios found at the time of this snapshot */
  scenarioCount: number;
  /** Sub-areas or modules with zero scenario coverage at snapshot time */
  missingAreas: string[];
  /** ISO-8601 timestamp of this coverage snapshot */
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Generated Artifact History
// ─────────────────────────────────────────────────────────────────────────────

export interface GeneratedArtifactEntry {
  /** Feature area for which artifacts were generated */
  featureArea?: string;
  /** Artifact type: feature | steps | page_object | db_methods | full_suite */
  artifactType: string;
  /** ISO-8601 timestamp when this artifact was generated */
  generatedAt: string;
  /** Human-readable reason for generation (from buildArtifactReason) */
  reason: string;
  /** Whether the generated artifact was accepted/used (set externally, optional) */
  accepted?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Risk History
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskHistoryEntry {
  /** Feature area or module that was risk-assessed */
  area: string;
  /** Risk level at the time of assessment */
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Release verdict at the time of assessment */
  verdict: 'SAFE' | 'CAUTION' | 'BLOCK';
  /** ISO-8601 timestamp of this risk assessment */
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Orchestration Decision History
// ─────────────────────────────────────────────────────────────────────────────

export interface DecisionHistoryEntry {
  /** The decision that was made (e.g. "Skip research — persistent failure") */
  decision: string;
  /** Reason behind the decision */
  reason: string;
  /** Outcome observed after the decision (set externally, optional) */
  outcome?: string;
  /** ISO-8601 timestamp when this decision was made */
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flaky Score result — typed union prevents silent -1 sentinel values
// ─────────────────────────────────────────────────────────────────────────────

/** Result of calculateFlakyScore() */
export type FlakyScoreResult =
  | { sufficient: false; observations: number }
  | { sufficient: true;  score: number; observations: number };

// ─────────────────────────────────────────────────────────────────────────────
// Risk profile — summary of a feature area's risk history
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskProfile {
  /** The dominant risk level across all historical assessments */
  dominant: 'LOW' | 'MEDIUM' | 'HIGH';
  /** How many times this area received a BLOCK verdict */
  blockCount: number;
  /** The most recent verdict */
  lastVerdict: 'SAFE' | 'CAUTION' | 'BLOCK';
  /** Total number of assessments in history */
  totalAssessments: number;
}
