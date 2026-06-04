/**
 * MCP Tool: read_requirements
 *
 * Reads a requirements document (docx/pdf/xlsx/txt), parses individual
 * requirements, assigns REQ-NNN IDs, classifies each by type and priority,
 * and saves to memory/requirements/{project_name}-requirements.json.
 */

import { RequirementsReaderService } from '../services/requirementsReader.service.js';
import type { ToolOutput }           from '../types/mcp.types.js';

interface ReadRequirementsInput {
  project_name: string;
  file_path:    string;
  file_type:    'docx' | 'pdf' | 'xlsx' | 'txt';
}

export async function readRequirements(input: ReadRequirementsInput): Promise<ToolOutput> {
  try {
    if (!input.project_name?.trim()) {
      return { content: [{ type: 'text', text: '❌ project_name is required.' }], isError: true };
    }
    if (!input.file_path?.trim()) {
      return { content: [{ type: 'text', text: '❌ file_path is required.' }], isError: true };
    }
    if (!input.file_type) {
      return { content: [{ type: 'text', text: '❌ file_type is required (docx|pdf|xlsx|txt).' }], isError: true };
    }

    const service = new RequirementsReaderService();
    const doc     = await service.run(input);

    // Build type + priority breakdowns
    const byType:     Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const req of doc.requirements) {
      byType[req.type]         = (byType[req.type]         ?? 0) + 1;
      byPriority[req.priority] = (byPriority[req.priority] ?? 0) + 1;
    }

    const typeLines = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `     ${t.padEnd(14)}: ${n}`)
      .join('\n');

    const priorityLines = Object.entries(byPriority)
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `     ${p.padEnd(8)}: ${n}`)
      .join('\n');

    const sampleReqs = doc.requirements.slice(0, 5)
      .map(r => `   ${r.id}  [${r.priority.toUpperCase()}]  ${r.text.substring(0, 80)}${r.text.length > 80 ? '…' : ''}`)
      .join('\n');

    const lines = [
      `✅ Requirements read from "${doc.sourceFile}"`,
      ``,
      `📁 Saved to: memory/requirements/${doc.projectName}-requirements.json`,
      ``,
      `📊 SUMMARY`,
      `   Total requirements : ${doc.totalRequirements}`,
      `   Sections detected  : ${doc.sections.length} (${doc.sections.slice(0, 4).join(', ')}${doc.sections.length > 4 ? '…' : ''})`,
      ``,
      `   By type:`,
      typeLines,
      ``,
      `   By priority:`,
      priorityLines,
      ``,
      `📋 First ${Math.min(5, doc.requirements.length)} requirements:`,
      sampleReqs,
      ``,
      `🚀 Next steps:`,
      `   1. Run scaffold_project to create the base test skeleton`,
      `   2. Run generate_tests_from_requirements to add @REQ-XXX scenarios`,
      `   3. Run requirements_coverage after tests to measure traceability`,
    ];

    return { content: [{ type: 'text', text: lines.join('\n') }] };

  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `❌ read_requirements failed: ${error.message}` }],
      isError: true,
    };
  }
}
