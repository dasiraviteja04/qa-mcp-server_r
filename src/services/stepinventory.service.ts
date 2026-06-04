/**
 * StepInventoryService — scans all C# step-definition files and extracts
 * every [Given], [When], [Then], [And], [But] binding pattern.
 *
 * Why this matters for code generation:
 *   Reqnroll raises AmbiguousMatchException if two [Given] attributes share
 *   the same regex.  Before generating a new feature file or step class, the
 *   generate_tests tool uses this inventory to:
 *     1. Reuse existing step patterns wherever possible (no duplication)
 *     2. Flag exactly which steps are already bound so Claude only writes NEW
 *        step definitions for steps that don't exist yet
 */

import * as fs from 'fs';
import * as path from 'path';
import { getEnvironmentConfig } from '../config/environments.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StepBinding {
  pattern: string;           // the regex/text inside [Given("...")] etc.
  type: 'Given' | 'When' | 'Then' | 'And' | 'But' | 'StepDefinition';
  methodName: string;        // C# method name
  className: string;         // C# class containing the method
  filePath: string;          // absolute path to .cs file
  lineNumber: number;
}

export interface StepInventory {
  totalFiles: number;
  totalBindings: number;
  bindings: StepBinding[];
  scannedAt: string;
}

// ---------------------------------------------------------------------------
// StepInventoryService
// ---------------------------------------------------------------------------

export class StepInventoryService {

  // Match: [Given("some pattern")] or [When(@"regex")] etc.
  // Handles both verbatim @"..." and regular "..." strings.
  // Also handles StepDefinition attribute used in Reqnroll for generic steps.
  private static readonly BINDING_REGEX =
    /\[\s*(Given|When|Then|And|But|StepDefinition)\s*\(\s*@?"([^"\\]*(?:\\.[^"\\]*)*)"\s*\)\s*\]/g;

  // Match the method name on the line immediately after the attribute block
  private static readonly METHOD_REGEX =
    /(?:public|private|protected|internal)\s+(?:async\s+)?(?:\S+\s+)?(\w+)\s*\(/;

  // ---------------------------------------------------------------------------

  async readInventory(stepDefsDir?: string): Promise<StepInventory> {
    const dir = stepDefsDir ?? this.resolveStepDefsDir();

    if (!dir || !fs.existsSync(dir)) {
      return {
        totalFiles: 0,
        totalBindings: 0,
        bindings: [],
        scannedAt: new Date().toISOString()
      };
    }

    const csFiles = this.findCsFiles(dir);
    const bindings: StepBinding[] = [];

    for (const filePath of csFiles) {
      this.extractBindingsFromFile(filePath, bindings);
    }

    return {
      totalFiles: csFiles.length,
      totalBindings: bindings.length,
      bindings,
      scannedAt: new Date().toISOString()
    };
  }

  // -------------------------------------------------------------------------
  // File discovery
  // -------------------------------------------------------------------------

  private findCsFiles(dir: string): string[] {
    const results: string[] = [];
    this.walkDir(dir, results);
    return results;
  }

  private walkDir(dir: string, results: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkDir(fullPath, results);
      } else if (entry.isFile() && entry.name.endsWith('.cs')) {
        results.push(fullPath);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Extraction
  // -------------------------------------------------------------------------

  private extractBindingsFromFile(filePath: string, bindings: StepBinding[]): void {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    const lines = content.split('\n');
    const className = this.extractClassName(content) ?? path.basename(filePath, '.cs');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Reset the lastIndex so the regex scans from the start of each line
      StepInventoryService.BINDING_REGEX.lastIndex = 0;
      const match = StepInventoryService.BINDING_REGEX.exec(line);
      if (!match) continue;

      const type = match[1] as StepBinding['type'];
      const pattern = (match[2] ?? '').replace(/\\"/g, '"');

      // Look ahead up to 5 lines for the method signature
      let methodName = 'unknown';
      for (let j = i + 1; j <= Math.min(i + 5, lines.length - 1); j++) {
        const methodMatch = StepInventoryService.METHOD_REGEX.exec(lines[j] ?? '');
        if (methodMatch) {
          methodName = methodMatch[1] ?? 'unknown';
          break;
        }
      }

      bindings.push({
        pattern,
        type,
        methodName,
        className,
        filePath,
        lineNumber: i + 1
      });
    }
  }

  private extractClassName(content: string): string | null {
    const match = /(?:public|internal)\s+class\s+(\w+)/.exec(content);
    return match?.[1] ?? null;
  }

  // -------------------------------------------------------------------------
  // Path resolution
  // -------------------------------------------------------------------------

  private resolveStepDefsDir(): string {
    const config = getEnvironmentConfig();
    // StepDefinitions/ lives alongside Features/ under the project root
    return path.join(config.playwrightProjectRoot, 'StepDefinitions');
  }
}
