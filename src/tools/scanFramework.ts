/**
 * MCP Tool: scan_framework
 *
 * Scans an existing C#/Reqnroll/Playwright test project, extracts coding
 * patterns from real source files, and saves a reusable blueprint to
 * memory/frameworks/{project_name}-blueprint.json.
 *
 * Inputs:
 *   project_name  — identifier for the blueprint (e.g. "CouponHive")
 *   project_path  — absolute path to the C# test project root
 *
 * Output:
 *   Confirmation message with scan summary + blueprint file path
 */

import { FrameworkMemoryService } from '../services/frameworkMemory.service.js';
import type { ToolOutput } from '../types/mcp.types.js';

interface ScanFrameworkInput {
  project_name: string;
  project_path: string;
}

export async function scanFramework(input: ScanFrameworkInput): Promise<ToolOutput> {
  try {
    const { project_name, project_path } = input;

    if (!project_name?.trim()) {
      return {
        content: [{ type: 'text', text: '❌ project_name is required.' }],
        isError: true
      };
    }
    if (!project_path?.trim()) {
      return {
        content: [{ type: 'text', text: '❌ project_path is required.' }],
        isError: true
      };
    }

    const service   = new FrameworkMemoryService();
    const blueprint = await service.scanProject(project_name.trim(), project_path.trim());
    const savedPath = await service.saveBlueprint(blueprint);

    const { scanSummary: s, pageObject: po, stepDefinition: sd,
            dbHelper: db, projectSetup: ps } = blueprint;

    const lines: string[] = [
      `✅ Framework blueprint saved for "${blueprint.projectName}"`,
      ``,
      `📁 Blueprint file: ${savedPath}`,
      `🕐 Scanned at:     ${new Date(blueprint.scannedAt).toLocaleString()}`,
      ``,
      `📊 Files scanned:`,
      `   Page objects      : ${s.pageFiles}`,
      `   Step definitions  : ${s.stepFiles}`,
      `   DB helpers        : ${s.dbHelperFiles}`,
      `   Test contexts     : ${s.contextFiles}`,
      `   Runsettings files : ${s.runsettings}`,
      `   .csproj files     : ${s.csprojFiles}`,
      ``,
      `🧬 Extracted patterns:`,
      ``,
      `  Page Object:`,
      `    Base class       : ${po.baseClass ?? '(none)'}`,
      `    Constructor      : (${po.constructorParams.join(', ')})`,
      `    Locator style    : ${po.locatorStyle}`,
      `    Async pattern    : ${po.asyncPattern}`,
      po.exampleMethods.length > 0
        ? `    Example methods  : ${po.exampleMethods.join(', ')}`
        : '',
      ``,
      `  Step Definitions:`,
      `    Base class       : ${sd.baseClass ?? '(none)'}`,
      `    Injection        : (${sd.injection.join(', ')})`,
      `    Binding style    : ${sd.bindingStyle}`,
      `    Naming           : ${sd.namingConvention}`,
      sd.exampleSteps.length > 0
        ? `    Example steps    : "${sd.exampleSteps.slice(0, 2).join('", "')}"`
        : '',
      ``,
      `  DB Helper:`,
      `    ORM              : ${db.orm}`,
      `    Connection src   : ${db.connectionSource}.${db.connectionMethod}()`,
      ``,
      `  Project Setup:`,
      `    Target framework : ${ps.targetFramework}`,
      `    Test framework   : ${ps.testFramework}`,
      `    Runsettings      : ${ps.runsettingsPattern}`,
      ``,
      `💡 To scaffold a new project from this blueprint, use:`,
      `   scaffold_project({`,
      `     blueprint_name:   "${blueprint.projectName}",`,
      `     new_project_name: "YourNewProject",`,
      `     output_path:      "C:/path/to/output"`,
      `   })`,
    ];

    return {
      content: [{ type: 'text', text: lines.filter(l => l !== '').join('\n') }]
    };

  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ scan_framework failed: ${error.message}`
      }],
      isError: true
    };
  }
}
