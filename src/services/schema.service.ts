/**
 * SchemaService — reads the SQL Server database schema.
 *
 * Used by the generate_tests tool so that generated DBMethods and
 * step definitions reference the correct column names, types, and
 * foreign-key relationships instead of guessing.
 *
 * Credentials are resolved in this priority order:
 *   1. Environment variables: DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD
 *   2. Active .runsettings XML file for the current TEST_ENV
 *   3. Returns an empty schema with an explanatory message if both fail
 */

import * as fs from 'fs';
import * as path from 'path';
import * as sql from 'mssql';
import { XMLParser } from 'fast-xml-parser';
import { getEnvironmentConfig } from '../config/environments.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  referencesTable?: string;
}

export interface TableSchema {
  table: string;
  schema: string;
  columns: ColumnInfo[];
}

export interface DatabaseSchema {
  server: string;
  database: string;
  tables: TableSchema[];
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// SchemaService
// ---------------------------------------------------------------------------

export class SchemaService {

  // -------------------------------------------------------------------------
  // Entry point
  // -------------------------------------------------------------------------

  async readSchema(tableFilter?: string[]): Promise<DatabaseSchema> {
    const creds = this.resolveCredentials();

    if (!creds) {
      return {
        server: 'unknown',
        database: 'unknown',
        tables: [],
        fetchedAt: new Date().toISOString()
      };
    }

    const config: sql.config = {
      server: creds.server,
      database: creds.database,
      user: creds.user,
      password: creds.password,
      options: {
        encrypt: true,
        trustServerCertificate: true,
        connectTimeout: 15000,
        requestTimeout: 30000
      }
    };

    let pool: sql.ConnectionPool | null = null;
    try {
      pool = await sql.connect(config);
      const [columns, pkCols, fkMap] = await Promise.all([
        this.fetchColumns(pool, tableFilter),
        this.fetchPrimaryKeys(pool),
        this.fetchForeignKeys(pool)
      ]);
      const tables = this.buildTableSchemas(columns, pkCols, fkMap, tableFilter);
      return {
        server: creds.server,
        database: creds.database,
        tables,
        fetchedAt: new Date().toISOString()
      };
    } finally {
      if (pool) await pool.close();
    }
  }

  // -------------------------------------------------------------------------
  // SQL queries
  // -------------------------------------------------------------------------

  private async fetchColumns(
    pool: sql.ConnectionPool,
    tableFilter?: string[]
  ): Promise<any[]> {
    let query = `
      SELECT
        TABLE_SCHEMA,
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
    `;
    if (tableFilter && tableFilter.length > 0) {
      const placeholders = tableFilter.map((_, i) => `@t${i}`).join(', ');
      query += ` WHERE TABLE_NAME IN (${placeholders})`;
      const req = pool.request();
      tableFilter.forEach((t, i) => req.input(`t${i}`, sql.NVarChar, t));
      const result = await req.query(query);
      return result.recordset;
    }
    const result = await pool.request().query(query + ' ORDER BY TABLE_NAME, ORDINAL_POSITION');
    return result.recordset;
  }

