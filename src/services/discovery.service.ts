/**
 * DiscoveryService — Phase 2 of the capability-based orchestration.
 *
 * Centralises all context-gathering operations needed before test generation:
 *   - DB schema          (SQL Server, via SchemaService)
 *   - Step inventory     (C# .cs files, via StepInventoryService)
 *   - Page elements      (headless Playwright, via PageCrawlerService — optional)
 *   - Existing scenarios (.feature files parsed locally — fast, no I/O wait)
 *
 * Schema, steps, and page crawl run in parallel via Promise.allSettled.
 * Existing test parsing is synchronous (local file reads only).
 *
 * No MCP tools are called here. Services are used directly to avoid
 * the tool → service → tool double-wrapping anti-pattern.
 *
 * Previously, generateTests.ts wired these three services inline.
 * DiscoveryService centralises that so the orchestrator can:
 *   a) Use discovery signals (step count, existing test count) BEFORE generation
 *   b) Avoid re-fetching context on every generateTests call
 */

import * as fs   from 'fs';
import * as path from 'path';
import { SchemaService }         from './schema.service.js';
import { StepInventoryService }  from './stepinventory.service.js';
import { PageCrawlerService }    from './pagecrawler.service.js';
import { getEnvironmentConfig }  from '../config/environments.js';
import type { TestMetadata }     from '../types/mcp.types.js';
import type { DiscoveryResult, QAContext } from '../types/qa-context.types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal .feature file parser
// Mirrors the logic in listTests.ts (which is not exported from that tool file)
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedScenario {
  featureName:  string;
  featureTags:  string[];
  scenarioName: string;
  scenarioTags: string[];
  allTags:      string[];
  filePath:     string;
}

function findFeatureFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFeatureFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.feature')) {
      results.push(full);
    }
  }
  return results;
}

function parseFeatureFile(filePath: string): ParsedScenario[] {
  let content: string;
  try { content = fs.readFileSync(filePath, 'utf-8'); }
  catch { return []; }

  const lines    = content.split('\n');
  const scenarios: ParsedScenario[] = [];
  let featureName  = '';
  let featureTags: string[] = [];
  let pendingTags: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith('@')) {
      pendingTags.push(
        ...(line.match(/@[\w-]+/g) ?? []).map(t => t.replace('@', '').toLowerCase()),
      );
      continue;
    }

    if (/^Feature:/i.test(line)) {
      featureName = line.replace(/^Feature:/i, '').trim();
      featureTags = [...pendingTags];
      pendingTags = [];
      continue;
    }

    if (/^Background:/i.test(line)) {
      pendingTags = [];
      continue;
    }

    if (/^Scenario(\s+Outline)?:/i.test(line)) {
      const scenarioTags = [...pendingTags];
      scenarios.push({
        featureName,
        featureTags,
        scenarioName: line.replace(/^Scenario(\s+Outline)?:/i, '').trim(),
        scenarioTags,
        allTags: [...new Set([...featureTags, ...scenarioTags])],
        filePath,
      });
      pendingTags = [];
    }
  }

  return scenarios;
}

const CRITICALITY_MAP: Record<string, TestMetadata['criticality']> = {
  production: 'critical',
  smoke:      'critical',
  staging:    'high',
  regression: 'medium',
};

function toCriticality(tags: string[]): TestMetadata['criticality'] {
  for (const tag of tags) {
    const hit = CRITICALITY_MAP[tag.toLowerCase()];
    if (hit) return hit;
  }
  return 'low';
}

// ─────────────────────────────────────────────────────────────────────────────
// DiscoveryService
// ─────────────────────────────────────────────────────────────────────────────

export class DiscoveryService {
  /**
   * Gathers all context needed before test generation.
   *
   * Parallel execution:
   *   - SchemaService.readSchema()       → SQL Server query
   *   - StepInventoryService.readInventory() → .cs file scan
   *   - PageCrawlerService.crawlPage()   → headless browser (only if pageUrl set)
   *
   * Synchronous (returns immediately):
   *   - Existing test parsing from .feature files
   *
   * Each operation is wrapped in Promise.allSettled — a single failure
   * (e.g. DB unreachable) does not abort the rest.
   *
   * @param context  Slice of QAContext with featureArea, pageUrl, tables
   * @returns        DiscoveryResult with all available context
   */
  async getFullContext(
    context: Pick<QAContext, 'featureArea' | 'pageUrl' | 'tables'>,
  ): Promise<DiscoveryResult> {
    const config = getEnvironmentConfig();

    const schemaService  = new SchemaService();
    const stepService    = new StepInventoryService();
    const crawlerService = new PageCrawlerService();

    const tableFilter = context.tables
      ? context.tables.split(',').map(t => t.trim()).filter(Boolean)
      : undefined;

    // ── Parallel: schema + steps + page crawl ─────────────────────────────
    const [schemaSettled, stepsSettled, pageSettled] = await Promise.allSettled([

      schemaService.readSchema(tableFilter),

      stepService.readInventory(),   // uses default StepDefinitions/ path

      // Page crawl — only when a URL is provided
      (async () => {
        if (!context.pageUrl) return undefined;
        return crawlerService.crawlPage(context.pageUrl);
      })(),
    ]);

    // ── Existing tests (synchronous — local .feature file parse) ──────────
    const existingTests = this.loadExistingTests(config.featuresDir, context.featureArea);

    const result: DiscoveryResult = { existingTests };
    if (schemaSettled.status === 'fulfilled' && schemaSettled.value)
      result.schema = schemaSettled.value;
    if (stepsSettled.status  === 'fulfilled')
      result.steps  = stepsSettled.value.bindings;
    if (pageSettled.status   === 'fulfilled' && pageSettled.value)
      result.page   = pageSettled.value;
    return result;
  }

  /**
   * Parses .feature files matching the given area and returns TestMetadata[].
   * Called synchronously — no I/O bottleneck.
   */
  private loadExistingTests(featuresDir: string, featureArea: string): TestMetadata[] {
    const areaLower = featureArea.toLowerCase();
    const allFiles  = findFeatureFiles(featuresDir);
    const matching  = areaLower
      ? allFiles.filter(f => f.toLowerCase().includes(areaLower))
      : allFiles;

    const tests: TestMetadata[] = [];

    for (const file of matching) {
      for (const s of parseFeatureFile(file)) {
        tests.push({
          name:        s.scenarioName,
          tags:        s.allTags,
          feature:     s.featureName,
          criticality: toCriticality(s.allTags),
          location:    file,
        });
      }
    }

    return tests;
  }
}
