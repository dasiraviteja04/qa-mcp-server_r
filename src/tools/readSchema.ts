/**
 * read_schema MCP tool
 *
 * Returns the live SQL Server schema (tables, columns, types, FK relationships)
 * so that generated DBMethods reference the exact column names from the real DB
 * instead of guessing.  Prevents the "Loan.Borrower" / "Email vs EmailAddress"
 * entity mapping errors.
 */

import { SchemaService } from '../services/schema.service.js';
import type { ToolOutput } from '../types/mcp.types.js';

interface ReadSchemaInput {
  tables?: string | string[];
}

export async function readSchema(input: ReadSchemaInput): Promise<ToolOutput> {
  const service = new SchemaService();

  // Accept tables as comma-separated string or array
  let tableFilter: string[] | undefined;
  if (input.tables) {
    tableFilter = Array.isArray(input.tables)
      ? input.tables
      : input.tables.split(',').map(t => t.trim()).filter(Boolean);
  }

  const schema = await service.readSchema(tableFilter);

  if (schema.tables.length === 0) {
    return {
      content: [{
        type: 'text',
        text: [
          '## Database Schema',
          '',
          '**No schema data available.**',
          '',
          'Possible reasons:',
          '  1. DB credentials not configured — set env vars DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD',
          '  2. The .runsettings file does not contain DBServer / DBName / DBUser / DBPassword parameters',
          '  3. The SQL Server is unreachable from this machine',
          '',
          `Active environment: ${process.env.TEST_ENV ?? 'development'}`,
          `Schema fetched at: ${schema.fetchedAt}`
        ].join('\n')
      }]
    };
  }

  const lines: string[] = [
    `## Database Schema — ${schema.database} @ ${schema.server}`,
    `_Fetched: ${schema.fetchedAt}_`,
    `_Tables returned: ${schema.tables.length}_`,
    ''
  ];

  for (const table of schema.tables) {
    lines.push(`### ${table.schema}.${table.table}`);
    lines.push('');
    lines.push('| Column | Type | Nullable | PK | FK → |');
    lines.push('|--------|------|----------|----|------|');

    for (const col of table.columns) {
      const pk = col.isPrimaryKey ? '✓' : '';
      const fk = col.isForeignKey ? `→ ${col.referencesTable ?? '?'}` : '';
      lines.push(
        `| ${col.name} | ${col.dataType} | ${col.nullable ? 'yes' : 'no'} | ${pk} | ${fk} |`
      );
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('**Usage:** Use these exact column names when writing DBMethods.cs queries and Entity Framework property mappings.');

  return {
    content: [{ type: 'text', text: lines.join('\n') }]
  };
}
