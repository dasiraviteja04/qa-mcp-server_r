/**
 * Simplified tool implementations that match MCP SDK expectations
 */

import { listTests as listTestsImpl } from './listTests.js';
import { runTests as runTestsImpl } from './runTests.js';
import { getFailures as getFailuresImpl } from './getFailures.js';
import { getReleaseRisk as getReleaseRiskImpl } from './getReleaseRisk.js';
import { readSchema as readSchemaImpl } from './readSchema.js';
import { readStepInventory as readStepInventoryImpl } from './readStepInventory.js';
import { readPageSource as readPageSourceImpl } from './readPageSource.js';
import { generateTests as generateTestsImpl } from './generateTests.js';
import { autoResearch as autoResearchImpl } from './autoResearch.js';
import { coverageAnalysis as coverageAnalysisImpl } from './coverageAnalysis.js';
import { generateHtmlReport as generateHtmlReportImpl } from './generateHtmlReport.js';
import { scanFramework as scanFrameworkImpl }           from './scanFramework.js';
import { scaffoldProject as scaffoldProjectImpl }       from './scaffoldProject.js';
import { listBlueprints as listBlueprintsImpl }         from './listBlueprints.js';
import { crawlPage     as crawlPageImpl    } from './crawlPage.js';
import { getCrawl      as getCrawlImpl     } from './getCrawl.js';
import { listCrawls    as listCrawlsImpl   } from './listCrawls.js';
import { readDbSchema  as readDbSchemaImpl } from './readDbSchema.js';
import { getSchema     as getSchemaImpl    } from './getSchema.js';
import { listSchemas   as listSchemasImpl  } from './listSchemas.js';
import { readRequirements          as readRequirementsImpl          } from './readRequirements.js';
import { generateTestsFromRequirements as generateTestsFromRequirementsImpl } from './generateTestsFromRequirements.js';
import { requirementsCoverage      as requirementsCoverageImpl      } from './requirementsCoverage.js';
import { getRequirements           as getRequirementsImpl           } from './getRequirements.js';
import { listRequirements          as listRequirementsImpl          } from './listRequirements.js';

export async function listTests(input: any): Promise<any> {
  try {
    return await listTestsImpl(input);
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error listing tests: ${error.message}`
      }]
    };
  }
}

export async function runTests(input: any): Promise<any> {
  try {
    return await runTestsImpl(input);
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error running tests: ${error.message}`
      }]
    };
  }
}

export async function getFailures(input: any): Promise<any> {
  try {
    return await getFailuresImpl(input);
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error analyzing failures: ${error.message}`
      }]
    };
  }
}

export async function getReleaseRisk(input: any): Promise<any> {
  try {
    return await getReleaseRiskImpl(input);
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error assessing release risk: ${error.message}`
      }]
    };
  }
}

export async function readSchema(input: any): Promise<any> {
  try {
    return await readSchemaImpl(input);
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error reading schema: ${error.message}`
      }]
    };
  }
}

export async function readStepInventory(input: any): Promise<any> {
  try {
    return await readStepInventoryImpl(input);
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error reading step inventory: ${error.message}`
      }]
    };
  }
}

export async function readPageSource(input: any): Promise<any> {
  try {
    return await readPageSourceImpl(input);
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error reading page source: ${error.message}`
      }]
    };
  }
}

export async function generateTests(input: any): Promise<any> {
  try {
    return await generateTestsImpl(input);
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error generating test context: ${error.message}`
      }]
    };
  }
}

export async function autoResearch(input: any): Promise<any> {
  try {
    return await autoResearchImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in auto_research: ${error.message}` }]
    };
  }
}

export async function coverageAnalysis(input: any): Promise<any> {
  try {
    return await coverageAnalysisImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in coverage_analysis: ${error.message}` }]
    };
  }
}

export async function generateHtmlReport(input: any): Promise<any> {
  try {
    return await generateHtmlReportImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error generating HTML report: ${error.message}` }]
    };
  }
}

export async function scanFramework(input: any): Promise<any> {
  try {
    return await scanFrameworkImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in scan_framework: ${error.message}` }]
    };
  }
}

export async function scaffoldProject(input: any): Promise<any> {
  try {
    return await scaffoldProjectImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in scaffold_project: ${error.message}` }]
    };
  }
}

export async function listBlueprints(input: any): Promise<any> {
  try {
    return await listBlueprintsImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in list_blueprints: ${error.message}` }]
    };
  }
}

export async function crawlPage(input: any): Promise<any> {
  try {
    return await crawlPageImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in crawl_page: ${error.message}` }]
    };
  }
}

export async function getCrawl(input: any): Promise<any> {
  try {
    return await getCrawlImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in get_crawl: ${error.message}` }]
    };
  }
}

export async function listCrawls(input: any): Promise<any> {
  try {
    return await listCrawlsImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in list_crawls: ${error.message}` }]
    };
  }
}

export async function readDbSchema(input: any): Promise<any> {
  try {
    return await readDbSchemaImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in read_db_schema: ${error.message}` }]
    };
  }
}

export async function getSchema(input: any): Promise<any> {
  try {
    return await getSchemaImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in get_schema: ${error.message}` }]
    };
  }
}

export async function listSchemas(input: any): Promise<any> {
  try {
    return await listSchemasImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in list_schemas: ${error.message}` }]
    };
  }
}

export async function readRequirements(input: any): Promise<any> {
  try {
    return await readRequirementsImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in read_requirements: ${error.message}` }]
    };
  }
}

export async function generateTestsFromRequirements(input: any): Promise<any> {
  try {
    return await generateTestsFromRequirementsImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in generate_tests_from_requirements: ${error.message}` }]
    };
  }
}

export async function requirementsCoverage(input: any): Promise<any> {
  try {
    return await requirementsCoverageImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in requirements_coverage: ${error.message}` }]
    };
  }
}

export async function getRequirements(input: any): Promise<any> {
  try {
    return await getRequirementsImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in get_requirements: ${error.message}` }]
    };
  }
}

export async function listRequirements(input: any): Promise<any> {
  try {
    return await listRequirementsImpl(input);
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error in list_requirements: ${error.message}` }]
    };
  }
}
