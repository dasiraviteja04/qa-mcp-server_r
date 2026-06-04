/**
 * MCP Tool: generate_tests_from_requirements
 *
 * ADDS requirement-traced scenarios to an existing .feature file
 * and ADDS only NEW step definitions to an existing steps file.
 * Never overwrites or deletes existing scaffold output.
 *
 * Language is read from the blueprint — never passed as input.
 */

import * as path from 'path';
import { RequirementsReaderService }       from '../services/requirementsReader.service.js';
import { RequirementsTestGeneratorService } from '../services/requirementsTestGenerator.service.js';
import { FrameworkMemoryService }           from '../services/frameworkMemory.service.js';
import { LiveCrawlerService }               from '../services/liveCrawler.service.js';
import { DbSchemaService }                  from '../services/dbSchema.service.js';
import type { ToolOutput }                  from '../types/mcp.types.js';

interface GenerateTestsFromRequirementsInput {
  project_name:          string;
  blueprint_name:        string;
  output_path:           string;
  requirements_filter?: {
    sections?: string[];
    types?:    string[];
    priority?: 'all' | 'high' | 'medium';
  };
}

export async function generateTestsFromRequirements(
  input: GenerateTestsFromRequirementsInput
): Promise<ToolOutput> {
  try {
    // ── Validate required inputs ───────────────────────────────────────────
    if (!input.project_name?.trim()) {
      return { content: [{ type: 'text', text: '❌ project_name is required.' }], isError: true };
    }
    if (!input.blueprint_name?.trim()) {
      return { content: [{ type: 'text', text: '❌ blueprint_name is required.' }], isError: true };
    }
    if (!input.output_path?.trim()) {
      return { content: [{ type: 'text', text: '❌ output_path is required.' }], isError: true };
    }

    // ── STEP 1: Load all context ───────────────────────────────────────────

    // Requirements (REQUIRED)
    const reqService  = new RequirementsReaderService();
    if (!reqService.has(input.project_name)) {
      return {
        content: [{
          type: 'text',
          text: [
            `❌ No requirements found for "${input.project_name}".`,
            ``,
            `Run read_requirements first:`,
            `  read_requirements({`,
            `    project_name: "${input.project_name}",`,
            `    file_path: "C:\\\\docs\\\\${input.project_name}-Requirements.docx",`,
            `    file_type: "docx"`,
            `  })`,
          ].join('\n'),
        }],
        isError: true,
      };
    }
    const doc = reqService.load(input.project_name);

    // Blueprint (REQUIRED) — language lives here
    const memSvc    = new FrameworkMemoryService();
    const blueprint = memSvc.loadBlueprint(input.blueprint_name);
    const language  = blueprint.language ?? 'csharp';

    // Crawl data (OPTIONAL)
    const crawlSvc  = new LiveCrawlerService();
    const crawlData = crawlSvc.hasCrawl(input.project_name)
      ? (() => { try { return crawlSvc.loadCrawl(input.project_name); } catch { return null; } })()
      : null;

    // Schema data (OPTIONAL)
    const schemaSvc  = new DbSchemaService();
    const schemaData = schemaSvc.hasSchema(input.project_name)
      ? (() => { try { return schemaSvc.loadSchema(input.project_name); } catch { return null; } })()
      : null;

    // ── Run generator ──────────────────────────────────────────────────────
    const generator = new RequirementsTestGeneratorService();
    const result    = await generator.generate(
      input,
      doc.requirements,
      blueprint,
      crawlData,
      schemaData,
    );

    // ── Update requirements JSON with hasTest + testScenario ──────────────
    // (generator already appended to files — now persist the updated doc)
    const updatedReqs = doc.requirements.map(req => {
      const wasAdded = result.changes.scenariosAdded > 0 &&
        !result.existingFilesFound.featureFile?.includes(req.id);
      if (wasAdded && !req.hasTest) {
        return { ...req, hasTest: true };
      }
      return req;
    });
    await reqService.save(input.project_name, { ...doc, requirements: updatedReqs });

    // ── Format output ──────────────────────────────────────────────────────
    const { changes, existingFilesFound, warnings } = result;

    const relativePath = (p: string | null) =>
      p ? path.relative(input.output_path, p) : null;

    const lines: string[] = [
      `✅ Requirements scenarios added to "${input.project_name}" (${language})`,
      ``,
      `📁 Output directory: ${input.output_path}`,
      ``,
      `📄 Files modified:`,
      existingFilesFound.featureFile
        ? `   Feature file  : ${relativePath(existingFilesFound.featureFile) ?? existingFilesFound.featureFile}`
        : `   Feature file  : ⚠️  not found`,
      existingFilesFound.stepsFile
        ? `   Steps file    : ${relativePath(existingFilesFound.stepsFile) ?? existingFilesFound.stepsFile}`
        : `   Steps file    : ⚠️  not found`,
      existingFilesFound.pageObject
        ? `   Page object   : ${relativePath(existingFilesFound.pageObject) ?? existingFilesFound.pageObject} (read-only — methods reused)`
        : `   Page object   : ⚠️  not found — generic step text used`,
      ``,
      `📊 Changes made:`,
      `   Scenarios added    : ${changes.scenariosAdded}`,
      `   Scenarios skipped  : ${changes.scenariosSkipped}  (already existed in feature file)`,
      `   Steps added        : ${changes.stepsAdded}`,
      `   Steps skipped      : ${changes.stepsSkipped}  (already existed in steps file)`,
      `   Page methods reused: ${changes.pageMethodsReused}`,
      `   TODOs to implement : ${changes.todoCount}`,
      ``,
    ];

    if (warnings.length > 0) {
      lines.push(`⚠️  Warnings:`);
      warnings.forEach(w => lines.push(`   • ${w}`));
      lines.push('');
    }

    lines.push(
      `🚀 Next steps:`,
      `   1. Review added scenarios in the .feature file`,
      language === 'typescript'
        ? `   2. Implement TODO actions in *.steps.ts`
        : `   2. Implement TODO actions in *Steps.cs`,
      `   3. Run tests: run_tests`,
      `   4. Run requirements_coverage to measure traceability`,
      `   5. Run generate_html_report for full traceability matrix`,
    );

    return { content: [{ type: 'text', text: lines.join('\n') }] };

  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `❌ generate_tests_from_requirements failed: ${error.message}`,
      }],
      isError: true,
    };
  }
}
