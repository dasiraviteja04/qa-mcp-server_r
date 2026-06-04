/**
 * Type definitions for DB Schema Integration (read_db_schema tool).
 *
 * Separate from the lightweight ColumnInfo/TableSchema used by the existing
 * SchemaService / read_schema tool (which serves code-generation context).
 * These types drive the richer schema persistence + DBHelper generation flow.
 */

// ---------------------------------------------------------------------------
// Per-column detail
// ---------------------------------------------------------------------------

export interface SchemaColumn {
  columnName:  string;
  dataType:    string;    // raw SQL type  e.g. "nvarchar", "int", "datetime"
  csharpType:  string;    // mapped C# type  e.g. "string", "int", "DateTime?"
  isNullable:  boolean;
  maxLength:   number | null;
  hasDefault:  boolean;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
}

// ---------------------------------------------------------------------------
// Per-table detail
// ---------------------------------------------------------------------------

export interface SchemaTable {
  tableName: string;
  columns:   SchemaColumn[];
}

// ---------------------------------------------------------------------------
// Persisted document  (memory/schemas/{projectName}-schema.json)
// ---------------------------------------------------------------------------

export interface ProjectSchema {
  projectName: string;
  readAt:      string;        // ISO-8601
  database:    'SQL Server' | 'PostgreSQL';
  tables:      SchemaTable[];
}

// ---------------------------------------------------------------------------
// Summary (used by list_schemas)
// ---------------------------------------------------------------------------

export interface SchemaSummary {
  projectName: string;
  readAt:      string;
  database:    string;
  tableCount:  number;
}

// ---------------------------------------------------------------------------
// Tool input / output shapes
// ---------------------------------------------------------------------------

export interface ReadDbSchemaInput {
  project_name:        string;
  blueprint_name?:     string;
  connection_env_key:  string;
  tables?:             string[];
}

export interface ReadDbSchemaOutput {
  status:              'success' | 'error';
  projectName:         string;
  schemaSaved:         string;
  dbHelperGenerated?:  string;
  summary: {
    tablesRead:       number;
    totalColumns:     number;
    modelsGenerated:  number;
    methodsGenerated: number;
  };
  warnings: string[];
  error?:   string;
}
