/**
 * MCP Tool: List available tests by parsing Gherkin .feature files.
 * Replaces the old Playwright --list approach.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ToolInput, ToolOutput, TestMetadata } from '../types/mcp.types.js';
import { getEnvironmentConfig } from '../config/environments.js';

// ---------------------------------------------------------------------------
// Gherkin feature file parser
// ---------------------------------------------------------------------------

interface ParsedScenario {
  featureName: string;
  featureTags: string[];
  scenarioName: string;
  scenarioTags: string[];
  allTags: string[];
  filePath: string;
}

/**
 * Recursively find all .feature files under a directory.
 */
function findFeatureFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFeatureFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.feature')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Parse a single .feature file and return all scenarios with their tags.
 *
 * Rules:
 *  - Lines starting with @ are tag lines. Tags accumulate until the next
 *    Feature: or Scenario: keyword resets the pending buffer.
 *  - Feature-level tags attach to all scenarios in the file.
 *  - Scenario-level tags are per-scenario only.
 *  - Background: blocks are skipped (no scenario entry created).
 */
function parseFeatureFile(filePath: string): ParsedScenario[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const scenarios: ParsedScenario[] = [];
  let featureName = '';
  let featureTags: string[] = [];
  let pendingTags: string[] = [];   // tags accumulated since last keyword

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Tag line – collect all @tag tokens on this line
    if (line.startsWith('@')) {
      const tags = line.match(/@[\w-]+/g) ?? [];
      pendingTags.push(...tags.map(t => t.replace('@', '').toLowerCase()));
      continue;
    }

    // Feature declaration
    if (/^Feature:/i.test(line)) {
      featureName = line.replace(/^Feature:/i, '').trim();
      featureTags = [...pendingTags];
      pendingTags = [];
      continue;
    }

    // Background – ignore, reset pending tags
    if (/^Background:/i.test(line)) {
      pendingTags = [];
      continue;
    }

    // Scenario or Scenario Outline
    if (/^Scenario(\s+Outline)?:/i.test(line)) {
      const scenarioName = line.replace(/^Scenario(\s+Outline)?:/i, '').trim();
      const scenarioTags = [...pendingTags];
      const allTags = [...new Set([...featureTags, ...scenarioTags])];

      scenarios.push({
        featureName,
        featureTags,
        scenarioName,
        scenarioTags,
        allTags,
        filePath
      });

      pendingTags = [];
      continue;
    }

    // Any non-empty, non-comment content that is not a Gherkin keyword
    // resets the pending scenario tag buffer (steps, examples, etc.)
    if (line.length > 0 && !line.startsWith('#') && !line.startsWith('|') && !line.startsWith('"')) {
      const isKeyword = /^(Given|When|Then|And|But|Examples:|@)/i.test(line);
      if (!isKeyword) {
        pendingTags = [];
      }
    }
  }

  return scenarios;
}

// ---------------------------------------------------------------------------
// Criticality mapping
// ---------------------------------------------------------------------------

/**
 * Map a scenario's combined tags to a criticality level.
 *
 * @production  → critical   (production health checks, highest priority)
 * @staging     → high       (staging smoke paths)
 * core financial tags        → medium (chargeoff, payoff, settlement, etc.)
 * @regression  → medium     (default for regression suite)
 * everything else            → low
 */
function determineCriticality(tags: string[]): TestMetadata['criticality'] {
  const t = tags.map(x => x.toLowerCase());

  if (t.includes('production'))                               return 'critical';
  if (t.includes('staging'))                                  return 'high';
  if (t.some(x => [
    'chargeoff', 'paidoffsettlement', 'ontracksettlement',
    'payoff', 'editloan', 'partialpayment', 'regenschedule'
  ].includes(x)))                                             return 'medium';
  if (t.includes('regression'))                               return 'medium';
  return 'low';
}

/**
 * Derive a short feature group name from the file path relative to Features/.
 * E.g.  Features/RegressionTests/CSRD/ChargeOff/ChargeoffTest.feature → CSRD/ChargeOff
 */
