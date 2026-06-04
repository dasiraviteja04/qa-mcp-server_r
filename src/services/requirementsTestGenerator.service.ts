/**
 * RequirementsTestGeneratorService
 *
 * Adds requirement-traced Gherkin scenarios to an EXISTING feature file
 * and adds ONLY NEW step definitions to an EXISTING steps file.
 * Never overwrites or deletes existing content.
 *
 * Language routing:
 *   routeStepGenerator() is the ONLY place that checks blueprint.language.
 *   One switch. One place to extend for future languages.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { glob }  from 'glob';
import type { FrameworkBlueprint }  from '../types/framework.types.js';
import type {
  Requirement,
  GeneratedScenario,
  GeneratedStep,
  GenerationContext,
} from '../types/requirements.types.js';
import type { PageCrawl }    from '../types/crawl.types.js';
import type { ProjectSchema } from '../types/schema.types.js';

// ---------------------------------------------------------------------------
// Re-export types that the tool needs
// ---------------------------------------------------------------------------
export type { GenerationContext };

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface GenerateFromRequirementsInput {
  project_name:          string;
  blueprint_name:        string;
  output_path:           string;
  requirements_filter?:  {
    sections?: string[];
    types?:    string[];
    priority?: 'all' | 'high' | 'medium';
  };
}

export interface GenerateFromRequirementsResult {
  language:           string;
  existingFilesFound: {
    featureFile:  string | null;
    stepsFile:    string | null;
    pageObject:   string | null;
  };
  changes: {
    scenariosAdded:    number;
    scenariosSkipped:  number;
    stepsAdded:        number;
    stepsSkipped:      number;
    pageMethodsReused: number;
    todoCount:         number;
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// File finders
// ---------------------------------------------------------------------------

async function findFile(
  dir: string,
  pattern: string
): Promise<string | null> {
  try {
    const matches = await glob(pattern, { cwd: dir, absolute: true, nodir: true });
    return matches[0] ?? null;
  } catch {
    return null;
  }
}

async function findExistingFiles(outputPath: string, language: string): Promise<{
  featureFile: string | null;
  stepsFile:   string | null;
  pageObject:  string | null;
}> {
  if (language === 'typescript') {
    return {
      featureFile: await findFile(outputPath, '**/*.feature'),
      stepsFile:   await findFile(outputPath, '**/*.steps.ts'),
      pageObject:  await findFile(outputPath, '**/*.page.ts'),
    };
  }
  // csharp default
  return {
    featureFile: await findFile(outputPath, '**/*.feature'),
    stepsFile:   await findFile(outputPath, '**/*Steps.cs'),
    pageObject:  await findFile(outputPath, '**/*Page.cs'),
  };
}

// ---------------------------------------------------------------------------
// Page method extraction
// ---------------------------------------------------------------------------

function extractPageMethods(content: string, language: string): string[] {
  const methods: string[] = [];
  if (language === 'typescript') {
    // async methodName( or methodName = async (
    const rx = /(?:async\s+(\w+)\s*\(|(\w+)\s*=\s*async\s*\()/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(content)) !== null) {
      const name = m[1] ?? m[2];
      if (name && name !== 'constructor') methods.push(name);
    }
  } else {
    // public async Task MethodName(
    const rx = /public\s+async\s+Task(?:<[^>]+>)?\s+(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(content)) !== null) {
      if (m[1]) methods.push(m[1]);
    }
  }
  return [...new Set(methods)];
}

// ---------------------------------------------------------------------------
// Existing step extraction (to avoid duplication)
// ---------------------------------------------------------------------------

