/**
 * MCP Tool: auto_research
 *
 * Runs the AutoResearch loop on the most recent test execution report.
 * Investigates failures, correlates with git history, scans for coverage gaps,
 * and returns a synthesised ResearchReport with a release verdict.
 *
 * Can be called standalone after run_tests, or triggered automatically
 * via the autoResearch flag in run_tests input.
 */

import { ReportService } from '../services/report.service.js';
import { GitService } from '../services/git.service.js';
import { CoverageService } from '../services/coverage.service.js';
import { ResearchService } from '../services/research.service.js';
import type { ToolOutput } from '../types/mcp.types.js';
import type { ResearchReport, ResearchFinding, CoverageGap } from '../types/research.types.js';
import { getEnvironmentConfig } from '../config/environments.js';

interface AutoResearchInput {
  depth?: 'shallow' | 'deep';
  includeGit?: boolean;
  includeCoverage?: boolean;
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

function formatResearchReport(report: ResearchReport): string {
  const verdictIcon = { SAFE: '✅', CAUTION: '⚠️', BLOCK: '🚫' }[report.releaseVerdict];
  const lines: string[] = [];

  lines.push(`╔══════════════════════════════════════════════════════════╗`);
  lines.push(`║  AUTO-RESEARCH REPORT                                    ║`);
  lines.push(`║  Run: ${report.runId.substring(0, 20).padEnd(20)}  |  ${report.iterationsUsed} iterations          ║`);
  lines.push(`╚══════════════════════════════════════════════════════════╝`);
  lines.push('');

  // ── Test summary ──────────────────────────────────────────────────────────
  lines.push(`📊 TEST RESULTS`);
  lines.push(`  Total: ${report.totalTests}  |  ✓ Passed: ${report.passed}  |  ✗ Failed: ${report.failed}`);
  lines.push('');

  // ── Findings ──────────────────────────────────────────────────────────────
  if (report.findings.length === 0) {
    lines.push(`🔍 RESEARCH FINDINGS`);
    lines.push('  No issues detected.');
    lines.push('');
  } else {
    lines.push(`🔍 RESEARCH FINDINGS (${report.findings.length})`);
    lines.push('');

    const order: Array<ResearchFinding['severity']> = ['critical', 'high', 'medium', 'info'];
    const icons: Record<ResearchFinding['severity'], string> = {
      critical: '🔴', high: '🟠', medium: '🟡', info: '🔵'
    };

    for (const severity of order) {
      const group = report.findings.filter(f => f.severity === severity);
      if (group.length === 0) continue;

      lines.push(`${icons[severity]} ${severity.toUpperCase()} ${'─'.repeat(50)}`);
      lines.push('');

      for (const finding of group) {
        lines.push(`  [${finding.type}] ${finding.title}`);
        if (finding.testName) lines.push(`  Test: ${finding.testName}`);
        lines.push(`  Detail: ${finding.detail}`);
        if (finding.evidence.length > 0) {
          lines.push(`  Evidence:`);
          for (const e of finding.evidence) lines.push(`    • ${e}`);
        }
        lines.push(`  Action: → ${finding.suggestedAction}`);
        lines.push('');
      }
    }
  }

  // ── Coverage gaps ──────────────────────────────────────────────────────────
  if (report.coverageGaps.length > 0) {
    lines.push(`📂 COVERAGE GAPS (${report.coverageGaps.length})`);
    lines.push('');
    for (const gap of report.coverageGaps) {
      const icon = gap.scenarioCount === 0 ? '❌' : '⚠️ ';
      lines.push(`  ${icon} ${gap.area.padEnd(20)} — ${gap.scenarioCount} scenario(s) | ${gap.changedFile}`);
      lines.push(`     Commit: "${gap.commitMessage}" (${new Date(gap.commitDate).toLocaleDateString()})`);
      lines.push(`     Fix: ${gap.recommendation}`);
      lines.push('');
    }
  }

  // ── Release verdict ────────────────────────────────────────────────────────
  lines.push(`${'═'.repeat(58)}`);
  lines.push(`🚦 RELEASE VERDICT: ${verdictIcon} ${report.releaseVerdict}`);
  lines.push('');
  lines.push(`  ${report.verdictReason}`);
  lines.push('');

  // ── Next steps ─────────────────────────────────────────────────────────────
  if (report.suggestedNextSteps.length > 0) {
    lines.push(`📋 SUGGESTED NEXT STEPS`);
    report.suggestedNextSteps.forEach((step, i) => {
      lines.push(`  ${i + 1}. ${step}`);
    });
    lines.push('');
  }

  lines.push(`  Researched at: ${new Date(report.researchedAt).toLocaleString()}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export async function autoResearch(input?: AutoResearchInput): Promise<ToolOutput> {
  try {
    const config = getEnvironmentConfig();

    const reportService   = new ReportService(config.reportOutputDir);
    const gitService      = new GitService(config.playwrightProjectRoot);
    const appGitService   = config.appCodeRoot ? new GitService(config.appCodeRoot) : undefined;
    const coverageService = new CoverageService(config.featuresDir, config.playwrightProjectRoot);
    const researchService = new ResearchService(reportService, gitService, coverageService, config.playwrightProjectRoot, appGitService);

    const latestReport = reportService.getLatestReport();
    if (!latestReport) {
      return {
        content: [{
          type: 'text',
          text: '⚠️  No test report found. Run tests first with run_tests, then call auto_research.'
        }]
      };
    }

    const researchReport = await researchService.investigate(latestReport);
    const formatted = formatResearchReport(researchReport);

    return {
      content: [{ type: 'text', text: formatted }]
    };

  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ AutoResearch error: ${error.message}`
      }],
      isError: true
    };
  }
}
