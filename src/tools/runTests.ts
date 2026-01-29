/**
 * MCP Tool: Run tests safely with controlled parameters
 */

import { PlaywrightService } from '../services/playwright.service.js';
import { PolicyService } from '../services/policy.service.js';
import type { ToolInput, ToolOutput } from '../types/mcp.types.js';
import { getEnvironmentConfig } from '../config/environments.js';

let playwrightService: PlaywrightService | null = null;
let policyService: PolicyService | null = null;

/**
 * Initialize services
 */
function getServices(): { playwright: PlaywrightService; policy: PolicyService } {
  if (!playwrightService) {
    const config = getEnvironmentConfig();
    playwrightService = new PlaywrightService({
      projectRoot: config.playwrightProjectRoot,
      reportOutputDir: config.reportOutputDir
    });
  }

  if (!policyService) {
    const config = getEnvironmentConfig();
    policyService = new PolicyService(config.testEnvironment);
  }

  return { playwright: playwrightService, policy: policyService };
}

/**
 * Validate test execution request against policies
 */
function validateExecutionRequest(
  tags: string[],
  policyService: PolicyService
): { valid: boolean; reason?: string } {
  const env = policyService.getEnvironment();

  // In production, only allow critical and smoke tests
  if (env === 'production') {
    const allowedTags = ['critical', 'smoke'];
    const hasDisallowedTag = tags.some(tag => !allowedTags.includes(tag));
    if (hasDisallowedTag) {
      return {
        valid: false,
        reason: `Production environment only allows ${allowedTags.join(', ')} tests. You requested: ${tags.join(', ')}`
      };
    }
  }

  return { valid: true };
}

/**
 * Format test execution output
 */
function formatExecutionResults(report: any): string {
  if (!report) {
    return 'No report available. Tests may have failed to complete.';
  }

  let output = `\n**Test Execution Complete**\n\n`;
  output += `Total Tests: ${report.totalTests}\n`;
  output += `✓ Passed: ${report.passed}\n`;
  output += `✗ Failed: ${report.failed}\n`;
  output += `⊘ Skipped: ${report.skipped}\n`;
  output += `⏱ Duration: ${(report.duration / 1000).toFixed(2)}s\n\n`;

  if (report.failed > 0) {
    output += `**Failed Tests:**\n`;
    const failed = report.tests.filter((t: any) => t.status === 'failed');
    failed.slice(0, 10).forEach((test: any) => {
      output += `  • ${test.name}\n`;
      if (test.error) {
        output += `    Error: ${test.error.substring(0, 100)}...\n`;
      }
    });
    if (failed.length > 10) {
      output += `  ... and ${failed.length - 10} more\n`;
    }
    output += '\n';
  }

  const passRate = report.totalTests > 0 
    ? ((report.passed / report.totalTests) * 100).toFixed(1) 
    : '0';
  output += `**Pass Rate: ${passRate}%**\n`;

  return output;
}

/**
 * Run Tests Tool
 * Safely executes Playwright tests with controlled parameters
 */
export async function runTests(input?: ToolInput): Promise<ToolOutput> {
  try {
    const { playwright, policy } = getServices();
    const config = getEnvironmentConfig();

    // Parse input parameters
    let tags: string[] = [];
    let workers: number = config.workers;
    let timeout: number = config.timeoutMs;

    if (input?.tags) {
      tags = typeof input.tags === 'string' 
        ? [input.tags] 
        : Array.isArray(input.tags) ? input.tags : [];
      // Normalize tags (remove @ prefix if present)
      tags = tags.map(t => t.replace(/^@/, ''));
    }

    if (input?.workers && typeof input.workers === 'number') {
      workers = Math.min(input.workers, config.workers); // Cap workers
    }

    if (input?.timeout && typeof input.timeout === 'number') {
      timeout = Math.min(input.timeout, config.timeoutMs); // Cap timeout
    }

    // Default to critical tests if no tags specified
    if (tags.length === 0) {
      tags = ['critical'];
    }

    // Validate against policies
    const validation = validateExecutionRequest(tags, policy);
    if (!validation.valid) {
      return {
        content: [{
          type: 'text',
          text: `⚠️ Test Execution Blocked\n\n${validation.reason}`
        }],
        isError: true
      };
    }

    let output = `Executing tests with tags: ${tags.join(', ')}\n`;
    output += `Environment: ${config.testEnvironment}\n`;
    output += `Workers: ${workers}\n`;
    output += `Timeout: ${timeout}ms\n\n`;
    output += 'Starting Playwright...\n';

    // Execute tests
    const success = playwright.runTests({
      tags,
      workers,
      timeout
    });

    // Wait a moment for the report file to be written
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get report
    const report = playwright.getLatestReport();

    if (!report) {
      output += '\n⚠️ Test execution completed but report file could not be read.\n';
      output += 'This might happen if:\n';
      output += '  • Tests have not finished writing their reports yet\n';
      output += '  • The Playwright project path is incorrect\n';
      output += `  • Expected reports at: ${config.reportOutputDir}\n`;
      
      // Try running get_failures to retrieve the report
      output += '\nRun "get_failures" tool to analyze the results.\n';
    } else {
      output += formatExecutionResults(report);

      if (!success && report.failed === 0) {
        output += '\n⚠️ Tests completed but some tests may have been skipped or warnings were issued.\n';
      }
    }

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
        text: `Error executing tests: ${error.message}\n\nMake sure the Playwright project is properly configured and located at the expected path.`
      }],
      isError: true
    };
  }
}
