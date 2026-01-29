/**
 * Simplified tool implementations that match MCP SDK expectations
 */

import { listTests as listTestsImpl } from './listTests.js';
import { runTests as runTestsImpl } from './runTests.js';
import { getFailures as getFailuresImpl } from './getFailures.js';
import { getReleaseRisk as getReleaseRiskImpl } from './getReleaseRisk.js';

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
