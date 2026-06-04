/**
 * read_step_inventory MCP tool
 *
 * Scans every .cs file under StepDefinitions/ and returns all existing
 * [Given] / [When] / [Then] binding patterns.
 *
 * Why this is needed for code generation:
 *   Reqnroll throws AmbiguousMatchException when two step classes define the
 *   same pattern.  This tool lets Claude see what's already bound before
 *   writing new step definitions, so it can:
 *     1. Reuse existing bindings in new feature files
 *     2. Only generate NEW step methods for patterns that don't exist yet
 */

import { StepInventoryService } from '../services/stepinventory.service.js';
import type { ToolOutput } from '../types/mcp.types.js';

interface ReadStepInventoryInput {
  filter?: string;       // optional substring filter on pattern/class/method
  stepDefsDir?: string;  // optional override for StepDefinitions directory path
}

export async function readStepInventory(input: ReadStepInventoryInput): Promise<ToolOutput> {
  const service = new StepInventoryService();
  const inventory = await service.readInventory(input.stepDefsDir);

  if (inventory.totalBindings === 0) {
    return {
      content: [{
        type: 'text',
        text: [
          '## Step Inventory',
          '',
          '**No step bindings found.**',
          '',
          'Possible reasons:',
          '  1. StepDefinitions/ directory does not exist at the resolved path',
          '  2. DOTNET_PROJECT_ROOT env var is not set correctly',
          '  3. No .cs files with [Given]/[When]/[Then] attributes exist yet',
          '',
          `Scanned at: ${inventory.scannedAt}`
        ].join('\n')
      }]
    };
  }

  // Apply optional text filter
  let bindings = inventory.bindings;
  if (input.filter) {
    const lower = input.filter.toLowerCase();
    bindings = bindings.filter(b =>
      b.pattern.toLowerCase().includes(lower) ||
      b.className.toLowerCase().includes(lower) ||
      b.methodName.toLowerCase().includes(lower)
    );
  }

  // Group by class for readability
  const byClass = new Map<string, typeof bindings>();
  for (const b of bindings) {
    if (!byClass.has(b.className)) byClass.set(b.className, []);
    byClass.get(b.className)!.push(b);
  }

  const lines: string[] = [
    `## Step Inventory — ${inventory.totalFiles} file(s), ${inventory.totalBindings} binding(s)`,
    `_Scanned: ${inventory.scannedAt}_`,
    ...(input.filter ? [`_Filter: "${input.filter}" → ${bindings.length} match(es)_`] : []),
    ''
  ];

  for (const [className, classBindings] of byClass) {
    lines.push(`### ${className}`);
    lines.push('');
    lines.push('| Type | Pattern | Method | Line |');
    lines.push('|------|---------|--------|------|');
    for (const b of classBindings) {
      // Escape pipe chars in patterns so the table doesn't break
      const safePattern = b.pattern.replace(/\|/g, '\\|');
      lines.push(`| ${b.type} | \`${safePattern}\` | ${b.methodName} | ${b.lineNumber} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('**Usage:** When writing new feature scenarios, match these patterns exactly. Only generate new [Given]/[When]/[Then] methods for patterns NOT listed above.');

  return {
    content: [{ type: 'text', text: lines.join('\n') }]
  };
}
