/**
 * DbSchemaService
 *
 * Connects to a SQL Server or PostgreSQL database using a connection string
 * from an environment variable, reads INFORMATION_SCHEMA.COLUMNS for the
 * requested tables, maps each column to a C# type, persists the result as
 * memory/schemas/{projectName}-schema.json, and optionally generates a
 * fully-typed {ProjectName}DBHelper.cs file from a framework blueprint.
 *
 * Supports:
 *   SQL Server  — mssql  (already installed)
 *   PostgreSQL  — pg     (installed by this feature)
 */

import * as fs   from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as mssql from 'mssql';
import pg          from 'pg';
import type {
  ReadDbSchemaInput,
  ProjectSchema,
  SchemaTable,
  SchemaColumn,
  SchemaSummary,
} from '../types/schema.types.js';
import type { FrameworkBlueprint } from '../types/framework.types.js';
import { FrameworkMemoryService } from './frameworkMemory.service.js';

const { Pool: PgPool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function serverRoot(): string {
  return path.join(__dirname, '..', '..');
}
function schemasDir(): string {
  return path.join(serverRoot(), 'memory', 'schemas');
}
function outputDir(projectName: string): string {
  return path.join(serverRoot(), 'output', projectName);
}

// ---------------------------------------------------------------------------
// Connection string detection + parsing
// ---------------------------------------------------------------------------

type DbType = 'sqlserver' | 'postgresql';

function detectDbType(connStr: string): DbType {
  const lower = connStr.trim().toLowerCase();
  if (lower.startsWith('postgresql://') || lower.startsWith('postgres://')) {
    return 'postgresql';
  }
  return 'sqlserver';
}

interface SqlServerCreds {
  server:   string;
  database: string;
  user:     string;
  password: string;
}

/**
 * Parse an ODBC-style connection string:
 *   Server=myhost;Database=mydb;User Id=sa;Password=secret;
 *
 * Also handles URL-style:
 *   mssql://user:password@server/database
 */
function parseSqlServerConnStr(connStr: string): SqlServerCreds {
  const lower = connStr.trim().toLowerCase();

  // URL style  mssql://user:pass@server/db
  if (lower.startsWith('mssql://') || lower.startsWith('sqlserver://')) {
    const url = new URL(connStr.trim());
    return {
      server:   url.hostname + (url.port ? `,${url.port}` : ''),
      database: url.pathname.slice(1),
      user:     decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  }

  // ODBC key=value pairs
  const pairs: Record<string, string> = {};
  for (const segment of connStr.split(';')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const key = segment.slice(0, eq).trim().toLowerCase();
    const val = segment.slice(eq + 1).trim();
    pairs[key] = val;
  }

  const server   = pairs['server']           ?? pairs['data source']    ?? pairs['datasource']      ?? '';
  const database = pairs['database']         ?? pairs['initial catalog'] ?? pairs['initialcatalog']  ?? '';
  const user     = pairs['user id']          ?? pairs['uid']             ?? pairs['user']            ?? '';
  const password = pairs['password']         ?? pairs['pwd']             ?? '';

  if (!server || !database) {
    throw new Error(
      `Could not parse SQL Server connection string. ` +
      `Expected "Server=...;Database=...;User Id=...;Password=...;" ` +
      `or "mssql://user:pass@server/database".`
    );
  }

  return { server, database, user, password };
}

// ---------------------------------------------------------------------------
// C# type mapping
// ---------------------------------------------------------------------------

/**
 * Map a SQL column data type to the corresponding C# type.
 * Nullable value types get a trailing `?`.
 * Reference types (string, byte[]) never get `?` — use string? in CS12+
 * but for broad compatibility we emit string for nullable strings.
 */
function toCSharpType(sqlType: string, isNullable: boolean, warnings: string[]): string {
  const t = sqlType.toLowerCase().trim();

  const valueTypes: Record<string, string> = {
    // SQL Server
    'int':               'int',
    'bigint':            'long',
    'smallint':          'short',
    'tinyint':           'byte',
    'bit':               'bool',
    'decimal':           'decimal',
    'numeric':           'decimal',
    'money':             'decimal',
    'smallmoney':        'decimal',
    'float':             'double',
    'real':              'float',
    'datetime':          'DateTime',
    'datetime2':         'DateTime',
    'date':              'DateTime',
    'time':              'TimeSpan',
    'datetimeoffset':    'DateTimeOffset',
    'uniqueidentifier':  'Guid',
    // PostgreSQL
    'integer':                    'int',
    'bigserial':                  'long',
    'serial':                     'int',
    'boolean':                    'bool',
    'double precision':           'double',
    'timestamp without time zone':'DateTime',
    'timestamp with time zone':   'DateTimeOffset',
    'uuid':                       'Guid',
  };

  const refTypes: Record<string, string> = {
    'nvarchar':          'string',
    'varchar':           'string',
    'nchar':             'string',
    'char':              'string',
    'text':              'string',
    'ntext':             'string',
    'xml':               'string',
    'json':              'string',
    'jsonb':             'string',
    'binary':            'byte[]',
    'varbinary':         'byte[]',
    'image':             'byte[]',
    'bytea':             'byte[]',
    // PostgreSQL
    'character varying': 'string',
    'character':         'string',
  };

  if (t in valueTypes) {
    const csType = valueTypes[t]!;
    return isNullable ? `${csType}?` : csType;
  }
  if (t in refTypes) {
    const csType = refTypes[t]!;
    // Nullable strings → string? for clarity
    return isNullable && csType === 'string' ? 'string?' : csType;
  }

  // Unknown type — default to string and warn
  warnings.push(`⚠️  Unknown SQL type "${sqlType}" — defaulted to string`);
  return 'string';
}

// ---------------------------------------------------------------------------
// DbSchemaService
// ---------------------------------------------------------------------------

export class DbSchemaService {

  // ── Public entry point ─────────────────────────────────────────────────────

  async run(input: ReadDbSchemaInput): Promise<{
    schema:         ProjectSchema;
    schemaPath:     string;
    dbHelperPath:   string | null;
    methodCount:    number;
    warnings:       string[];
  }> {
    fs.mkdirSync(schemasDir(), { recursive: true });

    const connStr = process.env[input.connection_env_key];
    if (!connStr) {
      throw new Error(
        `Environment variable "${input.connection_env_key}" is not set. ` +
        `Set it to your database connection string before running this tool.`
      );
    }

    const dbType   = detectDbType(connStr);
    const warnings: string[] = [];

    // ── STEP 1+2: Connect + read schema ───────────────────────────────────
    const tables = dbType === 'postgresql'
      ? await this.readPostgres(connStr, input.tables ?? [], warnings)
      : await this.readSqlServer(connStr, input.tables ?? [], warnings);

    // ── STEP 3: Build + persist schema JSON ───────────────────────────────
    const schema: ProjectSchema = {
      projectName: input.project_name,
      readAt:      new Date().toISOString(),
      database:    dbType === 'postgresql' ? 'PostgreSQL' : 'SQL Server',
      tables,
    };

    const schemaPath = path.join(schemasDir(), `${input.project_name}-schema.json`);
    const tmp        = schemaPath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(schema, null, 2), 'utf-8');
    await fs.promises.rename(tmp, schemaPath);

    // ── STEP 4: Generate DBHelper (optional) ──────────────────────────────
    let dbHelperPath: string | null = null;
    let methodCount = 0;

    if (input.blueprint_name) {
      const result = await this.generateDbHelper(schema, input.blueprint_name, warnings);
      dbHelperPath = result.filePath;
      methodCount  = result.methodCount;
    }

    return { schema, schemaPath, dbHelperPath, methodCount, warnings };
  }

  // ── SQL Server reader ──────────────────────────────────────────────────────

  private async readSqlServer(
    connStr: string,
    tableNames: string[],
    warnings: string[]
  ): Promise<SchemaTable[]> {
    const creds  = parseSqlServerConnStr(connStr);
    const config: mssql.config = {
      server:   creds.server,
      database: creds.database,
      user:     creds.user,
      password: creds.password,
      options: {
        encrypt:              true,
        trustServerCertificate: true,
        connectTimeout:       15_000,
        requestTimeout:       30_000,
      },
    };

    let pool: mssql.ConnectionPool | null = null;
    try {
      pool = await mssql.connect(config);
      return await this.queryTablesFromPool(pool, tableNames, warnings);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `SQL Server connection failed (${creds.server}/${creds.database}): ${msg}`
      );
    } finally {
      if (pool) await pool.close().catch(() => undefined);
    }
  }

  private async queryTablesFromPool(
    pool: mssql.ConnectionPool,
    tableNames: string[],
    warnings: string[]
  ): Promise<SchemaTable[]> {
    const tables: SchemaTable[] = [];

    for (const tableName of tableNames) {
      try {
        const result = await pool.request()
          .input('tbl', mssql.NVarChar, tableName)
          .query<{
            COLUMN_NAME:             string;
            DATA_TYPE:               string;
            IS_NULLABLE:             string;
            CHARACTER_MAXIMUM_LENGTH: number | null;
            COLUMN_DEFAULT:          string | null;
          }>(`
            SELECT
              COLUMN_NAME,
              DATA_TYPE,
              IS_NULLABLE,
              CHARACTER_MAXIMUM_LENGTH,
              COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = @tbl
            ORDER BY ORDINAL_POSITION
          `);

        if (result.recordset.length === 0) {
          warnings.push(`⚠️  Table "${tableName}" not found or has no columns — skipped.`);
          continue;
        }

        // Also read PKs for this table
        const pkResult = await pool.request()
          .input('tbl2', mssql.NVarChar, tableName)
          .query<{ COLUMN_NAME: string }>(`
            SELECT KU.COLUMN_NAME
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS TC
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE  KU
              ON TC.CONSTRAINT_NAME = KU.CONSTRAINT_NAME
             AND TC.TABLE_NAME      = KU.TABLE_NAME
            WHERE TC.CONSTRAINT_TYPE = 'PRIMARY KEY'
              AND TC.TABLE_NAME      = @tbl2
          `);
        const pkCols = new Set(pkResult.recordset.map(r => r.COLUMN_NAME));

        // FK columns
        const fkResult = await pool.request()
          .input('tbl3', mssql.NVarChar, tableName)
          .query<{ COLUMN_NAME: string }>(`
            SELECT DISTINCT KU.COLUMN_NAME
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS TC
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE  KU
              ON TC.CONSTRAINT_NAME = KU.CONSTRAINT_NAME
             AND TC.TABLE_NAME      = KU.TABLE_NAME
            WHERE TC.CONSTRAINT_TYPE = 'FOREIGN KEY'
              AND TC.TABLE_NAME      = @tbl3
          `);
        const fkCols = new Set(fkResult.recordset.map(r => r.COLUMN_NAME));

        const columns: SchemaColumn[] = result.recordset.map(row => {
          const isNullable = row.IS_NULLABLE === 'YES';
          return {
            columnName:  row.COLUMN_NAME,
            dataType:    row.DATA_TYPE,
            csharpType:  toCSharpType(row.DATA_TYPE, isNullable, warnings),
            isNullable,
            maxLength:   row.CHARACTER_MAXIMUM_LENGTH ?? null,
            hasDefault:  row.COLUMN_DEFAULT !== null && row.COLUMN_DEFAULT !== '',
            ...(pkCols.has(row.COLUMN_NAME) ? { isPrimaryKey: true } : {}),
            ...(fkCols.has(row.COLUMN_NAME) ? { isForeignKey: true } : {}),
          };
        });

        tables.push({ tableName, columns });
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('not found')) {
          warnings.push(`⚠️  Table "${tableName}" not found — skipped.`);
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          warnings.push(`⚠️  Error reading table "${tableName}": ${msg} — skipped.`);
        }
      }
    }

    return tables;
  }

  // ── PostgreSQL reader ──────────────────────────────────────────────────────

  private async readPostgres(
    connStr: string,
    tableNames: string[],
    warnings: string[]
  ): Promise<SchemaTable[]> {
    const pool = new PgPool({ connectionString: connStr, connectionTimeoutMillis: 15_000 });
    const client = await pool.connect().catch((e: Error) => {
      throw new Error(`PostgreSQL connection failed: ${e.message}`);
    });

    try {
      const tables: SchemaTable[] = [];

      for (const tableName of tableNames) {
        try {
          const colRes = await client.query<{
            column_name:              string;
            data_type:                string;
            is_nullable:              string;
            character_maximum_length: number | null;
            column_default:           string | null;
          }>(
            `SELECT
               column_name,
               data_type,
               is_nullable,
               character_maximum_length,
               column_default
             FROM information_schema.columns
             WHERE table_name = $1
             ORDER BY ordinal_position`,
            [tableName]
          );

          if (colRes.rows.length === 0) {
            warnings.push(`⚠️  Table "${tableName}" not found or has no columns — skipped.`);
            continue;
          }

          // PK detection for Postgres
          const pkRes = await client.query<{ column_name: string }>(
            `SELECT kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_name      = kcu.table_name
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_name      = $1`,
            [tableName]
          );
          const pkCols = new Set(pkRes.rows.map(r => r.column_name));

          const fkRes = await client.query<{ column_name: string }>(
            `SELECT DISTINCT kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_name      = kcu.table_name
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND tc.table_name      = $1`,
            [tableName]
          );
          const fkCols = new Set(fkRes.rows.map(r => r.column_name));

          const columns: SchemaColumn[] = colRes.rows.map(row => {
            const isNullable = row.is_nullable === 'YES';
            return {
              columnName:  row.column_name,
              dataType:    row.data_type,
              csharpType:  toCSharpType(row.data_type, isNullable, warnings),
              isNullable,
              maxLength:   row.character_maximum_length ?? null,
              hasDefault:  row.column_default !== null && row.column_default !== '',
              ...(pkCols.has(row.column_name) ? { isPrimaryKey: true } : {}),
              ...(fkCols.has(row.column_name) ? { isForeignKey: true } : {}),
            };
          });

          tables.push({ tableName, columns });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          warnings.push(`⚠️  Error reading table "${tableName}": ${msg} — skipped.`);
        }
      }

      return tables;
    } finally {
      client.release();
      await pool.end().catch(() => undefined);
    }
  }

  // ── DBHelper generation ────────────────────────────────────────────────────

  async generateDbHelper(
    schema: ProjectSchema,
    blueprintName: string,
    warnings: string[]
  ): Promise<{ filePath: string; methodCount: number }> {
    const memSvc    = new FrameworkMemoryService();
    const blueprint = memSvc.loadBlueprint(blueprintName);
    const outDir    = outputDir(schema.projectName);
    fs.mkdirSync(outDir, { recursive: true });

    const { content, methodCount } = this.buildDbHelperCs(schema, blueprint, warnings);
    const filePath = path.join(outDir, `${schema.projectName}DBHelper.cs`);
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { filePath, methodCount };
  }

  /** Build the full C# DBHelper string. Exposed publicly for scaffoldProject. */
  buildDbHelperCs(
    schema:    ProjectSchema,
    blueprint: FrameworkBlueprint,
    warnings:  string[]
  ): { content: string; methodCount: number } {
    const db   = blueprint.dbHelper;
    const name = schema.projectName;
    const ns   = db.namespace || `${name}.Tests.Support`;

    const usings = db.orm.includes('EF Core')
      ? 'using Microsoft.EntityFrameworkCore;'
      : 'using Microsoft.Data.SqlClient;';

    // ── Model classes ──────────────────────────────────────────────────────
    const modelLines: string[] = [];
    for (const tbl of schema.tables) {
      const modelName = toModelName(tbl.tableName);
      modelLines.push(`    /// <summary>Model for the ${tbl.tableName} table.</summary>`);
      modelLines.push(`    public class ${modelName}`);
      modelLines.push('    {');
      for (const col of tbl.columns) {
        const pkNote  = col.isPrimaryKey ? ' // PK' : '';
        const fkNote  = col.isForeignKey ? ' // FK' : '';
        const lenNote = col.maxLength !== null ? ` // maxLength: ${col.maxLength}` : '';
        modelLines.push(`        public ${col.csharpType} ${col.columnName} { get; set; }${pkNote}${fkNote}${lenNote}`);
      }
      modelLines.push('    }');
      modelLines.push('');
    }

    // ── Query methods ──────────────────────────────────────────────────────
    const methodLines: string[] = [];
    let methodCount = 0;

    for (const tbl of schema.tables) {
      const modelName  = toModelName(tbl.tableName);
      const colList    = tbl.columns.map(c => c.columnName).join(', ');
      const pkCol      = tbl.columns.find(c => c.isPrimaryKey);
      const naturalPk  = tbl.columns.find(c =>
        c.columnName.toLowerCase() === `${tbl.tableName.toLowerCase()}id` ||
        c.columnName.toLowerCase() === 'id'
      ) ?? pkCol;

      methodLines.push(`        // ── ${tbl.tableName} ` + '─'.repeat(Math.max(0, 56 - tbl.tableName.length)));
      methodLines.push('');

      // GetAll
      methodLines.push(`        /// <summary>Return all rows from ${tbl.tableName}.</summary>`);
      methodLines.push(`        public async Task<List<${modelName}>> GetAll${tbl.tableName}Async()`);
      methodLines.push('        {');
      methodLines.push(`            // Columns: ${colList}`);
      methodLines.push(`            throw new NotImplementedException();`);
      methodLines.push('        }');
      methodLines.push('');
      methodCount++;

      // GetByPrimaryKey
      if (naturalPk) {
        methodLines.push(`        /// <summary>Find a ${modelName} by its primary key.</summary>`);
        methodLines.push(`        public async Task<${modelName}?> Get${modelName}By${naturalPk.columnName}Async(${naturalPk.csharpType.replace('?', '')} ${lcFirst(naturalPk.columnName)})`);
        methodLines.push('        {');
        methodLines.push(`            throw new NotImplementedException();`);
        methodLines.push('        }');
        methodLines.push('');
        methodCount++;
      }

      // Lookup methods for interesting columns
      const lookupCandidates = tbl.columns.filter(c => {
        if (c === naturalPk || c.isPrimaryKey) return false;
        const n = c.columnName.toLowerCase();
        return (
          n === 'email'         || n === 'username'      || n === 'accountnumber' ||
          n === 'status'        || n === 'referencenumber'|| n === 'policynumber' ||
          (n.endsWith('id') && c.isForeignKey)
        );
      }).slice(0, 2);   // max 2 lookup methods per table

      for (const col of lookupCandidates) {
        const paramType = col.csharpType.replace('?', '');
        methodLines.push(`        /// <summary>Find ${modelName} rows by ${col.columnName}.</summary>`);
        methodLines.push(`        public async Task<List<${modelName}>> Get${tbl.tableName}By${col.columnName}Async(${paramType} ${lcFirst(col.columnName)})`);
        methodLines.push('        {');
        methodLines.push(`            throw new NotImplementedException();`);
        methodLines.push('        }');
        methodLines.push('');
        methodCount++;
      }

      // Count
      methodLines.push(`        /// <summary>Return the total number of rows in ${tbl.tableName}.</summary>`);
      methodLines.push(`        public async Task<int> Get${tbl.tableName}CountAsync()`);
      methodLines.push('        {');
      methodLines.push(`            throw new NotImplementedException();`);
      methodLines.push('        }');
      methodLines.push('');
      methodCount++;
    }

    const readDate = new Date(schema.readAt).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });

    const content = [
      usings,
      `using ${ns.split('.').slice(0, -1).join('.')}.Config;`,
      ``,
      `namespace ${ns}`,
      `{`,
      `    // ── Typed models ──────────────────────────────────────────────────────────`,
      `    // Auto-generated from ${schema.database} schema on ${readDate}`,
      `    // Blueprint: ${blueprint.projectName}`,
      `    // Tables   : ${schema.tables.map(t => t.tableName).join(', ')}`,
      ``,
      ...modelLines,
      `    // ── DB Helper ─────────────────────────────────────────────────────────────`,
      ``,
      `    public class ${name}DBHelper`,
      `    {`,
      `        private readonly string _connectionString;`,
      ``,
      `        public ${name}DBHelper()`,
      `        {`,
      `            _connectionString = ${db.connectionSource}.${db.connectionMethod}();`,
      `        }`,
      ``,
      ...methodLines,
      `    }`,
      `}`,
      ``,
    ].join('\n');

    return { content, methodCount };
  }

  // ── Read / List helpers ────────────────────────────────────────────────────

  loadSchema(projectName: string): ProjectSchema {
    const p = path.join(schemasDir(), `${projectName}-schema.json`);
    if (!fs.existsSync(p)) {
      throw new Error(
        `No schema found for "${projectName}". Run read_db_schema first.`
      );
    }
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ProjectSchema;
  }

  hasSchema(projectName: string): boolean {
    return fs.existsSync(path.join(schemasDir(), `${projectName}-schema.json`));
  }

  listSchemas(): SchemaSummary[] {
    const dir = schemasDir();
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('-schema.json'))
        .map((f): SchemaSummary | null => {
          try {
            const raw = JSON.parse(
              fs.readFileSync(path.join(dir, f), 'utf-8')
            ) as ProjectSchema;
            return {
              projectName: raw.projectName,
              readAt:      raw.readAt,
              database:    raw.database,
              tableCount:  raw.tables.length,
            };
          } catch { return null; }
        })
        .filter((s): s is SchemaSummary => s !== null)
        .sort((a, b) => b.readAt.localeCompare(a.readAt));
    } catch { return []; }
  }
}

// ---------------------------------------------------------------------------
// Utility helpers (module-level)
// ---------------------------------------------------------------------------

/** Convert a plural SQL table name to a singular C# model name.
 *  Invoices → Invoice  |  BillingAccounts → BillingAccount  |  Users → User */
function toModelName(tableName: string): string {
  // Simple English depluralization heuristics
  if (/ies$/i.test(tableName))  return tableName.slice(0, -3) + 'y';
  if (/ses$/i.test(tableName))  return tableName.slice(0, -2);
  if (/s$/i.test(tableName))    return tableName.slice(0, -1);
  return tableName;
}

/** Lower-case the first character of a string (for parameter names). */
function lcFirst(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}
