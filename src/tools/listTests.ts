/**
 * MCP Tool: List available tests with metadata
 */

import { PlaywrightService } from '../services/playwright.service.js';
import { ReportService } from '../services/report.service.js';
import type { ToolInput, ToolOutput, TestMetadata } from '../types/mcp.types.js';
import { getEnvironmentConfig } from '../config/environments.js';

let playwrightService: PlaywrightService | null = null;

/**
 * Initialize the service on first call
 */
function getService(): PlaywrightService {
  if (!playwrightService) {
    const config = getEnvironmentConfig();
    playwrightService = new PlaywrightService({
      projectRoot: config.playwrightProjectRoot,
      reportOutputDir: config.reportOutputDir
    });
  }
  return playwrightService;
}

/**
 * Parse test metadata from test names and history
 */
function extractTestMetadata(testName: string, reportService: ReportService): TestMetadata {
  // Extract tags from test name (e.g., "@critical @smoke")
  const tagMatches = testName.match(/@\w+/g) || [];
  const tags = tagMatches.map(t => t.substring(1));

  // Determine criticality
  let criticality: TestMetadata['criticality'] = 'medium';
  if (tags.includes('critical')) criticality = 'critical';
  else if (tags.includes('smoke')) criticality = 'high';
  else if (tags.includes('regression')) criticality = 'medium';
  else if (tags.includes('e2e')) criticality = 'high';

  // Extract feature from test structure
  const feature = extractFeatureFromName(testName);

  // Get history to check reliability
  const history = reportService.getTestHistory(testName, 5);
  const failureRate = history.filter(t => t.status === 'failed').length / Math.max(history.length, 1);
  
  // Adjust criticality based on failure rate
  if (failureRate > 0.4 && criticality === 'critical') {
    // Critical tests that fail frequently might need attention, but keep criticality
  }

  return {
    name: testName,
    tags,
    feature,
    criticality
  };
}

/**
 * Extract feature name from test name
 */
function extractFeatureFromName(testName: string): string {
  // Remove tags and parentheses
  let clean = testName.replace(/@\w+/g, '').trim();
  // Get first part before dash or space
  const match = clean.match(/^[^\-]+/) || clean.match(/^\w+/);
  return match ? match[0].trim() : 'general';
}

/**
 * List Tests Tool
 * Returns all available tests with metadata
 */
export async function listTests(input?: ToolInput): Promise<ToolOutput> {
  try {
    const service = getService();
    const reportService = new ReportService(getEnvironmentConfig().reportOutputDir);

    // Get test list from Playwright
    const testNames = service.getTestList();

    if (testNames.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No tests found in the Playwright project. Make sure tests exist and the project is configured correctly.'
        }]
      };
    }

    // Filter by tag if provided
    let filteredTests = testNames;
    if (input?.tags && typeof input.tags === 'string') {
      const tag = input.tags.toLowerCase();
      filteredTests = testNames.filter(t => t.toLowerCase().includes(`@${tag}`));
    }

    // Extract metadata for each test
    const testMetadata: TestMetadata[] = filteredTests.map(testName => 
      extractTestMetadata(testName, reportService)
    );

    // Group by feature
    const grouped: { [key: string]: TestMetadata[] } = {};
    testMetadata.forEach(test => {
      if (!grouped[test.feature]) {
        grouped[test.feature] = [];
      }
      grouped[test.feature]!.push(test);
    });

    // Format output
    let output = `Found ${testMetadata.length} tests:\n\n`;

    Object.entries(grouped).sort().forEach(([feature, tests]) => {
      output += `**${feature}** (${tests.length} tests)\n`;
      tests.forEach(test => {
        const tagStr = test.tags.join(', ') || 'untagged';
        output += `  • ${test.name} [${test.criticality}] (${tagStr})\n`;
      });
      output += '\n';
    });

    // Add summary
    const criticalCount = testMetadata.filter(t => t.criticality === 'critical').length;
    const smokeCount = testMetadata.filter(t => t.tags.includes('smoke')).length;
    const regressionCount = testMetadata.filter(t => t.tags.includes('regression')).length;

    output += `\n**Summary:**\n`;
    output += `  • Critical tests: ${criticalCount}\n`;
    output += `  • Smoke tests: ${smokeCount}\n`;
    output += `  • Regression tests: ${regressionCount}\n`;
    output += `  • Total tests: ${testMetadata.length}\n`;

    // Return as JSON array for better parsing
    const jsonOutput = JSON.stringify({
      total: testMetadata.length,
      tests: testMetadata,
      summary: {
        critical: criticalCount,
        smoke: smokeCount,
        regression: regressionCount
      }
    }, null, 2);

    return {
      content: [{
        type: 'text',
        text: output
      }]
    };
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error listing tests: ${error.message}`
      }],
      isError: true
    };
  }
}
