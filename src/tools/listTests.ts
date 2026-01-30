/**
 * MCP Tool: List available tests with metadata
 */

import { PlaywrightService } from '../services/playwright.service.js';
import { ReportService } from '../services/report.service.js';
import * as fs from 'fs';
import * as path from 'path';
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

  // If no tags found in the Playwright --list output, try to locate the
  // source file and extract the `tag` option from the test declaration.
  if (tags.length === 0) {
    try {
      const projectRoot = getService().getProjectRoot();
      const srcTags = extractTagsFromSource(testName, projectRoot);
      if (srcTags.length > 0) {
        // prepend extracted tags (they may already exclude '@')
        srcTags.forEach(t => { if (!tags.includes(t)) tags.push(t); });
      }
    } catch (err) {
      // ignore - best-effort extraction
    }
  }

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
 * Try to extract tags from the test source file based on the Playwright
 * list output which usually contains a filename and the test title.
 */
function extractTagsFromSource(testName: string, projectRoot: string): string[] {
  // Attempt to parse filename like 'login.spec.ts:13:7' from Playwright output
  const fileMatch = testName.match(/(\S+\.spec\.(ts|js))(?:\:(\d+)\:\d+)?/i);
  const titleParts = testName.split('›').map(p => p.trim()).filter(Boolean);
  const testTitle = titleParts.length ? titleParts[titleParts.length - 1] : '';

  if (!fileMatch) return [];
  const filename = (fileMatch[1] || '');
  if (!filename) return [];

  // Find the file in the project tree
  const filePath = findFileRecursively(projectRoot, filename);
  if (!filePath) return [];

  const content = fs.readFileSync(filePath, 'utf-8');

  // Try to locate a `test('title', { tag: [...] }` or `test("title", { tag: '@smoke' }` pattern
  const escapedTitle = escapeRegex(testTitle || '');
  const pattern = 'test\\s*\\(\\s*["\'`]' + escapedTitle + '["\'`]\\s*,\\s*\\{([\\n\\s\\S]*?)\\}\\s*\\,';
  const regex = new RegExp(pattern, 'm');
  let match = content.match(regex);

  // If not matched, try a looser match: find test title then look nearby for `tag:` within 10 lines
  if (!match) {
    const lines = content.split('\n');
    const tt = testTitle || '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      if (tt && line.indexOf(tt) !== -1) {
        const start = Math.max(0, i - 5);
        const end = Math.min(lines.length, i + 6);
        const window = lines.slice(start, end).join('\n');
        const m = window.match(/tag\s*:\s*(\[[^\]]*\]|['"`][^'"`]*['"`])/);
        if (m) {
          match = [m[0], m[1]] as any;
          break;
        }
      }
    }
  }

  if (!match) return [];

  const tagSection = match[1] || match[0];
  const tagMatches = Array.from(((tagSection || '').matchAll(/@?([a-zA-Z0-9_:-]+)/g))).map(m => (m && m[1]) ? m[1] : '').filter(Boolean);
  return tagMatches.map(t => t.replace(/^@/, ''));
}

function findFileRecursively(dir: string, filename: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const found = findFileRecursively(full, filename);
      if (found) return found;
    } else if (e.isFile() && e.name === filename) {
      return full;
    }
  }
  return null;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
