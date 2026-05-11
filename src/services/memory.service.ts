/**
 * MemoryService — Persistent memory layer for the QA AI Agent.
 *
 * Provides read/write access to 5 JSON-based memory domains:
 *   1. failures-history.json      — test failure observations + flaky scoring
 *   2. coverage-history.json      — coverage snapshot trends per feature area
 *   3. generated-artifacts.json   — generated artifact records
 *   4. risk-history.json          — release risk verdicts over time
 *   5. orchestration-decisions.json — orchestration decisions + outcomes
 *
 * Design principles:
 *   - Sync reads (fs.readFileSync) — files capped at MAX_ENTRIES=500, always fast
 *   - Async atomic writes: write .tmp → fs.promises.rename (corruption-safe)
 *   - Fire-and-forget saves: never block orchestration; failures logged as warnings
 *   - Retention: MAX_ENTRIES=500, RETENTION_DAYS=90 per domain
 *   - Flaky score: weighted recency decay with MIN_OBSERVATIONS=5
 */

import * as fs   from 'fs';
import * as path from 'path';
import type {
  FailureHistoryEntry,
  CoverageHistoryEntry,
  GeneratedArtifactEntry,
  RiskHistoryEntry,
  DecisionHistoryEntry,
  FlakyScoreResult,
  RiskProfile,
  MemoryFailureClassification,
} from '../types/memory.types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ENTRIES     = 500;
const RETENTION_DAYS  = 90;
const MIN_OBSERVATIONS = 5;

/** Recency weight bands for flaky score calculation */
const FLAKY_WEIGHTS: Array<{ maxAgeDays: number; weight: number }> = [
  { maxAgeDays:  7, weight: 1.0 },
  { maxAgeDays: 30, weight: 0.7 },
  { maxAgeDays: 60, weight: 0.4 },
  { maxAgeDays: Infinity, weight: 0.1 },
];

// ─────────────────────────────────────────────────────────────────────────────
// File-level helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a JSON array from disk, returning [] on missing file or parse errors.
 * Sync read — intentionally fast for capped 500-entry files.
 */
