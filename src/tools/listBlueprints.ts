/**
 * MCP Tool: list_blueprints
 *
 * Returns all saved framework blueprints stored in memory/frameworks/.
 * Shows name, scan date, project path, and file counts for each.
 */

import { FrameworkMemoryService } from '../services/frameworkMemory.service.js';
import type { ToolOutput } from '../types/mcp.types.js';

export async function listBlueprints(_input?: unknown): Promise<ToolOutput> {
  try {
    const service    = new FrameworkMemoryService();
    const blueprints = service.listBlueprints();

    if (blueprints.length === 0) {
      return {
        content: [{
          type: 'text',
          text: [
            `📂 No framework blueprints saved yet.`,
            ``,
            `To create your first blueprint, run:`,
            `  scan_framework({`,
            `    project_name: "CouponHive",`,
            `    project_path: "C:/path/to/UIAutomationTests"`,
            `  })`,
          ].join('\n')
        }]
      };
    }

    const lines: string[] = [
      `📚 Framework Blueprints (${blueprints.length} saved)`,
      `📁 Storage: ${service.getBlueprintsDir()}`,
      ``,
    ];

    for (const bp of blueprints) {
      const scannedDate = new Date(bp.scannedAt).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });

      lines.push(`  ┌─ "${bp.name}"`);
      lines.push(`  │  Scanned   : ${scannedDate}`);
      lines.push(`  │  Source    : ${bp.projectPath}`);
      lines.push(`  │  Blueprint : ${bp.filePath}`);
      lines.push(`  └─ Use with → scaffold_project({ blueprint_name: "${bp.name}", ... })`);
      lines.push('');
    }

    lines.push(`💡 Tip: Run scan_framework again to refresh a blueprint after code changes.`);

    return {
      content: [{ type: 'text', text: lines.join('\n') }]
    };

  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `❌ list_blueprints failed: ${error.message}` }],
      isError: true
    };
  }
}
