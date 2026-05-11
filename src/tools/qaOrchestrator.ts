/**
 * QA Orchestrator — Capability-Based Agent (Refactored)
 *
 * Simplified from a 9-step dispatch loop to a clean 3-phase flow:
 *
 *   Phase 1: AnalysisService.analyzeSystem()        — understand current state
 *   Phase 2: DiscoveryService.getFullContext()       — gather context (only if needed)
 *   Phase 3: GenerationService.generateArtifacts()  — produce artifacts (only if needed)
 *
 * Key improvements over the previous implementation:
 *   ✅ No raw string scanning — all signals are typed AnalysisSignals booleans
 *   ✅ No 9-step dispatch loop — 3 clean sequential phases
 *   ✅ Parallel execution inside AnalysisService (coverage + risk run in parallel)
 *   ✅ DiscoveryService.featureExistsStepsMissing updated from typed step count
 *   ✅ All existing MCP tools preserved unchanged in server.ts
 *
 * Architecture:
 *   MCP Tools  → public API (server.ts — unchanged)
 *   Services   → internal logic (AnalysisService, DiscoveryService, GenerationService)
 *   Orchestrator → decision layer only (needsDiscovery, needsGeneration, selectArtifacts)
 */

import { AnalysisService }   from '../services/analysis.service.js';
import { DiscoveryService }  from '../services/discovery.service.js';
import { GenerationService } from '../services/generation.service.js';
import { MemoryService }     from '../services/memory.service.js';
import { getEnvironmentConfig } from '../config/environments.js';
import type {
  QAContext,
  AnalysisResult,
  AnalysisSignals,
  ArtifactType,
} from '../types/qa-context.types.js';
import type { ToolOutput } from '../types/mcp.types.js';

// Re-export ArtifactType for backward compatibility (server.ts may import it)
export type { ArtifactType };