function extractExistingSteps(content: string, language: string): Set<string> {
  const steps = new Set<string>();
  if (language === 'typescript') {
    const rx = /(?:Given|When|Then)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(content)) !== null) {
      if (m[1]) steps.add(m[1].toLowerCase());
    }
  } else {
    const rx = /\[(?:Given|When|Then)\s*\(\s*@?"([^"]+)"\s*\)\]/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(content)) !== null) {
      if (m[1]) steps.add(m[1].toLowerCase());
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Existing scenario tag extraction (to avoid duplicating scenarios)
// ---------------------------------------------------------------------------

function extractExistingReqTags(content: string): Set<string> {
  const tags = new Set<string>();
  const rx   = /@(REQ-\d{3})/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(content)) !== null) {
    if (m[1]) tags.add(m[1]);
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Gherkin scenario generation — LANGUAGE AGNOSTIC
// ---------------------------------------------------------------------------

function scenarioNameFromReq(req: Requirement): string {
  // Capitalise first letter, strip trailing period
  const text = req.text.replace(/\.$/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function generateStepsForReq(
  req:          Requirement,
  pageMethods:  string[],
  crawlData:    { buttons?: Array<{ purpose?: string; selector?: string }>; inputs?: Array<{ purpose?: string }> } | null,
): GeneratedStep[] {
  const steps: GeneratedStep[] = [];

  // Pick a real page method if available, otherwise placeholder
  const navMethod    = pageMethods.find(m => /navigate|goto|open|load/i.test(m)) ?? null;
  const actionMethod = pageMethods.find(m => !/navigate|goto|open|load|navigate|expect|assert|verify/i.test(m)) ?? null;
  const assertMethod = pageMethods.find(m => /expect|assert|verify|visible|check|get/i.test(m)) ?? null;

  switch (req.type) {
    case 'functional': {
      steps.push({
        stepType: 'Given',
        stepText: `I am on the ${req.section.toLowerCase()} page`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: navMethod,
      });
      steps.push({
        stepType: 'When',
        stepText: `I ${req.text.replace(/^User (can |must |should )/i, '').replace(/\.$/, '').toLowerCase()}`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: actionMethod,
      });
      steps.push({
        stepType: 'Then',
        stepText: `the action completes successfully`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: assertMethod,
      });
      break;
    }
    case 'validation': {
      steps.push({
        stepType: 'Given',
        stepText: `I am on the ${req.section.toLowerCase()} page`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: navMethod,
      });
      steps.push({
        stepType: 'When',
        stepText: `I provide invalid input`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: actionMethod,
      });
      steps.push({
        stepType: 'Then',
        stepText: `an error message is displayed`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: assertMethod,
      });
      break;
    }
    case 'security': {
      steps.push({
        stepType: 'Given',
        stepText: `I am not authenticated`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: null,
      });
      steps.push({
        stepType: 'When',
        stepText: `I try to access the ${req.section.toLowerCase()} area`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: navMethod,
      });
      steps.push({
        stepType: 'Then',
        stepText: `I am redirected to the login page`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: assertMethod,
      });
      break;
    }
    case 'performance': {
      steps.push({
        stepType: 'Given',
        stepText: `the application is under normal load`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: null,
      });
      steps.push({
        stepType: 'When',
        stepText: `I perform the ${req.section.toLowerCase()} action`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: actionMethod,
      });
      steps.push({
        stepType: 'Then',
        stepText: `the response completes within 3 seconds`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: assertMethod,
      });
      break;
    }
    case 'ui': {
      steps.push({
        stepType: 'Given',
        stepText: `the ${req.section.toLowerCase()} page has loaded`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: navMethod,
      });
      steps.push({
        stepType: 'When',
        stepText: `I view the page`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: null,
      });
      steps.push({
        stepType: 'Then',
        stepText: `all required elements are visible`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: assertMethod,
      });
      break;
    }
    default: {  // integration
      steps.push({
        stepType: 'Given',
        stepText: `the ${req.section.toLowerCase()} integration is configured`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: null,
      });
      steps.push({
        stepType: 'When',
        stepText: `the integration is triggered`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: actionMethod,
      });
      steps.push({
        stepType: 'Then',
        stepText: `data is synchronised correctly`,
        requirementIds: [req.id],
        requirementText: req.text,
        pageMethod: assertMethod,
      });
    }
  }
  return steps;
}

function buildGherkinScenario(req: Requirement, steps: GeneratedStep[]): string {
  const sectionTag = req.section
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const tags = `@${req.id} @${sectionTag} @${req.type} @${req.priority}`;

  const stepLines = steps.map(s => `    ${s.stepType} ${s.stepText}`).join('\n');
  const scenarioName = scenarioNameFromReq(req);

  return `  ${tags}\n  Scenario: ${scenarioName}\n${stepLines}`;
}

// ---------------------------------------------------------------------------
// Step code generation — LANGUAGE SPECIFIC
// THE ONLY PLACE blueprint.language IS CHECKED
// ---------------------------------------------------------------------------

function generateCSharpSteps(
  newSteps:   GeneratedStep[],
  context:    GenerationContext,
  className:  string,
): string {
  const date = new Date().toISOString().split('T')[0];
  let code = `\n    // ── Requirements-based steps ────────────────────────────────────\n`;
  code    += `    // Generated: ${date}\n`;
  code    += `    // Source: memory/requirements/${context.projectName}-requirements.json\n`;

  const seen = new Set<string>();

  for (const step of newSteps) {
    const key = step.stepText.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const methodName = step.stepText
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('')
      .replace(/[^a-zA-Z0-9]/g, '');

    const pageCall = step.pageMethod
      ? `        await _page.${step.pageMethod}();`
      : `        // TODO: implement action`;

    const usedBy = step.requirementIds.length > 1
      ? `\n        // Used by: ${step.requirementIds.join(', ')}`
      : '';

    code += `
    [${step.stepType}(@"${step.stepText}")]
    // ${step.requirementIds[0]}: ${step.requirementText.substring(0, 80)}${usedBy}
    public async Task ${step.stepType}${methodName}()
    {
${pageCall}
        // TODO: add assertion
    }
`;
  }

  return code;
}

function generateTypeScriptSteps(
  newSteps:  GeneratedStep[],
  context:   GenerationContext,
  pageClass: string,
): string {
  const date = new Date().toISOString().split('T')[0];
  let code = `\n// ── Requirements-based steps ────────────────────────────────────\n`;
  code    += `// Generated: ${date}\n`;
  code    += `// Source: memory/requirements/${context.projectName}-requirements.json\n`;

  const seen = new Set<string>();

  for (const step of newSteps) {
    const key = step.stepText.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const camelName = context.projectName.charAt(0).toLowerCase() + context.projectName.slice(1);
    const pageCall  = step.pageMethod
      ? `  await ${camelName}Page.${step.pageMethod}();`
      : `  // TODO: implement action`;

    const usedBy = step.requirementIds.length > 1
      ? `\n// Used by: ${step.requirementIds.join(', ')}`
      : '';

    code += `
// ${step.requirementIds[0]}: ${step.requirementText.substring(0, 80)}${usedBy}
${step.stepType}('${step.stepText}', async function(this: IWorld) {
  const ${camelName}Page = new ${pageClass}(this.page);
${pageCall}
  // TODO: add assertion
});
`;
  }

  return code;
}

/**
 * THE ONLY SWITCH ON blueprint.language.
 * All other code is language-agnostic.
 */
function routeStepGenerator(
  blueprint: FrameworkBlueprint,
  newSteps:  GeneratedStep[],
  context:   GenerationContext,
  className: string,
): string {
  switch (blueprint.language) {
    case 'typescript':
      return generateTypeScriptSteps(newSteps, context, className);
    case 'csharp':
    default:
      return generateCSharpSteps(newSteps, context, className);
  }
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

export class RequirementsTestGeneratorService {

  async generate(
    input:        GenerateFromRequirementsInput,
    requirements: Requirement[],
    blueprint:    FrameworkBlueprint,
    crawlData:    PageCrawl | null,
    schemaData:   ProjectSchema | null,
  ): Promise<GenerateFromRequirementsResult> {
    const language = blueprint.language ?? 'csharp';
    const warnings: string[] = [];

    // ── STEP 2: Find existing scaffold files ─────────────────────────────────
    const files = await findExistingFiles(input.output_path, language);

    if (!files.featureFile) {
      throw new Error(
        `No existing .feature file found under "${input.output_path}". ` +
        `Run scaffold_project first, then run this tool to add requirement scenarios on top.`
      );
    }

    // ── STEP 3: Read existing page object methods ─────────────────────────────
    let pageMethods: string[] = [];
    if (files.pageObject) {
      const pageContent = fs.readFileSync(files.pageObject, 'utf-8');
      pageMethods       = extractPageMethods(pageContent, language);
    } else {
      warnings.push(
        `Page object file not found — step definitions will use TODO comments ` +
        `instead of real page methods. Run scaffold_project first.`
      );
    }

    // ── STEP 4: Read existing steps to avoid duplication ─────────────────────
    let existingSteps = new Set<string>();
    if (files.stepsFile) {
      const stepsContent = fs.readFileSync(files.stepsFile, 'utf-8');
      existingSteps      = extractExistingSteps(stepsContent, language);
    }

    // ── Read existing REQ tags in feature file ────────────────────────────────
    const featureContent    = fs.readFileSync(files.featureFile, 'utf-8');
    const existingReqTags   = extractExistingReqTags(featureContent);

    // ── STEP 5: Apply filter + generate scenarios ─────────────────────────────
    const filter = input.requirements_filter ?? {};

    const filteredReqs = requirements.filter(req => {
      if (filter.sections?.length && !filter.sections.includes(req.section)) return false;
      if (filter.types?.length    && !filter.types.includes(req.type))       return false;
      if (filter.priority && filter.priority !== 'all' && req.priority !== filter.priority) return false;
      return true;
    });

    let scenariosAdded   = 0;
    let scenariosSkipped = 0;
    let stepsAdded       = 0;
    let stepsSkipped     = 0;
    let pageMethodsReused = 0;
    let todoCount        = 0;

    const featureAdditions: string[] = [];
    const allNewSteps: GeneratedStep[] = [];
    const updatedRequirements: Requirement[] = [];

    for (const req of filteredReqs) {
      if (existingReqTags.has(req.id)) {
        scenariosSkipped++;
        continue;
      }

      const steps    = generateStepsForReq(req, pageMethods, crawlData as any);
      const scenario = buildGherkinScenario(req, steps);
      featureAdditions.push(scenario);
      scenariosAdded++;

      for (const step of steps) {
        if (step.pageMethod) pageMethodsReused++;
        else                 todoCount++;
        allNewSteps.push(step);
      }

      updatedRequirements.push({ ...req, hasTest: true, testScenario: scenarioNameFromReq(req) });
    }

    // ── STEP 5 continued: Append to feature file ──────────────────────────────
    if (featureAdditions.length > 0) {
      const date      = new Date().toISOString().split('T')[0];
      const separator = [
        ``,
        `  # ── Requirements-based scenarios ──────────────────────────────────`,
        `  # Generated: ${date}`,
        `  # Source: memory/requirements/${input.project_name}-requirements.json`,
        ``,
      ].join('\n');

      const addition = separator + featureAdditions.join('\n\n') + '\n';
      fs.appendFileSync(files.featureFile, addition, 'utf-8');
    }

    // ── STEP 6: Append new step definitions ───────────────────────────────────
    if (allNewSteps.length > 0 && files.stepsFile) {
      // Filter out steps that already exist
      const trulyNewSteps = allNewSteps.filter(
        s => !existingSteps.has(s.stepText.toLowerCase())
      );

      for (const s of trulyNewSteps) {
        if (existingSteps.has(s.stepText.toLowerCase())) {
          stepsSkipped++;
        } else {
          stepsAdded++;
          existingSteps.add(s.stepText.toLowerCase());
        }
      }

      if (trulyNewSteps.length > 0) {
        const context: GenerationContext = {
          projectName: input.project_name,
          blueprint,
          crawlData,
          schemaData,
        };

        // Derive class name from output path
        const dirName  = path.basename(input.output_path.replace(/\\/g, '/'));
        const className = dirName.replace(/[^a-zA-Z0-9]/g, '') + 'Page';

        const stepCode = routeStepGenerator(blueprint, trulyNewSteps, context, className);
        fs.appendFileSync(files.stepsFile, stepCode, 'utf-8');
      }
    } else if (allNewSteps.length > 0 && !files.stepsFile) {
      warnings.push(
        `Steps file not found — new step definitions were not written. ` +
        `Run scaffold_project first.`
      );
    }

    // stepsSkipped = steps that were in existing file
    stepsSkipped = allNewSteps.length - stepsAdded;
    if (stepsSkipped < 0) stepsSkipped = 0;

    return {
      language,
      existingFilesFound: files,
      changes: {
        scenariosAdded,
        scenariosSkipped,
        stepsAdded,
        stepsSkipped,
        pageMethodsReused,
        todoCount,
      },
      warnings,
    };
  }
}
