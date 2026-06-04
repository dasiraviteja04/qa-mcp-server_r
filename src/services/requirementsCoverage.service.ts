/**
 * RequirementsCoverageService
 *
 * Scans .feature files for @REQ-NNN tags, matches them against saved
 * requirements, optionally cross-references test results, and saves a
 * coverage JSON to memory/requirements/{project_name}-coverage.json.
 *
 * Language AGNOSTIC — reads .feature files only, never .cs or .ts files.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { glob }  from 'glob';
import { fileURLToPath } from 'url';
import type {
  RequirementsCoverage,
  CoverageDetail,
  CoverageSummary,
  ReleaseVerdict,
  TestResult,
} from '../types/requirements.types.js';
import { RequirementsReaderService } from './requirementsReader.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface RequirementsCoverageInput {
  project_name:          string;
  feature_files_path:    string;
  include_test_results?: boolean;
}

// ---------------------------------------------------------------------------
// Test-result loader
// ---------------------------------------------------------------------------

interface TestRunReport {
  tests: Array<{
    name:   string;
    status: 'passed' | 'failed' | 'skipped';
    tags?:  string[];
  }>;
}

function loadLatestTestReport(serverRoot: string): TestRunReport | null {
  const latestPath = path.join(serverRoot, 'reports', 'latest.json');
  try {
    if (!fs.existsSync(latestPath)) return null;
    return JSON.parse(fs.readFileSync(latestPath, 'utf-8')) as TestRunReport;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Feature-file scanner
// ---------------------------------------------------------------------------

interface ScenarioMapping {
  reqId:        string;
  scenarioName: string;
  featureFile:  string;
}

async function scanFeatureFiles(
  featurePath: string
): Promise<ScenarioMapping[]> {
  const mappings: ScenarioMapping[] = [];

  const files = await glob('**/*.feature', {
    cwd:      featurePath,
    absolute: true,
    nodir:    true,
  });

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines   = content.split(/\r?\n/);

    let pendingReqTags: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Collect @REQ-NNN tags on tag lines
      if (trimmed.startsWith('@')) {
        const found = trimmed.match(/@(REQ-\d+)/g) ?? [];
        pendingReqTags.push(...found.map(t => t.slice(1))); // strip @
        continue;
      }

      // Scenario line — pair with collected tags
      const scenarioMatch = trimmed.match(/^Scenario(?:\s+Outline)?:\s*(.+)/);
      if (scenarioMatch && pendingReqTags.length > 0) {
        const scenarioName = scenarioMatch[1]!.trim();
        for (const reqId of pendingReqTags) {
          mappings.push({
            reqId,
            scenarioName,
            featureFile: path.relative(featurePath, file),
          });
        }
        pendingReqTags = [];
        continue;
      }

      // Any non-tag, non-scenario line resets pending tags
      if (!trimmed.startsWith('@') && trimmed !== '') {
        pendingReqTags = [];
      }
    }
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Coverage verdict
// ---------------------------------------------------------------------------

function deriveVerdict(
  failingCount:    number,
  notCoveredCount: number,
  totalCount:      number,
  coveragePct:     number,
): ReleaseVerdict {
  if (failingCount > 0)         return 'BLOCK';
  if (notCoveredCount > 0)      return 'CAUTION';
  if (coveragePct < 100)        return 'INCOMPLETE';
  return 'SAFE';
}

// ---------------------------------------------------------------------------
// RequirementsCoverageService
// ---------------------------------------------------------------------------

export class RequirementsCoverageService {
  private memDir:     string;
  private serverRoot: string;

  constructor(serverRoot?: string) {
    this.serverRoot = serverRoot ?? path.join(__dirname, '..', '..');
    this.memDir     = path.join(this.serverRoot, 'memory', 'requirements');
    fs.mkdirSync(this.memDir, { recursive: true });
  }

  async run(input: RequirementsCoverageInput): Promise<RequirementsCoverage> {
    const reqService = new RequirementsReaderService(this.serverRoot);
    const doc        = reqService.load(input.project_name);   // throws if missing

    if (!fs.existsSync(input.feature_files_path)) {
      throw new Error(`feature_files_path does not exist: ${input.feature_files_path}`);
    }

    // ── STEP 2: Scan .feature files ──────────────────────────────────────────
    const mappings  = await scanFeatureFiles(input.feature_files_path);
    const coveredMap = new Map<string, { scenarioName: string; featureFile: string }>();
    for (const m of mappings) {
      if (!coveredMap.has(m.reqId)) {
        coveredMap.set(m.reqId, { scenarioName: m.scenarioName, featureFile: m.featureFile });
      }
    }

    // ── STEP 3: Optional test results ────────────────────────────────────────
    let testReport: TestRunReport | null = null;
    if (input.include_test_results !== false) {
      testReport = loadLatestTestReport(this.serverRoot);
    }

    // ── STEP 4: Build details record ─────────────────────────────────────────
    const details: Record<string, CoverageDetail> = {};
    let passing    = 0;
    let failing    = 0;
    let notRun     = 0;
    let covered    = 0;
    let notCovered = 0;

    const failingReqs:    string[] = [];
    const notCoveredReqs: string[] = [];

    for (const req of doc.requirements) {
      const mapping = coveredMap.get(req.id);
      const isCovered = !!mapping;

      let testResult: TestResult = null;

      if (isCovered && testReport) {
        const scenName = mapping!.scenarioName.toLowerCase();
        const match    = testReport.tests.find(t =>
          t.name.toLowerCase().includes(scenName) ||
          (t.tags ?? []).some(tag => tag === req.id)
        );

        if (match) {
          testResult = match.status === 'passed' ? 'passed'
                     : match.status === 'failed' ? 'failed'
                     : 'not_run';
        } else {
          testResult = 'not_run';
        }
      }

      if (isCovered) {
        covered++;
        if      (testResult === 'passed')  passing++;
        else if (testResult === 'failed') { failing++; failingReqs.push(req.id); }
        else                               notRun++;
      } else {
        notCovered++;
        notCoveredReqs.push(req.id);
      }

      details[req.id] = {
        covered:      isCovered,
        scenarioName: mapping?.scenarioName ?? null,
        featureFile:  mapping?.featureFile  ?? null,
        testResult,
      };
    }

    const total          = doc.requirements.length;
    const coveragePct    = total > 0 ? Math.round((covered / total) * 100) : 0;

    const summary: CoverageSummary = {
      total,
      covered,
      notCovered,
      passing,
      failing,
      notRun,
      coveragePercent: coveragePct,
    };

    const verdict = deriveVerdict(failing, notCovered, total, coveragePct);

    const coverage: RequirementsCoverage = {
      projectName:            input.project_name,
      generatedAt:            new Date().toISOString(),
      language:               'agnostic',
      summary,
      verdict,
      failingRequirements:    failingReqs,
      notCoveredRequirements: notCoveredReqs,
      details,
    };

    // ── Save to memory ───────────────────────────────────────────────────────
    const outPath = path.join(this.memDir, `${input.project_name}-coverage.json`);
    const tmp     = outPath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(coverage, null, 2), 'utf-8');
    await fs.promises.rename(tmp, outPath);

    return coverage;
  }

  loadCoverage(projectName: string): RequirementsCoverage | null {
    try {
      const p = path.join(this.memDir, `${projectName}-coverage.json`);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as RequirementsCoverage;
    } catch {
      return null;
    }
  }
}
