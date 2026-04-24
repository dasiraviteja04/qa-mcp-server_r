/**
 * MCP Tool: run_tests
 *
 * Executes dotnet test (UIAutomationTests / Reqnroll / NUnit / Playwright C#)
 * and returns a structured summary of pass/fail results with screenshot paths.
 *
 * Inputs:
 *   tags     – Gherkin category tags, e.g. "couponhive-ui" or ["couponhive-ui","regression"]
 *   filter   – Raw VSTest filter, e.g. "FullyQualifiedName~BulkCoupon"
 *   scenario – Single scenario name (auto-wrapped as FullyQualifiedName~<value>)
 *   workers  – Max parallel workers (capped by env config)
 *   timeout  – Timeout hint in ms (capped by env config)
 *
 * Filter priority: filter > scenario > tags
 */

import { PlaywrightService } from '../services/playwright.service.js';
import { PolicyService } from '../services/policy.service.js';
import type { ToolInput, ToolOutput } from '../types/mcp.types.js';
import { getEnvironmentConfig } from '../config/environments.js';
import * as path from 'path';

let playwrightService: PlaywrightService | null = null;
let policyService: PolicyService | null = null;

function getServices(): { playwright: PlaywrightService; policy: PolicyService } {
  const config = getEnvironmentConfig();
  if (!playwrightService) {
    playwrightService = new PlaywrightService({
      projectRoot:     config.playwrightProjectRoot,
      csprojFile:      config.csprojFile,
      runSettingsFile: config.runSettingsFile,
      reportOutputDir: config.reportOutputDir
    });
  }
  if (!policyService) {
    policyService = new PolicyService(config.name);
  }
  return { playwright: playwrightService, policy: policyService };
}

/**
 * Policy gate: production env only allows @production tag.
 */
function validateTags(
  tags: string[],
  policy: PolicyService
): { valid: boolean; reason?: string } {
  const config      = getEnvironmentConfig();
  const allowed     = config.allowedTags;
  const disallowed  = tags.filter(t => !allowed.includes(t));
  if (disallowed.length > 0) {
    return {
      valid:  false,
      reason: `Environment "${config.name}" only allows tags: [${allowed.join(', ')}].\n` +
              `Requested tag(s) not permitted: [${disallowed.join(', ')}]`
    };
  }
  return { valid: true };
}

/**
 * Format the TRX-parsed report into a human-readable summary.
 */
function formatReport(report: any, screenshots: string[]): string {
  if (!report) return 'No TRX report found — check project path and runsettings.';

  const passRate = report.totalTests > 0
    ? ((report.passed / report.totalTests) * 100).toFixed(1)
    : '0';

  let out = `\n═══════════════════════════════\n`;
  out    += ` Test Execution Results\n`;
  out    += `═══════════════════════════════\n`;
  out    += `Total    : ${report.totalTests}\n`;
  out    += `✓ Passed : ${report.passed}\n`;
  out    += `✗ Failed : ${report.failed}\n`;
  out    += `⊘ Skipped: ${report.skipped}\n`;
  out    += `⏱ Time   : ${(report.duration / 1000).toFixed(1)}s\n`;
  out    += `Pass Rate: ${passRate}%\n`;
  out    += `═══════════════════════════════\n`;

  // ── Failed tests with error previews ──────────────────────────────────
  if (report.failed > 0) {
    const failed = report.tests.filter((t: any) => t.status === 'failed');
    out += `\n❌ Failed Tests (${failed.length}):\n`;
    failed.slice(0, 15).forEach((test: any, i: number) => {
      out += `\n  ${i + 1}. ${test.name}\n`;
      if (test.error) {
        // Show first meaningful line of error (skip stack trace noise)
        const firstLine = String(test.error)
          .split('\n')
          .find((l: string) => l.trim().length > 0) ?? '';
        const preview = firstLine.substring(0, 150);
        out += `     → ${preview}${firstLine.length > 150 ? '...' : ''}\n`;
      }
    });
    if (failed.length > 15) out += `\n  ...and ${failed.length - 15} more\n`;
  }

  // ── Screenshots written during this run ────────────────────────────────
  if (screenshots.length > 0) {
    out += `\n📸 Screenshots (${screenshots.length}):\n`;
    screenshots.slice(0, 20).forEach(s => {
      out += `  • ${s}\n`;
    });
    if (screenshots.length > 20) out += `  ...and ${screenshots.length - 20} more\n`;
  }

  // ── Passed tests (condensed) ──────────────────────────────────────────
  if (report.passed > 0) {
    const passed = report.tests.filter((t: any) => t.status === 'passed');
    out += `\n✅ Passed Tests (${passed.length}):\n`;
    passed.forEach((t: any) => {
      out += `  • ${t.name}  (${(t.duration / 1000).toFixed(1)}s)\n`;
    });
  }

  return out;
}

