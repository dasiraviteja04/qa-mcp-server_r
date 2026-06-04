/**
 * MCP Tool: requirements_coverage
 *
 * Scans .feature files for @REQ-NNN tags, cross-references saved requirements,
 * optionally checks test results, and saves a coverage JSON to:
 *   memory/requirements/{project_name}-coverage.json
 *
 * Returns a plain text summary only.
 * HTML report is handled by the existing generate_html_report tool.
 * Language AGNOSTIC — reads .feature files only, never .cs or .ts.
 */

import { RequirementsCoverageService } from '../services/requirementsCoverage.service.js';
import type { ToolOutput }              from '../types/mcp.types.js';
import type { RequirementsCoverage }    from '../types/requirements.types.js';

interface RequirementsCoverageInput {
  project_name:          string;
  feature_files_path:    string;
  include_test_results?: boolean;
}

function buildSummaryText(coverage: RequirementsCoverage): string {
  const { summary, details, verdict, failingRequirements, notCoveredRequirements } = coverage;
  const { projectName } = coverage;

  const verdictIcon =
    verdict === 'SAFE'       ? '✅' :
    verdict === 'CAUTION'    ? '⚠️' :
    verdict === 'BLOCK'      ? '❌' :
    '🔵';

  // Sort details: FAILED first, then PASSED, then NO TEST
  const order = (r: string): number => {
    const d = details[r];
    if (!d) return 3;
    if (d.testResult === 'failed')  return 0;
    if (d.testResult === 'passed')  return 1;
    if (d.covered && !d.testResult) return 2;
    return 3;
  };

  const allReqIds = Object.keys(details).sort((a, b) => order(a) - order(b));

  // Passing list
  const passing = allReqIds
    .filter(id => details[id]?.testResult === 'passed')
    .map(id => {
      const d    = details[id]!;
      const name = d.scenarioName?.substring(0, 55) ?? id;
      return `   ${id.padEnd(9)} ${name.padEnd(56)} PASSED`;
    });

  // Failing list
  const failing = failingRequirements.map(id => {
    const d    = details[id];
    const name = d?.scenarioName?.substring(0, 55) ?? id;
    return `   ${id.padEnd(9)} ${name.padEnd(56)} FAILED`;
  });

  // Not covered list
  const notCovered = notCoveredRequirements.map(id => {
    // Get req text from parent — we only have details here so use id
    return `   ${id}`;
  });

  const sep = '═'.repeat(60);

  const lines: string[] = [
    sep,
    ` REQUIREMENTS COVERAGE — ${projectName}`,
    ` Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`,
    sep,
    ` 📊 SUMMARY`,
    ` Total Requirements  : ${summary.total}`,
    ` Covered             : ${summary.covered}  (${summary.coveragePercent}%)`,
    ` Not covered         : ${summary.notCovered}  (${100 - summary.coveragePercent}%)`,
    ` Tests passing       : ${summary.passing}`,
    ` Tests failing       : ${summary.failing}`,
    summary.notRun > 0 ? ` Tests not run       : ${summary.notRun}` : '',
    ``,
  ];

  if (passing.length > 0) {
    lines.push(` ✅ COVERED AND PASSING (${passing.length})`);
    lines.push(...passing);
    lines.push('');
  }

  if (failing.length > 0) {
    lines.push(` ❌ COVERED BUT FAILING (${failing.length})`);
    lines.push(...failing);
    lines.push('');
  }

  if (notCovered.length > 0) {
    lines.push(` ⚠️  NOT COVERED — NO TEST EXISTS (${notCovered.length})`);
    lines.push(...notCovered);
    lines.push('');
  }

  lines.push(
    ` 🚦 VERDICT: ${verdictIcon} ${verdict}`,
    ` Saved to: memory/requirements/${projectName}-coverage.json`,
    ` Run generate_html_report for full HTML traceability matrix.`,
    sep,
  );

  return lines.filter(l => l !== undefined).join('\n');
}

export async function requirementsCoverage(
  input: RequirementsCoverageInput
): Promise<ToolOutput> {
  try {
    if (!input.project_name?.trim()) {
      return { content: [{ type: 'text', text: '❌ project_name is required.' }], isError: true };
    }
    if (!input.feature_files_path?.trim()) {
      return { content: [{ type: 'text', text: '❌ feature_files_path is required.' }], isError: true };
    }

    const service  = new RequirementsCoverageService();
    const coverage = await service.run(input);
    const text     = buildSummaryText(coverage);

    return { content: [{ type: 'text', text }] };

  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ requirements_coverage failed: ${error.message}`,
      }],
      isError: true,
    };
  }
}
