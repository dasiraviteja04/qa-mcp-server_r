/**
 * MCP Tool: generate_html_report
 * Produces a self-contained HTML QA report from the latest test run results.
 * Designed for sharing with BAs and managers.
 */

import * as path from 'path';
import { HtmlReportService } from '../services/htmlReport.service.js';
import { getEnvironmentConfig } from '../config/environments.js';
import type { ToolInput, ToolOutput } from '../types/mcp.types.js';

export interface GenerateHtmlReportInput {
  /** Title shown at the top of the report */
  title?: string;
  /** Plain text output from coverage_analysis tool to embed in the report */
  coverageText?: string;
  /** Plain text output from get_release_risk tool to embed in the report */
  riskText?: string;
  /** Open the generated HTML file in the default browser after saving (default: false) */
  openInBrowser?: boolean;
  /** Override the output path. Default: <reportsDir>/report-<timestamp>.html */
  outputPath?: string;
  /** Project name — used to auto-load requirements coverage from memory/ */
  project_name?: string;
  /** Include requirements traceability sections in the report (default: true) */
  include_requirements?: boolean;
}

export async function generateHtmlReport(
  input: GenerateHtmlReportInput = {}
): Promise<ToolOutput> {
  try {
    const config  = getEnvironmentConfig();
    const service = new HtmlReportService(config.reportOutputDir);

    const opts: Parameters<typeof service.generateAndSave>[0] = {
      title:         input.title         ?? 'CouponHive QA Report',
      openInBrowser: input.openInBrowser ?? false,
    };
    if (input.coverageText)        opts.coverageText        = input.coverageText;
    if (input.riskText)            opts.riskText            = input.riskText;
    if (input.outputPath)          opts.outputPath          = input.outputPath;
    if (input.project_name)        opts.projectName         = input.project_name;
    if (input.include_requirements !== undefined) {
      opts.includeRequirements = input.include_requirements;
    }

    const savedPath = service.generateAndSave(opts);

    const filename = path.basename(savedPath);

    return {
      content: [{
        type: 'text',
        text: [
          `✅ HTML report generated successfully`,
          ``,
          `📄 File : ${savedPath}`,
          `📁 Name : ${filename}`,
          ``,
          `The report contains:`,
          `  • Release verdict (GO / CAUTION / NO-GO)`,
          `  • Summary cards (total, passed, failed, pass rate, duration)`,
          `  • Pass rate trend sparkline (last 6 runs)`,
          ...(input.project_name && input.include_requirements !== false ? [
            `  • Requirements traceability summary + coverage bar`,
            `  • Full traceability matrix (REQ ID → scenario → pass/fail)`,
            `  • Failing requirements detail cards`,
            `  • Not covered requirements list`,
          ] : []),
          `  • Failure table grouped by feature area (business-friendly names)`,
          `  • Failure screenshots (thumbnail gallery)`,
          `  • Coverage gap analysis`,
          `  • Full passed-test list (collapsed by default)`,
          `  • Print / Save as PDF button`,
          ``,
          `Share by attaching ${filename} to an email or Teams message.`,
          `Recipients can open it in any browser — no tools required.`
        ].join('\n')
      }]
    };
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ Error generating HTML report: ${error.message}\n\nMake sure tests have been run first (reports/latest.json must exist).`
      }],
      isError: true
    };
  }
}
