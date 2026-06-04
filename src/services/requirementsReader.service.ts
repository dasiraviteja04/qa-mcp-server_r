/**
 * RequirementsReaderService
 *
 * Reads a requirements document (docx / pdf / xlsx / txt),
 * parses individual requirements from it, assigns REQ-NNN IDs,
 * classifies type + priority, and saves to:
 *   memory/requirements/{project_name}-requirements.json
 */

import * as fs   from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type {
  ProjectRequirements,
  Requirement,
  RequirementType,
  RequirementPriority,
} from '../types/requirements.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface ReadRequirementsInput {
  project_name: string;
  file_path:    string;
  file_type:    'docx' | 'pdf' | 'xlsx' | 'txt';
}

// ---------------------------------------------------------------------------
// Section-heading detection
// ---------------------------------------------------------------------------

const REQUIREMENTS_HEADINGS = new Set([
  'requirements', 'functional', 'features', 'user stories',
  'acceptance criteria', 'functional requirements', 'business requirements',
  'system requirements', 'non-functional', 'non-functional requirements',
]);

function isRequirementsHeading(text: string): boolean {
  const lower = text.toLowerCase().trim();
  for (const h of REQUIREMENTS_HEADINGS) {
    if (lower.includes(h)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Line-level requirement detection
// ---------------------------------------------------------------------------

const REQ_PREFIXES = [
  /^(req-?\d+[\d.]*)\s*[.:\-–]\s*/i,   // REQ-001: …
  /^(fr-?\d+[\d.]*)\s*[.:\-–]\s*/i,    // FR-001: …
  /^(\d{1,3}\.[\d.]*)\s+/,              // 1.1 / 2.3.4 …
  /^\d+\.\s+/,                          // 1. / 2. numbered list
  /^[-•*]\s+/,                          // bullet list
];

const REQ_SENTENCE_STARTERS = [
  'the system shall', 'the application shall', 'the application must',
  'user can', 'user must', 'user should', 'users can', 'users must',
  'the system should', 'the system must',
];

function looksLikeRequirement(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 10) return false;

  const lower = trimmed.toLowerCase();
  if (REQ_SENTENCE_STARTERS.some(s => lower.startsWith(s))) return true;

  for (const rx of REQ_PREFIXES) {
    if (rx.test(trimmed)) return true;
  }
  return false;
}

function stripPrefix(line: string): string {
  let s = line.trim();
  for (const rx of REQ_PREFIXES) {
    s = s.replace(rx, '');
  }
  return s.trim();
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function classifyType(text: string): RequirementType {
  const l = text.toLowerCase();
  if (/login|password|auth|permission|access|role|session|secure|encrypt/i.test(l)) return 'security';
  if (/speed|fast|perform|latency|load|throughput|response time|under \d+s/i.test(l)) return 'performance';
  if (/display|visible|layout|colour|color|font|button|page|screen|ui|style/i.test(l)) return 'ui';
  if (/api|integration|sync|webhook|third.party|import|export|connect/i.test(l)) return 'integration';
  if (/must not|shall not|invalid|error|reject|limit|constraint|validate|maximum|minimum|required field/i.test(l)) return 'validation';
  return 'functional';
}

function classifyPriority(text: string): RequirementPriority {
  const l = text.toLowerCase();
  if (/must|shall|critical|mandatory|required|essential|always/i.test(l)) return 'high';
  if (/may|optional|nice to have|wish|could|future/i.test(l)) return 'low';
  return 'medium';
}

// ---------------------------------------------------------------------------
// Document readers
// ---------------------------------------------------------------------------

async function readTxt(filePath: string): Promise<string[]> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return content.split(/\r?\n/);
}

async function readDocx(filePath: string): Promise<string[]> {
  // Dynamic import — mammoth is a CJS module
  const mammoth = await import('mammoth');
  const result  = await mammoth.extractRawText({ path: filePath });
  return result.value.split(/\r?\n/);
}

async function readPdf(filePath: string): Promise<string[]> {
  // pdf-parse has CJS default export
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
  const buffer   = await fs.promises.readFile(filePath);
  const data     = await pdfParse(buffer);
  return data.text.split(/\r?\n/);
}

async function readXlsx(filePath: string): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx') as typeof import('xlsx');
  const wb   = XLSX.readFile(filePath);
  const lines: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws   = wb.Sheets[sheetName]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    for (const row of rows) {
      const parts = Object.values(row)
        .map((v: unknown) => String(v ?? '').trim())
        .filter(Boolean);
      if (parts.length > 0) lines.push(parts.join(' — '));
    }
  }
  return lines;
}

