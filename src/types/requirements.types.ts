/**
 * Type definitions for the Requirements Traceability system.
 * Used by requirementsReader, requirementsTestGenerator,
 * requirementsCoverage services and their tools.
 */

import type { FrameworkBlueprint } from './framework.types.js';
import type { PageCrawl }          from './crawl.types.js';
import type { ProjectSchema }      from './schema.types.js';

// ---------------------------------------------------------------------------
// Core requirement shape
// ---------------------------------------------------------------------------

export type RequirementType =
  | 'functional'
  | 'validation'
  | 'security'
  | 'performance'
  | 'ui'
  | 'integration';

export type RequirementPriority = 'high' | 'medium' | 'low';

export type TestResult = 'passed' | 'failed' | 'not_run' | null;

export type ReleaseVerdict = 'SAFE' | 'CAUTION' | 'BLOCK' | 'INCOMPLETE';

export interface Requirement {
  id:           string;           // REQ-001, REQ-002 …
  text:         string;           // Full requirement text
  type:         RequirementType;
  priority:     RequirementPriority;
  section:      string;           // Document section heading
  hasTest:      boolean;
  testScenario: string | null;    // Scenario name once generated
}

// ---------------------------------------------------------------------------
// Saved requirements document
// ---------------------------------------------------------------------------

export interface ProjectRequirements {
  projectName:         string;
  sourceFile:          string;
  readAt:              string;    // ISO timestamp
  totalRequirements:   number;
  sections:            string[];
  requirements:        Requirement[];
}

// ---------------------------------------------------------------------------
// Coverage shapes
// ---------------------------------------------------------------------------

export interface CoverageDetail {
  covered:      boolean;
  scenarioName: string | null;
  featureFile:  string | null;
  testResult:   TestResult;
}

export interface CoverageSummary {
  total:            number;
  covered:          number;
  notCovered:       number;
  passing:          number;
  failing:          number;
  notRun:           number;
  coveragePercent:  number;
}

export interface RequirementsCoverage {
  projectName:              string;
  generatedAt:              string;   // ISO timestamp
  language:                 string;
  summary:                  CoverageSummary;
  verdict:                  ReleaseVerdict;
  failingRequirements:      string[];
  notCoveredRequirements:   string[];
  details:                  Record<string, CoverageDetail>;
}

// ---------------------------------------------------------------------------
// Test-generation shapes
// ---------------------------------------------------------------------------

export interface GeneratedScenario {
  requirementId:    string;
  requirementText:  string;
  scenarioName:     string;
  tags:             string[];
  steps:            string[];   // Raw Gherkin step lines
  section:          string;
}

export interface GeneratedStep {
  stepType:         'Given' | 'When' | 'Then';
  stepText:         string;
  requirementIds:   string[];   // REQ IDs that share this step
  requirementText:  string;     // Used as a comment in generated code
  pageMethod:       string | null; // Existing page-object method to call
}

export interface GenerationContext {
  projectName: string;
  blueprint:   FrameworkBlueprint;
  crawlData:   PageCrawl | null;
  schemaData:  ProjectSchema | null;
}

// ---------------------------------------------------------------------------
// List summary (used by list_requirements)
// ---------------------------------------------------------------------------

export interface RequirementsSummary {
  projectName:        string;
  readAt:             string;
  sourceFile:         string;
  totalRequirements:  number;
  covered:            number;
  coveragePercent:    number;
}