// ─────────────────────────────────────────────────────────────────────────────
// Output type — unchanged for backward compatibility with server.ts
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorReport {
  tools_used:               string[];
  decisions:                string[];
  issues_found:             string[];
  risk_level:               'LOW' | 'MEDIUM' | 'HIGH';
  coverage_status:          'NONE' | 'PARTIAL' | 'COMPLETE';
  artifact_types_generated: ArtifactType[];
  reasoning:                string;
  final_status:             'STABLE' | 'IMPROVED' | 'NEEDS_ATTENTION';
  generated_context:        string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision helpers — typed, no string scanning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Should Phase 2 (Discovery) run?
 *
 * True when generation will be needed AND discovery hasn't run yet.
 * Skips if: context already has discovery data, or generation is not needed.
 */
export function needsDiscovery(analysis: AnalysisResult, ctx: QAContext): boolean {
  if (ctx.discovery) return false;
  return needsGeneration(analysis, ctx);
}

/**
 * Should Phase 3 (Generation) run?
 *
 * True when any of these conditions are met:
 *   - Coverage gaps found (critical or partial)
 *   - Regressions detected in the latest run
 *   - A new module with no coverage at all
 *   - Explicit featureArea provided by the caller
 */
export function needsGeneration(analysis: AnalysisResult, ctx: QAContext): boolean {
  if (ctx.generated) return false;
  const s = analysis.signals;
  return (
    s.hasCoverageGaps   ||
    s.hasRegressions    ||
    s.isNewModule       ||
    ctx.featureArea.length > 0
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact selector
// Logic preserved from the original selectArtifacts(); input type updated.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines which artifact types to generate based on typed analysis signals.
 *
 * Priority rules (in order):
 *   1. New module OR full gap with UI + DB → full_suite
 *   2. Zero-coverage area → feature
 *   3. Feature exists but steps sparse → steps
 *   4. UI interactions required → page_object
 *   5. DB / backend logic involved → db_methods
 *   6. Fallback → feature
 *   7. All four individual types → collapse to full_suite
 */
export function selectArtifacts(signals: AnalysisSignals, pageUrl?: string): ArtifactType[] {
  const s = signals;

  // Rule 1: Full gap — new module or zero coverage with all dimensions
  if (s.isNewModule || (s.hasCriticalGaps && s.needsUIArtifacts && s.needsDBMethods)) {
    return ['full_suite'];
  }

  const artifacts: ArtifactType[] = [];

  if (s.hasCriticalGaps || s.isNewModule)            artifacts.push('feature');
  if (s.featureExistsStepsMissing && !s.isNewModule) artifacts.push('steps');
  if (s.needsUIArtifacts && pageUrl)                 artifacts.push('page_object');
  if (s.needsDBMethods)                              artifacts.push('db_methods');
  if (artifacts.length === 0)                        artifacts.push('feature'); // fallback

  // Optimisation: collapse all four individual types to full_suite
  const ALL_INDIVIDUAL: ArtifactType[] = ['feature', 'steps', 'page_object', 'db_methods'];
  if (ALL_INDIVIDUAL.every(a => artifacts.includes(a))) return ['full_suite'];

  return artifacts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact reason builder — human-readable string for decisions log
// ─────────────────────────────────────────────────────────────────────────────

function buildArtifactReason(
  artifacts: ArtifactType[],
  signals:   AnalysisSignals,
  pageUrl?:  string,
): string {
  const s = signals;
  const reasons: string[] = [];

  if (s.isNewModule)                      reasons.push('new module with no existing coverage');
  if (s.hasCriticalGaps)                  reasons.push('zero-coverage areas detected');
  if (s.hasPartialGaps)                   reasons.push('partial coverage gaps found');
  if (s.featureExistsStepsMissing)        reasons.push('feature exists but step bindings are sparse');
  if (s.needsUIArtifacts && pageUrl)      reasons.push('UI page interactions required');
  if (s.needsDBMethods)                   reasons.push('database validation logic involved');
  if (s.hasRegressions)                   reasons.push('regression detected in latest run');

  return reasons.length > 0
    ? reasons.join('; ')
    : 'coverage gap resolution';
}

// ─────────────────────────────────────────────────────────────────────────────
// Report builder — maps QAContext → OrchestratorReport (backward compatible)
// ─────────────────────────────────────────────────────────────────────────────

function buildReport(ctx: QAContext): OrchestratorReport {
  const s = ctx.analysis?.signals;

  const toolsUsed: string[] = ['analyzeSystem'];
  if (ctx.discovery) toolsUsed.push('getFullContext');
  if (ctx.generated) toolsUsed.push('generateArtifacts');

  const riskLevel: OrchestratorReport['risk_level'] =
    s?.isHighRisk || s?.hasRegressions   ? 'HIGH'
    : s?.hasFlaky || s?.hasPartialGaps   ? 'MEDIUM'
    : 'LOW';

  const coverageStatus: OrchestratorReport['coverage_status'] =
    s?.hasCriticalGaps  ? 'NONE'
    : s?.hasPartialGaps ? 'PARTIAL'
    : 'COMPLETE';

  const finalStatus: OrchestratorReport['final_status'] =
    s?.hasRegressions || s?.isHighRisk              ? 'NEEDS_ATTENTION'
    : (ctx.generated?.artifactTypes.length ?? 0) > 0 ? 'IMPROVED'
    : 'STABLE';

  // Collect issues from typed data (no string scanning)
  const allIssues: string[] = [...ctx.issuesFound];
  const failCount = ctx.analysis?.failures.length ?? 0;
  const gapCount  = ctx.analysis?.coverage.length ?? 0;
  const verdict   = ctx.analysis?.research?.releaseVerdict;

  if (failCount > 0)  allIssues.push(`${failCount} test failure(s) detected`);
  if (gapCount  > 0)  allIssues.push(`${gapCount} coverage gap(s) identified`);
  if (verdict)        allIssues.push(`Release verdict: ${verdict}`);

  return {
    tools_used:               toolsUsed,
    decisions:                ctx.decisions,
    issues_found:             [...new Set(allIssues)],
    risk_level:               riskLevel,
    coverage_status:          coverageStatus,
    artifact_types_generated: ctx.generated?.artifactTypes ?? [],
    reasoning:                ctx.generated?.reasoning ?? ctx.decisions.join(' → '),
    final_status:             finalStatus,
    generated_context:        ctx.generated?.context,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main agent — 3-phase flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the 3-phase QA agent on the provided context.
 *
 * Phase 1 always runs.
 * Phase 2 runs only when generation will be needed.
 * Phase 3 runs only when gaps or regressions exist.
 *
 * Each phase updates ctx in place so buildReport() can read all results.
 */
async function runAgent(ctx: QAContext): Promise<OrchestratorReport> {
  const analysisService   = new AnalysisService();
  const discoveryService  = new DiscoveryService();
  const generationService = new GenerationService();
  const config            = getEnvironmentConfig();
  const memoryService     = new MemoryService(config.reportOutputDir);

  // ── Memory: Load persisted signals before any analysis ────────────────────
  ctx.memory = memoryService.loadMemorySignals();

  // Auto-prioritize: if no featureArea given, use chronicle gap areas from memory
  if (ctx.featureArea.length === 0 && ctx.memory.chronicGapAreas.length > 0) {
    ctx.featureArea = ctx.memory.chronicGapAreas[0] ?? '';
    if (ctx.featureArea.length > 0) {
      ctx.decisions.push(
        `Memory: Auto-prioritising "${ctx.featureArea}" — chronic coverage gap detected in memory`,
      );
    }
  }

  // Log memory context if anything notable is known
  if (ctx.memory.recurringFailures.length > 0) {
    ctx.decisions.push(
      `Memory: ${ctx.memory.recurringFailures.length} recurring failure(s) known — research may be skipped for persistent bugs`,
    );
  }
  if (ctx.memory.riskyModules.length > 0) {
    ctx.decisions.push(
      `Memory: High-risk modules from history — ${ctx.memory.riskyModules.join(', ')}`,
    );
  }

  // ── Phase 1: Analyze ───────────────────────────────────────────────────────
  ctx.decisions.push(
    'Phase 1: Analyzing system state — failures (sync) + coverage and risk (parallel)',
  );

  const analyzeInput: Parameters<typeof analysisService.analyzeSystem>[0] = {
    featureArea:    ctx.featureArea,
    isReleaseCheck: ctx.isReleaseCheck,
  };
  if (ctx.pageUrl !== undefined) analyzeInput.pageUrl = ctx.pageUrl;
  ctx.analysis = await analysisService.analyzeSystem(analyzeInput);

  const { signals } = ctx.analysis;

  // Log what was found
  if (signals.hasFailures) {
    ctx.decisions.push(
      `→ ${ctx.analysis.failures.length} failure(s) detected` +
      (signals.hasRegressions ? ' — regressions found, deep research performed' : ''),
    );
  }
  if (signals.hasCoverageGaps) {
    ctx.decisions.push(`→ ${ctx.analysis.coverage.length} coverage gap(s) found`);
  }
  if (ctx.analysis.research?.releaseVerdict) {
    ctx.decisions.push(`→ Research verdict: ${ctx.analysis.research.releaseVerdict}`);
  }

  // Early exit: nothing to do
  if (!signals.hasFailures && !signals.hasCoverageGaps && ctx.featureArea.length === 0) {
    ctx.decisions.push('→ No failures, no gaps, no feature area — system is STABLE');
    const stableReport = buildReport(ctx);
    memoryService.saveDecision({
      decision: 'Early exit — system STABLE',
      reason:   ctx.decisions.join(' → '),
      outcome:  'No artifacts generated. Risk: LOW. Coverage: COMPLETE.',
    });
    return stableReport;
  }

  // ── Phase 2: Discover (only if generation is needed) ──────────────────────
  if (needsDiscovery(ctx.analysis, ctx)) {
    ctx.decisions.push(
      'Phase 2: Gathering discovery context — schema, step bindings, and page elements in parallel',
    );

    const discoverInput: Parameters<typeof discoveryService.getFullContext>[0] = {
      featureArea: ctx.featureArea,
    };
    if (ctx.pageUrl !== undefined) discoverInput.pageUrl = ctx.pageUrl;
    if (ctx.tables  !== undefined) discoverInput.tables  = ctx.tables;
    ctx.discovery = await discoveryService.getFullContext(discoverInput);

    // Update featureExistsStepsMissing from typed step count (replaces string scanning)
    const areaLower  = ctx.featureArea.toLowerCase();
    const stepCount  = areaLower
      ? (ctx.discovery.steps?.filter(s =>
          s.pattern.toLowerCase().includes(areaLower) ||
          s.className.toLowerCase().includes(areaLower)
        ).length ?? 0)
      : (ctx.discovery.steps?.length ?? 0);

    ctx.analysis.signals.featureExistsStepsMissing = stepCount < 3;

    const existingCount = ctx.discovery.existingTests?.length ?? 0;
    const totalSteps    = ctx.discovery.steps?.length ?? 0;

    ctx.decisions.push(
      `→ ${existingCount} existing scenario(s), ${totalSteps} step binding(s) found` +
      (ctx.analysis.signals.featureExistsStepsMissing ? ' — step bindings sparse' : ''),
    );
  }

  // ── Phase 3: Generate (only if gaps or regressions warrant it) ────────────
  if (needsGeneration(ctx.analysis, ctx)) {
    const selected  = selectArtifacts(ctx.analysis.signals, ctx.pageUrl);
    const reasoning = buildArtifactReason(selected, ctx.analysis.signals, ctx.pageUrl);

    ctx.decisions.push(
      `Phase 3: Generating artifact(s) [${selected.join(', ')}] for "${ctx.featureArea}" — ${reasoning}`,
    );

    const genInput: Parameters<typeof generationService.generateArtifacts>[0] = {
      featureArea: ctx.featureArea,
    };
    if (ctx.pageUrl !== undefined) genInput.pageUrl = ctx.pageUrl;
    if (ctx.tables  !== undefined) genInput.tables  = ctx.tables;
    if (ctx.tags    !== undefined) genInput.tags    = ctx.tags;
    ctx.generated = await generationService.generateArtifacts(genInput, selected, reasoning);

    ctx.decisions.push(
      `→ Generated: ${ctx.generated.artifactTypes.join(', ')}`,
    );
  } else {
    ctx.decisions.push('Phase 3: Skipped — no gaps or regressions require generation');
  }

  // ── Memory: Save orchestration decision summary ────────────────────────────
  const report = buildReport(ctx);

  memoryService.saveDecision({
    decision: `Run for "${ctx.featureArea || 'global'}" — final status: ${report.final_status}`,
    reason:   ctx.decisions.join(' → '),
    outcome:  `${report.artifact_types_generated.length > 0
      ? `Generated: ${report.artifact_types_generated.join(', ')}`
      : 'No artifacts generated'
    }. Risk: ${report.risk_level}. Coverage: ${report.coverage_status}.`,
  });

  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Tool interface — called by server.ts (unchanged signature)
// ─────────────────────────────────────────────────────────────────────────────

export interface QAOrchestratorInput {
  featureArea:    string | undefined;
  pageUrl:        string | undefined;
  tables:         string | undefined;
  tags:           string | undefined;
  isReleaseCheck: boolean | undefined;
  maxIterations:  number | undefined;
}

/**
 * MCP tool handler — called by server.ts as the "qa_orchestrate" tool.
 * Signature is backward compatible: same input shape, same formatted text output.
 */
export async function qaOrchestrate(
  input: Partial<QAOrchestratorInput>,
): Promise<ToolOutput> {
  try {
    const ctx: QAContext = {
      featureArea:    input.featureArea    ?? '',
      tags:           input.tags           ?? 'regression',
      isReleaseCheck: input.isReleaseCheck ?? false,
      maxIterations:  input.maxIterations  ?? 12,
      decisions:      [],
      issuesFound:    [],
    };
    if (input.pageUrl !== undefined) ctx.pageUrl = input.pageUrl;
    if (input.tables  !== undefined) ctx.tables  = input.tables;

    const report = await runAgent(ctx);

    // Build memory summary for report (only when signals are non-empty)
    const mem = ctx.memory;
    const memoryLines: string[] = [];
    if (mem) {
      const hasMemoryContext =
        mem.flakyAreas.length > 0        ||
        mem.recurringFailures.length > 0  ||
        mem.riskyModules.length > 0       ||
        mem.chronicGapAreas.length > 0;

      if (hasMemoryContext) {
        memoryLines.push('', '🗄️  MEMORY CONTEXT');
        if (mem.flakyAreas.length > 0)
          memoryLines.push(`  Flaky areas:         ${mem.flakyAreas.join(', ')}`);
        if (mem.recurringFailures.length > 0)
          memoryLines.push(`  Recurring failures:  ${mem.recurringFailures.join(', ')}`);
        if (mem.riskyModules.length > 0)
          memoryLines.push(`  Risky modules:       ${mem.riskyModules.join(', ')}`);
        if (mem.chronicGapAreas.length > 0)
          memoryLines.push(`  Chronic gap areas:   ${mem.chronicGapAreas.join(', ')}`);
      }
    }

    const lines: string[] = [
      '╔══════════════════════════════════════════════════════════╗',
      '║  QA ORCHESTRATOR REPORT                                  ║',
      '╚══════════════════════════════════════════════════════════╝',
      '',
      `🎯 Final Status  : ${report.final_status}`,
      `⚠️  Risk Level    : ${report.risk_level}`,
      `📊 Coverage      : ${report.coverage_status}`,
      `🛠️  Phases Run    : ${report.tools_used.join(' → ')}`,
      ...memoryLines,
      '',
      '🧠 DECISIONS TAKEN',
      ...report.decisions.map((d, i) => `  ${i + 1}. ${d}`),
      '',
      '🔍 ISSUES FOUND',
      ...(report.issues_found.length > 0
        ? report.issues_found.map(i => `  • ${i}`)
        : ['  ✅ No issues found']),
      '',
      '✍️  ARTIFACTS GENERATED',
      ...(report.artifact_types_generated.length > 0
        ? report.artifact_types_generated.map(a => `  • ${a}`)
        : ['  — none (system stable or no gaps)']),
      '',
      '📋 JSON REPORT',
      JSON.stringify(
        { ...report, generated_context: report.generated_context ? '[see below]' : undefined },
        null,
        2,
      ),
    ];

    if (report.generated_context) {
      lines.push('', '─── GENERATED CONTEXT ───', '', report.generated_context);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `❌ Orchestrator error: ${message}` }],
      isError: true,
    };
  }
}
