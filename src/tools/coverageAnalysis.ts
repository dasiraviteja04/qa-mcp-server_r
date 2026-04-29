/**
 * MCP Tool: coverage_analysis
 *
 * Standalone coverage gap analysis tool.
 * Scans recently changed source files against existing .feature files
 * and reports areas with no or insufficient test coverage.
 */

import { GitService } from '../services/git.service.js';
import { CoverageService } from '../services/coverage.service.js';
import type { ToolOutput } from '../types/mcp.types.js';
import type { CoverageGap } from '../types/research.types.js';
import { getEnvironmentConfig } from '../config/environments.js';

interface CoverageAnalysisInput {
  since?: string;   // e.g. "7d", "14d", "30d" — default "14d"
  area?: string;    // limit to one feature area
}

function parseDays(since?: string): number {
  if (!since) return 14;
  const match = since.match(/^(\d+)d?$/i);
  return match ? parseInt(match[1] ?? '14', 10) : 14;
}

function formatCoverageReport(gaps: CoverageGap[], since: number, area?: string): string {
  const lines: string[] = [];

  lines.push(`📂 COVERAGE ANALYSIS`);
  lines.push(`  Scope: last ${since} days${area ? ` | Area: ${area}` : ''}`);
  lines.push('');

  if (gaps.length === 0) {
    lines.push('  ✅ No coverage gaps detected for recently changed files.');
    return lines.join('\n');
  }

  const critical = gaps.filter(g => g.scenarioCount === 0);
  const partial  = gaps.filter(g => g.scenarioCount > 0);

  if (critical.length > 0) {
    lines.push(`❌ NO COVERAGE (${critical.length} areas)`);
    lines.push('');
    for (const gap of critical) {
      lines.push(`  ❌ ${gap.area}`);
      lines.push(`     File:   ${gap.changedFile}`);
      lines.push(`     Commit: "${gap.commitMessage}" — ${new Date(gap.commitDate).toLocaleDateString()}`);
      lines.push(`     Fix:    ${gap.recommendation}`);
      lines.push('');
    }
  }

  if (partial.length > 0) {
    lines.push(`⚠️  PARTIAL COVERAGE (${partial.length} areas)`);
    lines.push('');
    for (const gap of partial) {
      lines.push(`  ⚠️  ${gap.area} — ${gap.scenarioCount} scenario(s) only`);
      lines.push(`     File:   ${gap.changedFile}`);
      lines.push(`     Fix:    ${gap.recommendation}`);
      lines.push('');
    }
  }

  lines.push(`  Total gaps found: ${gaps.length} (${critical.length} critical, ${partial.length} partial)`);

  return lines.join('\n');
}

export async function coverageAnalysis(input?: CoverageAnalysisInput): Promise<ToolOutput> {
  try {
    const config  = getEnvironmentConfig();
    const days    = parseDays(input?.since);
    const area    = input?.area;

    const gitService      = new GitService(config.playwrightProjectRoot);
    const coverageService = new CoverageService(config.featuresDir, config.playwrightProjectRoot);

    if (!gitService.isGitAvailable()) {
      return {
        content: [{
          type: 'text',
          text: '⚠️  Git is not available at the project root. Coverage gap analysis requires git history.'
        }]
      };
    }

    const commits = await gitService.getRecentCommits(days);
    if (commits.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `ℹ️  No commits found in the last ${days} days.`
        }]
      };
    }

    let gaps = coverageService.findGaps(commits);

    // Filter by area if specified
    if (area) {
      const areaLower = area.toLowerCase();
      gaps = gaps.filter(g => g.area.toLowerCase().includes(areaLower));
    }

    const formatted = formatCoverageReport(gaps, days, area);

    return {
      content: [{ type: 'text', text: formatted }]
    };

  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ Coverage analysis error: ${error.message}`
      }],
      isError: true
    };
  }
}