async function readDocument(input: ReadRequirementsInput): Promise<string[]> {
  switch (input.file_type) {
    case 'docx': return readDocx(input.file_path);
    case 'pdf':  return readPdf(input.file_path);
    case 'xlsx': return readXlsx(input.file_path);
    case 'txt':  return readTxt(input.file_path);
    default:     return readTxt(input.file_path);
  }
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

function parseRequirements(lines: string[]): {
  requirements: Requirement[];
  sections:     string[];
} {
  const requirements: Requirement[] = [];
  const sections:     string[]      = [];
  const seenSections = new Set<string>();

  let currentSection  = 'General';
  let inReqSection    = false;
  let reqCounter      = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Detect headings (short lines, possibly ALL CAPS or Title Case)
    const isHeading = line.length < 80 &&
      !line.endsWith('.') &&
      (
        /^[A-Z][A-Z\s&/-]{4,}$/.test(line) ||        // ALL CAPS
        /^#{1,4}\s+/.test(line) ||                     // Markdown heading
        /^\d+\.\s+[A-Z][a-zA-Z\s]+$/.test(line) ||   // 1. Section Title
        /^[A-Z][a-zA-Z\s&/-]{4,50}$/.test(line)       // Title Case
      );

    if (isHeading) {
      const clean = line.replace(/^#{1,4}\s+/, '').trim();
      currentSection = clean;
      inReqSection   = isRequirementsHeading(clean);

      if (!seenSections.has(clean)) {
        seenSections.add(clean);
        sections.push(clean);
      }
      continue;
    }

    // Only parse requirements when inside a relevant section OR line itself looks like req
    if (!inReqSection && !looksLikeRequirement(line)) continue;
    if (!looksLikeRequirement(line)) continue;

    reqCounter++;
    const id   = `REQ-${String(reqCounter).padStart(3, '0')}`;
    const text = stripPrefix(line);

    if (!seenSections.has(currentSection)) {
      seenSections.add(currentSection);
      sections.push(currentSection);
    }

    requirements.push({
      id,
      text,
      type:         classifyType(text),
      priority:     classifyPriority(text),
      section:      currentSection,
      hasTest:      false,
      testScenario: null,
    });
  }

  return { requirements, sections };
}

// ---------------------------------------------------------------------------
// RequirementsReaderService
// ---------------------------------------------------------------------------

export class RequirementsReaderService {
  private memDir: string;

  constructor(serverRoot?: string) {
    const root    = serverRoot ?? path.join(__dirname, '..', '..');
    this.memDir   = path.join(root, 'memory', 'requirements');
    fs.mkdirSync(this.memDir, { recursive: true });
  }

  async run(input: ReadRequirementsInput): Promise<ProjectRequirements> {
    if (!fs.existsSync(input.file_path)) {
      throw new Error(`File not found: ${input.file_path}`);
    }

    // Read document
    const lines = await readDocument(input);

    // Parse requirements
    const { requirements, sections } = parseRequirements(lines);

    if (requirements.length === 0) {
      throw new Error(
        `No requirements detected in ${path.basename(input.file_path)}. ` +
        `Make sure the document contains lines starting with ` +
        `"The system shall", "User can", numbered lists (1.), ` +
        `or requirement IDs (REQ-001, FR-001).`
      );
    }

    const doc: ProjectRequirements = {
      projectName:       input.project_name,
      sourceFile:        path.basename(input.file_path),
      readAt:            new Date().toISOString(),
      totalRequirements: requirements.length,
      sections,
      requirements,
    };

    await this.save(input.project_name, doc);
    return doc;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async save(projectName: string, doc: ProjectRequirements): Promise<string> {
    const outPath = this.filePath(projectName);
    const tmp     = outPath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf-8');
    await fs.promises.rename(tmp, outPath);
    return outPath;
  }

  load(projectName: string): ProjectRequirements {
    const p = this.filePath(projectName);
    if (!fs.existsSync(p)) {
      throw new Error(
        `Requirements not found for "${projectName}". ` +
        `Run read_requirements first.`
      );
    }
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ProjectRequirements;
  }

  has(projectName: string): boolean {
    return fs.existsSync(this.filePath(projectName));
  }

  listAll(): Array<{
    projectName: string;
    readAt: string;
    sourceFile: string;
    totalRequirements: number;
  }> {
    try {
      return fs.readdirSync(this.memDir)
        .filter(f => f.endsWith('-requirements.json'))
        .map(f => {
          try {
            const raw = fs.readFileSync(path.join(this.memDir, f), 'utf-8');
            const doc = JSON.parse(raw) as ProjectRequirements;
            return {
              projectName:       doc.projectName,
              readAt:            doc.readAt,
              sourceFile:        doc.sourceFile,
              totalRequirements: doc.totalRequirements,
            };
          } catch { return null; }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => b.readAt.localeCompare(a.readAt));
    } catch {
      return [];
    }
  }

  private filePath(projectName: string): string {
    return path.join(this.memDir, `${projectName}-requirements.json`);
  }
}
