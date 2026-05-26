/**
 * MCP Tool: list_requirements
 *
 * Lists all saved requirement sets in memory/requirements/.
 * Shows project name, read date, source file, total count,
 * and coverage % (if a coverage file exists alongside).
 */

import * as fs   from 'fs';
import * as path from 'path';
import { fileURLToPath }             from 'url';
import { RequirementsReaderService } from '../services/requirementsReader.service.js';
import type { ToolOutput }           from '../types/mcp.types.js';
import type { RequirementsCoverage } from '../types/requirements.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function memDir(): string {
  return path.join(__dirname, '..', '..', 'memory', 'requirements');
}

function loadCoverage(projectName: string): RequirementsCoverage | null {
  try {
    const p = path.join(memDir(), `${projectName}-coverage.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as RequirementsCoverage;
  } catch {
    return null;
  }
}

export async function listRequirements(_input?: unknown): Promise<ToolOutput> {
  try {
    const service = new RequirementsReaderService();
    const entries = service.listAll();

    if (entries.length === 0) {
      return {
        content: [{
          type: 'text',
          text: [
            `📂 No requirements saved yet.`,
            ``,
            `To read your first requirements document, run:`,
            `  read_requirements({`,
            `    project_name: "BillingPortal",`,
            `    file_path:    "C:\\\\docs\\\\BillingPortal-Requirements.docx",`,
            `    file_type:    "docx"`,
            `  })`,
            ``,
            `Supported formats: docx, pdf, xlsx, txt`,
          ].join('\n'),
        }],
      };
    }

    const lines: string[] = [
      `📋 Saved Requirements (${entries.length})`,
      ``,
    ];

    for (const entry of entries) {
      const coverage = loadCoverage(entry.projectName);
      const readDate = new Date(entry.readAt).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      lines.push(`  ┌─ "${entry.projectName}"`);
      lines.push(`  │  Read at     : ${readDate}`);
      lines.push(`  │  Source      : ${entry.sourceFile}`);
      lines.push(`  │  Requirements: ${entry.totalRequirements}`);

      if (coverage) {
        const pct     = coverage.summary.coveragePercent;
        const verdict = coverage.verdict;
        const icon    = verdict === 'SAFE' ? '✅' : verdict === 'CAUTION' ? '⚠️' : '❌';
        lines.push(`  │  Coverage    : ${pct}% (${coverage.summary.covered}/${coverage.summary.total}) ${icon} ${verdict}`);
        if (coverage.failingRequirements.length > 0) {
          lines.push(`  │  Failing     : ${coverage.failingRequirements.join(', ')}`);
        }
        if (coverage.notCoveredRequirements.length > 0) {
          lines.push(`  │  No test yet : ${coverage.notCoveredRequirements.slice(0, 5).join(', ')}${coverage.notCoveredRequirements.length > 5 ? '…' : ''}`);
        }
      } else {
        lines.push(`  │  Coverage    : not yet measured — run requirements_coverage`);
      }

      lines.push(`  └─ Use with → generate_tests_from_requirements({ project_name: "${entry.projectName}", ... })`);
      lines.push('');
    }

    lines.push(`💡 Tips:`);
    lines.push(`   • Re-run read_requirements after document changes to refresh`);
    lines.push(`   • Run requirements_coverage after tests to update coverage %`);
    lines.push(`   • Run generate_html_report to get full traceability matrix`);

    return { content: [{ type: 'text', text: lines.join('\n') }] };

  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `❌ list_requirements failed: ${error.message}` }],
      isError: true,
    };
  }
}
