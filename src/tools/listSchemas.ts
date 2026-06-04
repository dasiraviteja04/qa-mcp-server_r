/**
 * MCP Tool: list_schemas
 *
 * Reads all files in memory/schemas/ and returns a summary list:
 *   projectName | readAt | database | tableCount
 *
 * Use this to check if a schema exists before calling scaffold_project,
 * or to decide whether to re-read an updated schema.
 */

import { DbSchemaService } from '../services/dbSchema.service.js';
import type { ToolOutput } from '../types/mcp.types.js';

export async function listSchemas(_input?: unknown): Promise<ToolOutput> {
  try {
    const service = new DbSchemaService();
    const schemas = service.listSchemas();

    if (schemas.length === 0) {
      return {
        content: [{
          type: 'text',
          text: [
            `📂 No DB schemas saved yet.`,
            ``,
            `To read your first schema, run:`,
            `  read_db_schema({`,
            `    project_name:        "BillingPortal",`,
            `    connection_env_key:  "DB_CONNECTION_STRING",`,
            `    tables:              ["Invoices", "BillingAccounts"],`,
            `    blueprint_name:      "CouponHive"   // optional — generates DBHelper.cs`,
            `  })`,
            ``,
            `Supported connection string formats:`,
            `  SQL Server : "Server=host;Database=db;User Id=sa;Password=xxx;"`,
            `  PostgreSQL : "postgresql://user:password@localhost:5432/mydb"`,
          ].join('\n'),
        }],
      };
    }

    const lines: string[] = [
      `🗄️  Saved DB Schemas (${schemas.length})`,
      ``,
    ];

    for (const s of schemas) {
      const readDate = new Date(s.readAt).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      lines.push(`  ┌─ "${s.projectName}"`);
      lines.push(`  │  Read at    : ${readDate}`);
      lines.push(`  │  Database   : ${s.database}`);
      lines.push(`  │  Tables     : ${s.tableCount}`);
      lines.push(`  └─ Use with → get_schema({ project_name: "${s.projectName}" })`);
      lines.push('');
    }

    lines.push(`💡 Tip: Run read_db_schema again to refresh a schema after DB changes.`);
    lines.push(`        scaffold_project will auto-use schema columns when building DBHelper.cs.`);

    return { content: [{ type: 'text', text: lines.join('\n') }] };

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `❌ list_schemas failed: ${msg}` }],
      isError: true,
    };
  }
}