function readJsonFileSafe<T>(filePath: string): T[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Atomically writes a JSON array to disk via a temp file + rename.
 * If the temp file write fails, the target file is untouched.
 */
async function writeJsonAtomic<T>(filePath: string, data: T[]): Promise<void> {
  const dir     = path.dirname(filePath);
  const tmpPath = path.join(dir, `${path.basename(filePath)}.tmp`);
  const json    = JSON.stringify(data, null, 2);

  await fs.promises.writeFile(tmpPath, json, 'utf-8');
  await fs.promises.rename(tmpPath, filePath);
}

/**
 * Trims a history array to MAX_ENTRIES and removes entries older than
 * RETENTION_DAYS. Keeps newest entries (sorted by timestamp desc, trim head).
 */
function trimRetentionWindow<T extends { timestamp: string }>(entries: T[]): T[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  // Remove expired entries
  const recent = entries.filter(e => new Date(e.timestamp) >= cutoff);

  // Keep newest MAX_ENTRIES
  if (recent.length <= MAX_ENTRIES) return recent;
  return recent.slice(recent.length - MAX_ENTRIES);
}

/**
 * Age in days from an ISO-8601 timestamp to now.
 */
function ageDays(timestamp: string): number {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

// ─────────────────────────────────────────────────────────────────────────────
// MemoryService
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryService {
  private readonly memoryDir:       string;
  private readonly failuresPath:    string;
  private readonly coveragePath:    string;
  private readonly artifactsPath:   string;
  private readonly riskPath:        string;
  private readonly decisionsPath:   string;

  constructor(reportOutputDir: string) {
    this.memoryDir     = path.join(reportOutputDir, 'memory');
    this.failuresPath  = path.join(this.memoryDir, 'failures-history.json');
    this.coveragePath  = path.join(this.memoryDir, 'coverage-history.json');
    this.artifactsPath = path.join(this.memoryDir, 'generated-artifacts.json');
    this.riskPath      = path.join(this.memoryDir, 'risk-history.json');
    this.decisionsPath = path.join(this.memoryDir, 'orchestration-decisions.json');

    this.ensureMemoryFilesExist();
  }

  // ── Initialisation ──────────────────────────────────────────────────────────

  /**
   * Creates the memory directory and empty JSON arrays for any missing files.
   * Called once in the constructor; safe to call multiple times (idempotent).
   */
  private ensureMemoryFilesExist(): void {
    try {
      if (!fs.existsSync(this.memoryDir)) {
        fs.mkdirSync(this.memoryDir, { recursive: true });
      }

      const files = [
        this.failuresPath,
        this.coveragePath,
        this.artifactsPath,
        this.riskPath,
        this.decisionsPath,
      ];

      for (const f of files) {
        if (!fs.existsSync(f)) {
          fs.writeFileSync(f, '[]', 'utf-8');
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[MemoryService] Warning: could not initialise memory files: ${msg}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Failure History
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget: appends a failure entry to history.
   * Trims to MAX_ENTRIES / RETENTION_DAYS before writing.
   */
  saveFailure(entry: Omit<FailureHistoryEntry, 'timestamp'>): void {
    const full: FailureHistoryEntry = { ...entry, timestamp: new Date().toISOString() };
    const current = readJsonFileSafe<FailureHistoryEntry>(this.failuresPath);
    const trimmed = trimRetentionWindow([...current, full]);

    writeJsonAtomic(this.failuresPath, trimmed).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[MemoryService] Warning: could not save failure entry: ${msg}`);
    });
  }

  /**
   * Returns all historical failure entries for the given test name.
   */
  getFailureHistory(testName: string): FailureHistoryEntry[] {
    return readJsonFileSafe<FailureHistoryEntry>(this.failuresPath)
      .filter(e => e.testName === testName);
  }

  /**
   * Returns how many times a test failed within the last `days` days.
   */
  getFailureFrequency(testName: string, days = 30): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return readJsonFileSafe<FailureHistoryEntry>(this.failuresPath)
      .filter(e => e.testName === testName && new Date(e.timestamp) >= cutoff)
      .length;
  }

  /**
   * Calculates a flaky score (0.0–1.0) for the given test.
   *
   * Algorithm: sum of weighted failure observations / total weighted observations.
   * Returns { sufficient: false } when fewer than MIN_OBSERVATIONS exist.
   *
   * Higher weight = more recent failure.
   */
  calculateFlakyScore(testName: string): FlakyScoreResult {
    const all = readJsonFileSafe<FailureHistoryEntry>(this.failuresPath)
      .filter(e => e.testName === testName);

    if (all.length < MIN_OBSERVATIONS) {
      return { sufficient: false, observations: all.length };
    }

    let weightedFailures = 0;
    let totalWeight      = 0;

    for (const entry of all) {
      const age    = ageDays(entry.timestamp);
      const weight = FLAKY_WEIGHTS.find(b => age <= b.maxAgeDays)?.weight ?? 0.1;
      totalWeight      += weight;
      if (entry.classification === 'flaky') {
        weightedFailures += weight;
      }
    }

    const score = totalWeight > 0 ? weightedFailures / totalWeight : 0;
    return { sufficient: true, score, observations: all.length };
  }

  /**
   * Returns true when a test has failed at least `minFailures` times in the
   * last `days` days — indicating a persistent application bug rather than
   * a transient or flaky failure.
   *
   * Use this in AnalysisService to skip expensive ResearchService.investigate()
   * for tests that are known persistent failures.
   */
  isPersistentFailure(testName: string, days = 30, minFailures = 5): boolean {
    return this.getFailureFrequency(testName, days) >= minFailures;
  }

  /**
   * Returns test names that are recurring failures (≥ minFailures in `days` days),
   * excluding tests classified as purely flaky.
   */
  getRecurringFailures(days = 30, minFailures = 3): string[] {
    const all     = readJsonFileSafe<FailureHistoryEntry>(this.failuresPath);
    const cutoff  = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Group by testName
    const byTest = new Map<string, FailureHistoryEntry[]>();
    for (const entry of all) {
      if (new Date(entry.timestamp) < cutoff) continue;
      const list = byTest.get(entry.testName) ?? [];
      list.push(entry);
      byTest.set(entry.testName, list);
    }

    const results: string[] = [];
    for (const [name, entries] of byTest.entries()) {
      // Skip if all are classified as flaky
      const allFlaky = entries.every(e => e.classification === 'flaky');
      if (!allFlaky && entries.length >= minFailures) {
        results.push(name);
      }
    }
    return results;
  }

  /**
   * Returns feature areas that have seen repeated failures, ranked by frequency.
   */
  getFlakyAreas(days = 30): string[] {
    const all    = readJsonFileSafe<FailureHistoryEntry>(this.failuresPath);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const areaCounts = new Map<string, number>();
    for (const entry of all) {
      if (!entry.featureArea) continue;
      if (entry.classification !== 'flaky') continue;
      if (new Date(entry.timestamp) < cutoff) continue;
      areaCounts.set(entry.featureArea, (areaCounts.get(entry.featureArea) ?? 0) + 1);
    }

    return [...areaCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([area]) => area);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Coverage History
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget: appends a coverage snapshot for a feature area.
   */
  saveCoverage(entry: Omit<CoverageHistoryEntry, 'timestamp'>): void {
    const full: CoverageHistoryEntry = { ...entry, timestamp: new Date().toISOString() };
    const current = readJsonFileSafe<CoverageHistoryEntry>(this.coveragePath);
    const trimmed = trimRetentionWindow([...current, full]);

    writeJsonAtomic(this.coveragePath, trimmed).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[MemoryService] Warning: could not save coverage entry: ${msg}`);
    });
  }

  /**
   * Returns coverage history for a specific feature area (newest first).
   */
  getCoverageTrend(featureArea: string): CoverageHistoryEntry[] {
    return readJsonFileSafe<CoverageHistoryEntry>(this.coveragePath)
      .filter(e => e.featureArea === featureArea)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Returns feature areas with chronically zero or near-zero scenario counts.
   *
   * "Chronic" = the last `minSnapshots` coverage snapshots all had a scenarioCount
   * below `maxScenarios`. These areas get auto-prioritised by the orchestrator.
   */
  getChronicGapAreas(minSnapshots = 2, maxScenarios = 1): string[] {
    const all = readJsonFileSafe<CoverageHistoryEntry>(this.coveragePath);

    // Group by featureArea, keeping all history
    const byArea = new Map<string, CoverageHistoryEntry[]>();
    for (const entry of all) {
      const list = byArea.get(entry.featureArea) ?? [];
      list.push(entry);
      byArea.set(entry.featureArea, list);
    }

    const chronic: string[] = [];
    for (const [area, entries] of byArea.entries()) {
      if (entries.length < minSnapshots) continue;
      // Look at the most recent `minSnapshots` entries
      const recent = entries
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, minSnapshots);
      if (recent.every(e => e.scenarioCount <= maxScenarios)) {
        chronic.push(area);
      }
    }
    return chronic;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Generated Artifact History
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget: records that an artifact was generated for a feature area.
   */
  saveGeneratedArtifact(entry: Omit<GeneratedArtifactEntry, 'generatedAt'>): void {
    const full: GeneratedArtifactEntry = { ...entry, generatedAt: new Date().toISOString() };
    const current = readJsonFileSafe<GeneratedArtifactEntry>(this.artifactsPath);
    const merged  = [...current, full];

    // Trim using generatedAt as the retention timestamp
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const recent = merged.filter(e => new Date(e.generatedAt) >= cutoff);
    const trimmed: GeneratedArtifactEntry[] = recent.length <= MAX_ENTRIES
      ? recent
      : recent.slice(recent.length - MAX_ENTRIES);

    writeJsonAtomic(this.artifactsPath, trimmed).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[MemoryService] Warning: could not save artifact entry: ${msg}`);
    });
  }

  /**
   * Returns true when an artifact of the same type was generated for the same
   * feature area within the last `withinDays` days.
   *
   * Used by GenerationService to prevent duplicate generation runs.
   */
  wasArtifactRecentlyGenerated(
    featureArea:  string,
    artifactType: string,
    withinDays = 1,
  ): boolean {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - withinDays);

    return readJsonFileSafe<GeneratedArtifactEntry>(this.artifactsPath).some(
      e =>
        e.featureArea    === featureArea  &&
        e.artifactType   === artifactType &&
        new Date(e.generatedAt) >= cutoff,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Risk History
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget: records a risk assessment for a feature area.
   */
  saveRisk(entry: Omit<RiskHistoryEntry, 'timestamp'>): void {
    const full: RiskHistoryEntry = { ...entry, timestamp: new Date().toISOString() };
    const current = readJsonFileSafe<RiskHistoryEntry>(this.riskPath);
    const trimmed = trimRetentionWindow([...current, full]);

    writeJsonAtomic(this.riskPath, trimmed).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[MemoryService] Warning: could not save risk entry: ${msg}`);
    });
  }

  /**
   * Returns a risk profile summary for a feature area.
   *
   * Dominant level = most frequent risk level across all historical assessments.
   * Returns undefined if no history exists for this area.
   */
  getRiskProfile(area: string): RiskProfile | undefined {
    const entries = readJsonFileSafe<RiskHistoryEntry>(this.riskPath)
      .filter(e => e.area === area);

    if (entries.length === 0) return undefined;

    // Count risk levels
    const counts: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    let blockCount = 0;
    let lastVerdict: RiskHistoryEntry['verdict'] = 'SAFE';
    let latestTime  = 0;

    for (const e of entries) {
      counts[e.riskLevel] = (counts[e.riskLevel] ?? 0) + 1;
      if (e.verdict === 'BLOCK') blockCount++;
      const t = new Date(e.timestamp).getTime();
      if (t > latestTime) {
        latestTime  = t;
        lastVerdict = e.verdict;
      }
    }

    const dominant = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'LOW') as
      RiskProfile['dominant'];

    return {
      dominant,
      blockCount,
      lastVerdict,
      totalAssessments: entries.length,
    };
  }

  /**
   * Returns areas that have a HIGH risk profile (dominant level = HIGH or
   * any BLOCK verdict in history).
   */
  getRiskyModules(minAssessments = 2): string[] {
    const all = readJsonFileSafe<RiskHistoryEntry>(this.riskPath);

    const areas = [...new Set(all.map(e => e.area))];
    const risky: string[] = [];

    for (const area of areas) {
      const profile = this.getRiskProfile(area);
      if (!profile) continue;
      if (profile.totalAssessments < minAssessments) continue;
      if (profile.dominant === 'HIGH' || profile.blockCount > 0) {
        risky.push(area);
      }
    }
    return risky;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Orchestration Decision History
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget: records an orchestration decision.
   */
  saveDecision(entry: Omit<DecisionHistoryEntry, 'timestamp'>): void {
    const full: DecisionHistoryEntry = { ...entry, timestamp: new Date().toISOString() };
    const current = readJsonFileSafe<DecisionHistoryEntry>(this.decisionsPath);
    const trimmed = trimRetentionWindow([...current, full]);

    writeJsonAtomic(this.decisionsPath, trimmed).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[MemoryService] Warning: could not save decision entry: ${msg}`);
    });
  }

  /**
   * Returns the most recent `limit` decisions (newest first).
   */
  getRecentDecisions(limit = 20): DecisionHistoryEntry[] {
    return readJsonFileSafe<DecisionHistoryEntry>(this.decisionsPath)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Convenience — Memory signals for the orchestrator
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Loads a summary of memory signals for the orchestrator report.
   *
   * Returns the four signal categories used by QAContext.memory:
   *   flakyAreas          — areas with recent flaky test activity
   *   recurringFailures   — test names that fail repeatedly
   *   riskyModules        — areas with HIGH or BLOCK risk history
   *   chronicGapAreas     — areas with persistently low coverage
   */
  loadMemorySignals(): {
    flakyAreas:        string[];
    recurringFailures: string[];
    riskyModules:      string[];
    chronicGapAreas:   string[];
  } {
    return {
      flakyAreas:        this.getFlakyAreas(),
      recurringFailures: this.getRecurringFailures(),
      riskyModules:      this.getRiskyModules(),
      chronicGapAreas:   this.getChronicGapAreas(),
    };
  }
}