// ── Main tool export ─────────────────────────────────────────────────────────

export async function runTests(input?: ToolInput): Promise<ToolOutput> {
  try {
    const { playwright, policy } = getServices();
    const config = getEnvironmentConfig();

    // ── Parse inputs ─────────────────────────────────────────────────────
    let tags: string[] = [];
    let filter   = typeof input?.filter   === 'string' ? input.filter   : '';
    let scenario = typeof input?.scenario === 'string' ? input.scenario : '';
    let workers  = config.workers;
    let timeout  = config.timeoutMs;

    if (input?.tags) {
      tags = typeof input.tags === 'string'
        ? [input.tags]
        : Array.isArray(input.tags) ? (input.tags as string[]) : [];
      tags = tags.map((t: string) => t.replace(/^@/, '').toLowerCase());
    }

    if (typeof input?.workers === 'number') workers = Math.min(input.workers as number, config.workers);
    if (typeof input?.timeout === 'number') timeout  = Math.min(input.timeout as number, config.timeoutMs);

    // Default to all allowed tags when no filter specified
    if (!filter && !scenario && tags.length === 0) {
      tags = config.allowedTags;
    }

    // ── Policy gate (skip for filter/scenario runs — they target specific tests) ──
    if (!filter && !scenario && tags.length > 0) {
      const check = validateTags(tags, policy);
      if (!check.valid) {
        return {
          content: [{ type: 'text', text: `❌ Test Execution Blocked\n\n${check.reason}` }],
          isError: true
        };
      }
    }

    // ── Build header ─────────────────────────────────────────────────────
    let header = `🚀 Running UIAutomationTests\n\n`;
    header    += `Environment : ${config.name} (${config.testEnvironment})\n`;
    header    += `Run settings: ${config.runSettingsFile}\n`;

    if (filter)        header += `Filter      : ${filter}\n`;
    else if (scenario) header += `Scenario    : ${scenario}\n`;
    else               header += `Tags        : ${tags.join(', ')}\n`;

    header += `Workers     : ${workers}\n`;
    header += `Timeout     : ${(timeout / 1000).toFixed(0)}s\n\n`;
    header += `⏳ Starting dotnet test — this may take several minutes...\n`;

    // ── Execute (async — event loop stays alive) ──────────────────────────
    const result = await playwright.runTests({ tags, filter, scenario, workers, timeout });

    // ── Parse report and format output ────────────────────────────────────
    const report = playwright.getLatestReport();

    let body: string;
    if (!report) {
      body  = '\n⚠️  No TRX report was produced.\n\nPossible causes:\n';
      body += '  • No tests matched the requested filter / tags\n';
      body += '  • Build failed before any tests ran\n';
      body += `  • Expected reports at: ${config.reportOutputDir}\n`;
      body += '\nConsole output (last 2000 chars):\n';
      body += result.consoleOutput.slice(-2000);
    } else {
      body = formatReport(report, result.screenshots);

      if (!result.success && report.failed === 0) {
        body += '\n⚠️  dotnet returned non-zero exit but no failing tests in TRX — ';
        body += 'possible build warning or skipped tests.\n';
      }

      // Append brief console tail on failure so errors are visible immediately
      if (report.failed > 0 && result.consoleOutput) {
        const tail = result.consoleOutput.slice(-1500).trim();
        if (tail) {
          body += `\n\n📋 Console Output (last 1500 chars):\n\`\`\`\n${tail}\n\`\`\`\n`;
        }
      }
    }

    return {
      content: [{ type: 'text', text: header + body }]
    };

  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ Error executing tests: ${error.message}\n\n` +
              `Check:\n` +
              `  • dotnet 8 SDK is installed and on PATH\n` +
              `  • DOTNET_PROJECT_ROOT points to the UIAutomationTests folder\n` +
              `  • The .csproj and .runsettings files exist in that folder`
      }],
      isError: true
    };
  }
}