function featureGroupFromPath(filePath: string, featuresDir: string): string {
  const rel = path.relative(featuresDir, path.dirname(filePath));
  // strip the first segment (RegressionTests / StagingTests / ProductionTests)
  const parts = rel.split(path.sep).filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join('/') : parts[0] ?? 'General';
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export async function listTests(input?: ToolInput): Promise<ToolOutput> {
  try {
    const config = getEnvironmentConfig();
    const featuresDir = config.featuresDir;

    if (!fs.existsSync(featuresDir)) {
      return {
        content: [{
          type: 'text',
          text: `Features directory not found at: ${featuresDir}\n` +
                `Set DOTNET_PROJECT_ROOT env var to override the C# project path.`
        }],
        isError: true
      };
    }

    // Parse all .feature files
    const featureFiles = findFeatureFiles(featuresDir);
    const allScenarios: ParsedScenario[] = [];
    for (const file of featureFiles) {
      try {
        allScenarios.push(...parseFeatureFile(file));
      } catch {
        // skip unreadable files
      }
    }

    if (allScenarios.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No scenarios found in the Features directory.'
        }]
      };
    }

    // Optional tag filter from input
    let filtered = allScenarios;
    if (input?.tags && typeof input.tags === 'string') {
      const filterTag = (input.tags as string).toLowerCase().replace(/^@/, '');
      filtered = allScenarios.filter(s =>
        s.allTags.includes(filterTag)
      );
    }

    // Build TestMetadata list
    const tests: TestMetadata[] = filtered.map(s => ({
      name: `${s.featureName} - ${s.scenarioName}`,
      tags: s.allTags,
      feature: featureGroupFromPath(s.filePath, featuresDir),
      criticality: determineCriticality(s.allTags),
      location: path.relative(config.playwrightProjectRoot, s.filePath)
    }));

    // Group by feature area for display
    const grouped: Map<string, TestMetadata[]> = new Map();
    for (const test of tests) {
      const group = grouped.get(test.feature) ?? [];
      group.push(test);
      grouped.set(test.feature, group);
    }

    // Format display output
    let output = `Found ${tests.length} scenarios across ${featureFiles.length} feature files:\n\n`;

    for (const [feature, featureTests] of [...grouped.entries()].sort()) {
      output += `**${feature}** (${featureTests.length} scenarios)\n`;
      for (const test of featureTests) {
        const tagStr = test.tags.length > 0 ? test.tags.join(', ') : 'untagged';
        output += `  • ${test.name} [${test.criticality}] (${tagStr})\n`;
      }
      output += '\n';
    }

    // Summary
    const criticalCount    = tests.filter(t => t.criticality === 'critical').length;
    const highCount        = tests.filter(t => t.criticality === 'high').length;
    const mediumCount      = tests.filter(t => t.criticality === 'medium').length;
    const lowCount         = tests.filter(t => t.criticality === 'low').length;
    const productionCount  = tests.filter(t => t.tags.includes('production')).length;
    const regressionCount  = tests.filter(t => t.tags.includes('regression')).length;
    const stagingCount     = tests.filter(t => t.tags.includes('staging')).length;

    output += `**Summary:**\n`;
    output += `  • Critical (@production):  ${criticalCount}\n`;
    output += `  • High (@staging):         ${highCount}\n`;
    output += `  • Medium (@regression):    ${mediumCount}\n`;
    output += `  • Low (feature-specific):  ${lowCount}\n`;
    output += `  ─────────────────────────────\n`;
    output += `  • Total:                   ${tests.length}\n\n`;
    output += `**Tag breakdown:**\n`;
    output += `  • @production: ${productionCount}  • @staging: ${stagingCount}  • @regression: ${regressionCount}\n`;

    return {
      content: [{ type: 'text', text: output }]
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error listing tests: ${error.message}` }],
      isError: true
    };
  }
}
