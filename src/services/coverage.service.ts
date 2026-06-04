/**
 * CoverageService — maps recently changed source files to test coverage.
 *
 * Walks the Features/ directory to count scenarios per feature area,
 * then cross-references against git-changed files to find coverage gaps.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CoverageGap, GitCommit } from '../types/research.types.js';

export class CoverageService {
  constructor(
    private featuresDir: string,
    private projectRoot: string
  ) {}

  /**
   * Find coverage gaps: recently changed .cs files that have no / few scenarios.
   */
  findGaps(recentCommits: GitCommit[]): CoverageGap[] {
    const gaps: CoverageGap[] = [];
    const seen = new Set<string>(); // deduplicate by area

    for (const commit of recentCommits) {
      for (const file of commit.filesChanged) {
        // Only care about C# source files, not test files themselves
        if (!file.endsWith('.cs') && !file.endsWith('.feature')) continue;
        if (file.includes('StepDefinitions') || file.includes('Hooks') ||
            file.includes('.feature') || file.includes('Tests.cs')) continue;

        const area = this.deriveFeatureArea(file);
        if (!area || seen.has(area)) continue;
        seen.add(area);

        const count = this.countScenariosForArea(area);

        if (count < 2) {
          gaps.push({
            area,
            changedFile: file,
            commitMessage: commit.message,
            commitDate: commit.date,
            scenarioCount: count,
            recommendation: count === 0
              ? `generate_tests({ artifact: 'full_suite', featureArea: '${area}' })`
              : `generate_tests({ artifact: 'feature', featureArea: '${area}' }) — add edge cases`
          });
        }
      }
    }

    // Sort: zero coverage first, then partial
    return gaps.sort((a, b) => a.scenarioCount - b.scenarioCount);
  }

  /**
   * Count how many Gherkin scenarios exist for a given feature area.
   */
  countScenariosForArea(area: string): number {
    if (!fs.existsSync(this.featuresDir)) return 0;
    let total = 0;
    this.walkFeatureFiles(this.featuresDir, area.toLowerCase(), content => {
      total += this.extractScenarioCount(content);
    });
    return total;
  }

  /**
   * Derive a human-readable feature area name from a file path.
   * e.g. "Support/CouponHive/AuditLogger.cs"  → "AuditLogger"
   *      "Services/Payment/PaymentService.cs"  → "PaymentService"
   *      "CouponHive/CouponExpiry.cs"          → "CouponExpiry"
   */
  private deriveFeatureArea(filePath: string): string {
    const basename = path.basename(filePath, '.cs');
    // Strip common suffixes
    return basename
      .replace(/Service$/, '')
      .replace(/Helper$/, '')
      .replace(/Manager$/, '')
      .replace(/Controller$/, '')
      .replace(/Repository$/, '')
      .replace(/Repo$/, '')
      .trim();
  }

  private walkFeatureFiles(
    dir: string,
    areaLower: string,
    callback: (content: string) => void
  ): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkFeatureFiles(fullPath, areaLower, callback);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.feature') &&
        (entry.name.toLowerCase().includes(areaLower) ||
         fullPath.toLowerCase().includes(areaLower))
      ) {
        try {
          callback(fs.readFileSync(fullPath, 'utf-8'));
        } catch { /* skip */ }
      }
    }
  }

  private extractScenarioCount(content: string): number {
    let count = 0;
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (t.startsWith('Scenario:') || t.startsWith('Scenario Outline:')) count++;
    }
    return count;
  }
}
