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
