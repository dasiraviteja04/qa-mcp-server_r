/**
 * MCP Tool: get_schema
 *
 * Reads the saved schema JSON for a given project from
 * memory/schemas/{project_name}-schema.json and returns the full result.
 * Used by scaffold_project internally to generate typed DBHelper files.
 */

import { DbSchemaService } from '../services/dbSchema.service.js';
import type { ToolOutput } from '../types/mcp.types.js';

interface GetSchemaInput {
  project_name: string;
}

export async function getSchema(input: GetSchemaInput): Promise<ToolOutput> {
  try {
    if (!input.project_name?.trim()) {
      return { content: [{ type: 'text', text: '❌ project_name is required.' }], isError: true };
    }

    const service = new DbSchemaService();
    const schema  = service.loadSchema(input.project_name.trim());

    const totalCols = schema.tables.reduce((s, t) => s + t.columns.length, 0);

    const lines: string[] = [
      `📋 DB Schema for "${schema.projectName}"`,
      ``,
      `🗄️  Database  : ${schema.database}`,
      `🕐 Read at   : ${new Date(schema.readAt).toLocaleString()}`,
      `📊 Tables    : ${schema.tables.length}  |  Columns: ${totalCols}`,
      ``,
      `── RAW JSON ──────────────────────────────────────────────────────────────`,
      JSON.stringify(schema, null, 2),
    ];

    return { content: [{ type: 'text', text: lines.join('\n') }] };

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `❌ get_schema failed: ${msg}` }],
      isError: true,
    };
  }
}