  private async fetchPrimaryKeys(pool: sql.ConnectionPool): Promise<Set<string>> {
    const result = await pool.request().query(`
      SELECT
        KU.TABLE_NAME,
        KU.COLUMN_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS TC
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE KU
        ON TC.CONSTRAINT_NAME = KU.CONSTRAINT_NAME
       AND TC.TABLE_NAME      = KU.TABLE_NAME
      WHERE TC.CONSTRAINT_TYPE = 'PRIMARY KEY'
    `);
    return new Set<string>(
      result.recordset.map((r: any) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`)
    );
  }

  private async fetchForeignKeys(
    pool: sql.ConnectionPool
  ): Promise<Map<string, string>> {
    // Returns map of "TableName.ColumnName" → "ReferencedTableName"
    const result = await pool.request().query(`
      SELECT
        FK_COLS.TABLE_NAME,
        FK_COLS.COLUMN_NAME,
        PK_COLS.TABLE_NAME AS REFERENCED_TABLE
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS RC
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE FK_COLS
        ON RC.CONSTRAINT_NAME        = FK_COLS.CONSTRAINT_NAME
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE PK_COLS
        ON RC.UNIQUE_CONSTRAINT_NAME = PK_COLS.CONSTRAINT_NAME
       AND FK_COLS.ORDINAL_POSITION  = PK_COLS.ORDINAL_POSITION
    `);
    const map = new Map<string, string>();
    for (const r of result.recordset) {
      map.set(`${r.TABLE_NAME}.${r.COLUMN_NAME}`, r.REFERENCED_TABLE);
    }
    return map;
  }

  // -------------------------------------------------------------------------
  // Schema assembly
  // -------------------------------------------------------------------------

  private buildTableSchemas(
    rawColumns: any[],
    pkCols: Set<string>,
    fkMap: Map<string, string>,
    tableFilter?: string[]
  ): TableSchema[] {
    // Group columns by table
    const tableMap = new Map<string, TableSchema>();

    for (const col of rawColumns) {
      const key = `${col.TABLE_SCHEMA}.${col.TABLE_NAME}`;
      if (!tableMap.has(key)) {
        tableMap.set(key, {
          table: col.TABLE_NAME,
          schema: col.TABLE_SCHEMA,
          columns: []
        });
      }
      const tableKey = `${col.TABLE_NAME}.${col.COLUMN_NAME}`;
      const referencesTable = fkMap.get(tableKey);
      tableMap.get(key)!.columns.push({
        name: col.COLUMN_NAME,
        dataType: col.DATA_TYPE,
        nullable: col.IS_NULLABLE === 'YES',
        isPrimaryKey: pkCols.has(tableKey),
        isForeignKey: fkMap.has(tableKey),
        ...(referencesTable !== undefined ? { referencesTable } : {})
      });
    }

    const tables = Array.from(tableMap.values());

    // Apply table name filter (case-insensitive) if provided
    if (tableFilter && tableFilter.length > 0) {
      const lower = tableFilter.map(t => t.toLowerCase());
      return tables.filter(t => lower.includes(t.table.toLowerCase()));
    }

    return tables.sort((a, b) => a.table.localeCompare(b.table));
  }

  // -------------------------------------------------------------------------
  // Credential resolution
  // -------------------------------------------------------------------------

  private resolveCredentials(): {
    server: string;
    database: string;
    user: string;
    password: string;
  } | null {
    // 1. Environment variables (CI / local override)
    if (
      process.env.DB_SERVER &&
      process.env.DB_NAME &&
      process.env.DB_USER &&
      process.env.DB_PASSWORD
    ) {
      return {
        server: process.env.DB_SERVER,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD
      };
    }

    // 2. Parse .runsettings XML for the active environment
    try {
      const config = getEnvironmentConfig();
      const runSettingsPath = path.join(
        config.playwrightProjectRoot,
        config.runSettingsFile
      );
      if (!fs.existsSync(runSettingsPath)) return null;

      const xml = fs.readFileSync(runSettingsPath, 'utf-8');
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_'
      });
      const parsed = parser.parse(xml);

      // Standard runsettings structure:
      //   <RunSettings>
      //     <TestRunParameters>
      //       <Parameter name="DBServer" value="..." />
      //       ...
      //     </TestRunParameters>
      //   </RunSettings>
      const params: any[] =
        parsed?.RunSettings?.TestRunParameters?.Parameter ?? [];

      const get = (name: string): string => {
        const p = params.find(
          (p: any) =>
            (p['@_name'] ?? '').toLowerCase() === name.toLowerCase()
        );
        return p?.['@_value'] ?? '';
      };

      const server   = get('DBServer')   || get('SqlServer')  || get('Server');
      const database = get('DBName')     || get('Database')   || get('DBCatalog');
      const user     = get('DBUser')     || get('SqlUser')    || get('DBUserId');
      const password = get('DBPassword') || get('SqlPassword')|| get('DBPass');

      if (server && database) {
        return { server, database, user, password };
      }
    } catch {
      // fall through
    }

    return null;
  }
}
