/**
 * MCP Tool: read_db_schema
 *
 * Connects to a SQL Server or PostgreSQL database using a connection string
 * from an environment variable, reads INFORMATION_SCHEMA.COLUMNS for the
 * specified tables, saves a structured schema JSON to memory/schemas/, and
 * optionally generates a fully-typed C# DBHelper .cs file from a blueprint.
 *
 * Steps:
 *   1. Read connection string from process.env[connection_env_key]
 *   2. Detect SQL Server or PostgreSQL from connection string format
 *   3. Query INFORMATION_SCHEMA.COLUMNS + PK/FK metadata per table
 *   4. Map each column to its C# type (int, string, DateTime, Guid, …)
 *   5. Save memory/schemas/{project_name}-schema.json
 *   6. Generate {ProjectName}DBHelper.cs with typed models + query methods
 *   7. Return structured summary
 */

import { DbSchemaService }       from '../services/dbSchema.service.js';
import type { ReadDbSchemaInput } from '../types/schema.types.js';
import type { ToolOutput }        from '../types/mcp.types.js';

export async function readDbSchema(input: ReadDbSchemaInput): Promise<ToolOutput> {
  try {
    if (!input.project_name?.trim()) {
      return { content: [{ type: 'text', text: '❌ project_name is required.' }], isError: true };
    }
    if (!input.connection_env_key?.trim()) {
      return { content: [{ type: 'text', text: '❌ connection_env_key is required.' }], isError: true };
    }
    if (!input.tables || input.tables.length === 0) {
      return { content: [{ type: 'text', text: '❌ tables array is required and must contain at least one table name.' }], isError: true };
    }

    const service = new DbSchemaService();
    const { schema, schemaPath, dbHelperPath, methodCount, warnings } =
      await service.run(input);

    const totalCols = schema.tables.reduce((s, t) => s + t.columns.length, 0);

    // ── Column preview (first two tables) ──────────────────────────────────
    const previewLines: string[] = [];
    for (const tbl of schema.tables.slice(0, 2)) {
      previewLines.push(`  ${tbl.tableName} (${tbl.columns.length} columns):`);
      for (const col of tbl.columns) {
        const flags: string[] = [];
        if (col.isPrimaryKey) flags.push('PK');
        if (col.isForeignKey) flags.push('FK');
        if (!col.isNullable)  flags.push('NOT NULL');
        if (col.hasDefault)   flags.push('DEFAULT');
        const flagStr = flags.length > 0 ? `  [${flags.join(', ')}]` : '';
        const lenStr  = col.maxLength !== null ? `(${col.maxLength})` : '';
        previewLines.push(
          `    ${col.columnName.padEnd(28)} ${(col.dataType + lenStr).padEnd(20)} → ${col.csharpType}${flagStr}`
        );
      }
    }
    if (schema.tables.length > 2) {
      previewLines.push(`  … and ${schema.tables.length - 2} more table(s)`);
    }

    const lines: string[] = [
      `✅ DB schema read for "${schema.projectName}"`,
      ``,
      `🗄️  Database     : ${schema.database}`,
      `🕐 Read at       : ${new Date(schema.readAt).toLocaleString()}`,
      ``,
      `📊 Summary:`,
      `   Tables read      : ${schema.tables.length}`,
      `   Total columns    : ${totalCols}`,
      `   Models generated : ${schema.tables.length}`,
      `   Methods generated: ${methodCount}`,
      ``,
      `🔍 Column preview:`,
      ...previewLines,
      ``,
      `💾 Schema saved  : ${schemaPath}`,
    ];

    if (dbHelperPath) {
      lines.push(`📄 DBHelper file : ${dbHelperPath}`);
      lines.push(`   → Typed models + ${methodCount} query method stubs ready to implement.`);
    } else {
      lines.push(`💡 Tip: Pass blueprint_name to auto-generate ${input.project_name}DBHelper.cs`);
    }

    if (warnings.length > 0) {
      lines.push('');
      lines.push('⚠️  Warnings:');
      warnings.forEach(w => lines.push(`   ${w}`));
    }

    lines.push('');
    lines.push('💡 Next steps:');
    lines.push(`   • get_schema({ project_name: "${schema.projectName}" })    — retrieve full schema JSON`);
    lines.push(`   • scaffold_project(...)   — will auto-use schema for ${schema.projectName}DBHelper.cs`);

    return { content: [{ type: 'text', text: lines.join('\n') }] };

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `❌ read_db_schema failed: ${msg}` }],
      isError: true,
    };
  }
}
