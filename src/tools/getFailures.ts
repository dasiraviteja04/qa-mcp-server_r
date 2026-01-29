/**
 * MCP Tool: Get failure analysis from latest test run
 */

import { PlaywrightService } from '../services/playwright.service.js';
import { ReportService } from '../services/report.service.js';
import type { ToolInput, ToolOutput, FailureAnalysis } from '../types/mcp.types.js';
import { getEnvironmentConfig } from '../config/environments.js';

let playwrightService: PlaywrightService | null = null;

/**
 * Initialize the service
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
 * Format failure analysis for display
 */
function formatFailureAnalysis(analyses: FailureAnalysis[]): string {
  if (analyses.length === 0) {
    return 'No failures detected in the latest test run! ✓';
  }

  let output = `**Failure Analysis** (${analyses.length} failures)\n\n`;

  // Group by classification
  const byClassification: { [key: string]: FailureAnalysis[] } = {};
  analyses.forEach(analysis => {
    if (!byClassification[analysis.classification]) {
      byClassification[analysis.classification] = [];
    }
    byClassification[analysis.classification]!.push(analysis);
  });

  // Display by classification
  const classificationOrder = ['flaky', 'regression', 'environment-issue', 'new-failure'];
  
  classificationOrder.forEach(classification => {
    if (byClassification[classification]) {
      const tests = byClassification[classification]!;
      const icon = {
        'flaky': '🔄',
        'regression': '⚠️',
        'environment-issue': '🌍',
        'new-failure': '❌'
      }[classification] || '❓';

      output += `\n${icon} **${classification.toUpperCase().replace('-', ' ')}** (${tests.length})\n`;
      
      tests.forEach(test => {
        output += `  • **${test.name}**\n`;
        output += `    - Failures: ${test.failureCount}\n`;
        output += `    - Last failure: ${new Date(test.lastFailureTime).toLocaleDateString()}\n`;
        if (test.error) {
          const errorPreview = test.error.substring(0, 80).replace(/\n/g, ' ');
          output += `    - Error: ${errorPreview}${test.error.length > 80 ? '...' : ''}\n`;
        }
      });
    }
  });

  // Summary statistics
  const flakyCount = byClassification['flaky']?.length || 0;
  const regressionCount = byClassification['regression']?.length || 0;
  const envIssueCount = byClassification['environment-issue']?.length || 0;
  const newFailureCount = byClassification['new-failure']?.length || 0;

  output += `\n**Summary:**\n`;
  output += `  • Flaky tests: ${flakyCount}\n`;
  output += `  • Regressions: ${regressionCount}\n`;
  output += `  • Environment issues: ${envIssueCount}\n`;
  output += `  • New failures: ${newFailureCount}\n`;

  return output;
}

/**
 * Get Failures Tool
 * Analyzes and classifies test failures
 */
export async function getFailures(input?: ToolInput): Promise<ToolOutput> {
  try {
    const service = getService();

    // Get failure analysis
    const analyses = service.analyzeFailures();

    if (analyses.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No failures detected in the latest test run! ✓'
        }]
      };
    }

    const output = formatFailureAnalysis(analyses);

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
        text: `Error analyzing failures: ${error.message}`
      }],
      isError: true
    };
  }
}
