/**
 * Type definitions for the Framework Memory system.
 * Used by FrameworkMemoryService, scan_framework, scaffold_project, list_blueprints.
 */

// ---------------------------------------------------------------------------
// Blueprint shape — saved to memory/frameworks/{name}-blueprint.json
// ---------------------------------------------------------------------------

export interface PageObjectPattern {
  /** Base class the page inherits from, or null if none */
  baseClass:         string | null;
  /** Constructor parameter types, e.g. ["IPage", "ScenarioContext"] */
  constructorParams: string[];
  /** How locators are declared, e.g. "private ILocator properties" */
  locatorStyle:      string;
  /** Async method pattern, e.g. "async Task methods" */
  asyncPattern:      string;
  /** Example method names extracted (up to 5) */
  exampleMethods:    string[];
  /** Namespace detected */
  namespace:         string;
}

export interface StepDefinitionPattern {
  /** Base class, or null */
  baseClass:         string | null;
  /** Constructor parameter types */
  injection:         string[];
  /** Attribute style, e.g. "[Given]/[When]/[Then] attributes" */
  bindingStyle:      string;
  /** Naming convention observed from method names */
  namingConvention:  string;
  /** Example step text patterns (up to 5) */
  exampleSteps:      string[];
  /** Namespace detected */
  namespace:         string;
}

export interface DbHelperPattern {
  /** ORM or raw SQL, e.g. "raw SqlConnection" or "EF Core DbContext" */
  orm:               string;
  /** Class that provides the connection string */
  connectionSource:  string;
  /** Connection string method name */
  connectionMethod:  string;
  /** Example query method names (up to 5) */
  exampleMethods:    string[];
  /** Namespace detected */
  namespace:         string;
}

export interface TestContextPattern {
  /** Fields / properties injected */
  fields:       string[];
  /** Constructor params */
  constructorParams: string[];
  /** Namespace detected */
  namespace:    string;
}

export interface ProjectSetupPattern {
  /** Target framework from .csproj, e.g. "net8.0" */
  targetFramework:    string;
  /** Test runner + BDD framework, e.g. "NUnit + Reqnroll" */
  testFramework:      string;
  /** NuGet packages referenced */
  packages:           string[];
  /** Pattern of runsettings file, e.g. "TestRunParameters block" */
  runsettingsPattern: string;
  /** Root namespace from .csproj */
  rootNamespace:      string;
}

export interface FrameworkBlueprint {
  projectName:   string;
  scannedAt:     string;      // ISO timestamp
  projectPath:   string;      // Original path scanned
  pageObject:    PageObjectPattern;
  stepDefinition: StepDefinitionPattern;
  dbHelper:      DbHelperPattern;
  testContext:   TestContextPattern;
  projectSetup:  ProjectSetupPattern;
  /** Raw file counts found during scan */
  scanSummary: {
    pageFiles:      number;
    stepFiles:      number;
    dbHelperFiles:  number;
    contextFiles:   number;
    runsettings:    number;
    csprojFiles:    number;
  };
}

// ---------------------------------------------------------------------------
// Blueprint list entry — returned by list_blueprints
// ---------------------------------------------------------------------------

export interface BlueprintSummary {
  name:        string;
  scannedAt:   string;
  projectPath: string;
  filePath:    string;
}

// ---------------------------------------------------------------------------
// Scaffold input / output
// ---------------------------------------------------------------------------

export interface ScaffoldInput {
  blueprint_name:    string;
  new_project_name:  string;
  output_path:       string;
  page_url?:         string;
  db_tables?:        string[];
}

export interface ScaffoldResult {
  filesGenerated: string[];
  warnings:       string[];
}
