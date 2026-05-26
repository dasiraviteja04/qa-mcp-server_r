/**
 * MCP Tool: get_requirements
 *
 * Reads the saved requirements JSON for a project from
 * memory/requirements/{project_name}-requirements.json.
 * Returns the full structured document with all requirements.
 */

import { RequirementsReaderService } from '../services/requirementsReader.service.js';
import type { ToolOutput }           from '../types/mcp.types.js';

export async function getRequirements(input: { project_name: string }): Promise<ToolOutput> {
  try {
    if (!input.project_name?.trim()) {
      return { content: [{ type: 'text', text: '❌ project_name is required.' }], isError: true };
    }

    const service = new RequirementsReaderService();
    const doc     = service.load(input.project_name);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(doc, null, 2),
      }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `❌ get_requirements failed: ${error.message}` }],
      isError: true,
    };
  }
}
