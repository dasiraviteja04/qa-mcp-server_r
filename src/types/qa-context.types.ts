/**
 * Shared context types for the capability-based QA orchestration layer.
 *
 * These types define the unified QAContext and the three phase result shapes:
 *   AnalysisResult     — what AnalysisService.analyzeSystem() returns
 *   DiscoveryResult    — what DiscoveryService.getFullContext() returns
 *   GeneratedArtifacts — what GenerationService.generateArtifacts() returns
 *
 * Placement here (not in research.types.ts) keeps types in one direction:
 *   types/ ← services ← tools ← server
 * No circular imports.
 */

import type { FailureAnalysis, ReleaseRiskAssessment, TestMetadata } from './mcp.types.js';
import type { ResearchReport, CoverageGap } from './research.types.js';
import type { StepBinding } from '../services/stepinventory.service.js';
import type { PageSource } from '../services/pagecrawler.service.js';
import type { DatabaseSchema } from '../services/schema.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Artifact type — centralised here for shared use across services + tools
// ─────────────────────────────────────────────────────────────────────────────

/** Supported test artifact types */
export type ArtifactType =
  | 'feature'
  | 'steps'
  | 'page_object'
  | 'db_methods'
  | 'full_suite';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — Analysis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Typed boolean signals derived from AnalysisResult.
 *
 * Replaces the previous raw-string-scanning approach in qaOrchestrator.ts.
 * All orchestrator decision functions read from this structure instead of
 * searching for keywords in free-form text output.
 */
export interface AnalysisSignals {
  /** At least one test failed in the latest run */
  hasFailures: boolean;
  /** At least one failure classified as regression or new-failure */
  hasRegressions: boolean;
  /** At least one failure classified as environment / infrastructure issue */
  hasEnvIssues: boolean;
  /** At least one historically flaky test detected */
  hasFlaky: boolean;
  /** Release verdict is BLOCK or CAUTION, or risk assessment is HIGH */
  isHighRisk: boolean;
  /** Coverage gaps exist where scenarioCount === 0 */
  hasCriticalGaps: boolean;
  /** Coverage gaps exist where scenarioCount is 1 (partial) */
  hasPartialGaps: boolean;
  /** Any coverage gap — critical OR partial */
  hasCoverageGaps: boolean;
  /** UI interactions needed — derived from whether pageUrl is set */
  needsUIArtifacts: boolean;
  /** Database / backend logic involved — derived from coverage gap area names */
  needsDBMethods: boolean;
  /** No existing feature files found for the target area */
  isNewModule: boolean;
  /** Feature file exists but step bindings are sparse (< 3 matches) */
  featureExistsStepsMissing: boolean;
}

/** Result returned by AnalysisService.analyzeSystem() */
export interface AnalysisResult {
  /** Classified failures from the latest test report */
  failures: FailureAnalysis[];
  /** Deep research report — only populated when regressions exist */
  research?: ResearchReport;
  /** Coverage gaps for recently changed files */
  coverage: CoverageGap[];
  /** Release risk assessment — only populated when isReleaseCheck is true */
  risk?: ReleaseRiskAssessment;
  /** Typed boolean signals derived from the above data */
  signals: AnalysisSignals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Discovery
// ─────────────────────────────────────────────────────────────────────────────

/** Result returned by DiscoveryService.getFullContext() */
export interface DiscoveryResult {
  /** Live SQL Server schema — exact column names, types, FK relationships */
  schema?: DatabaseSchema;
  /** All existing [Given]/[When]/[Then] step bindings in the feature area */
  steps?: StepBinding[];
  /** Interactive page elements from a headless browser crawl */
  page?: PageSource;
  /** Existing test scenarios parsed from .feature files for the area */
  existingTests?: TestMetadata[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — Generation
// ─────────────────────────────────────────────────────────────────────────────

/** Result returned by GenerationService.generateArtifacts() */
export interface GeneratedArtifacts {
  /** Which artifact types were requested */
  artifactTypes: ArtifactType[];
  /** The assembled context string (generation prompt for Claude) */
  context: string;
  /** Human-readable reasoning for the artifact selection */
  reasoning: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified QA Context — passed through all 3 phases
// ─────────────────────────────────────────────────────────────────────────────

/** Unified context object for the 3-phase orchestration flow */
export interface QAContext {
  // ── inputs ────────────────────────────────────────────────────────────────
  /** Feature area being investigated / generated (e.g. "CouponHive", "AuditLog") */
  featureArea: string;
  /** URL for page crawl — triggers needsUIArtifacts signal and page_object generation */
  pageUrl?: string;
  /** Comma-separated DB table names to limit schema read */
  tables?: string;
  /** Gherkin tags for generated scenarios (default: "regression") */
  tags?: string;
  /** Whether this run is a release gate check (enables risk assessment) */
  isReleaseCheck: boolean;
  /** Maximum iterations (kept for backward compat; not used by 3-phase flow) */
  maxIterations: number;

  // ── phase results — populated by each service ─────────────────────────────
  analysis?: AnalysisResult;
  discovery?: DiscoveryResult;
  generated?: GeneratedArtifacts;

  // ── memory signals — loaded from MemoryService at start of orchestration ──
  /**
   * Persisted memory signals that inform orchestration decisions.
   * Populated by MemoryService.loadMemorySignals() in qaOrchestrate().
   */
  memory?: {
    /** Feature areas with recent flaky test activity */
    flakyAreas:        string[];
    /** Test names that fail repeatedly (persistent failures) */
    recurringFailures: string[];
    /** Feature areas with HIGH or BLOCK risk history */
    riskyModules:      string[];
    /** Feature areas with persistently low scenario coverage */
    chronicGapAreas:   string[];
  };

  // ── bookkeeping ───────────────────────────────────────────────────────────
  decisions:   string[];
  issuesFound: string[];
}
