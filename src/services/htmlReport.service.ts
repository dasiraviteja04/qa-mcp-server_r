/**
 * HTML Report Service
 * Generates a self-contained, print-ready HTML QA report from the latest
 * ExecutionReport JSON + historical trend data.
 *
 * Designed for sharing with BAs and managers — business-friendly labels,
 * colour-coded verdict banner, trend sparkline, collapsed passed tests.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath }  from 'url';

import { ReportService }   from './report.service.js';
import type { ExecutionReport, TestResult, FailureAnalysis } from '../types/mcp.types.js';
import type { RequirementsCoverage, ProjectRequirements } from '../types/requirements.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HtmlReportOptions {
  /** Plain-text output from coverage_analysis tool (optional) */
  coverageText?: string;
  /** Plain-text output from get_release_risk tool (optional) */
  riskText?: string;
  /** Report title shown in the header */
  title?: string;
  /** Open the generated file in the default browser after writing */
  openInBrowser?: boolean;
  /** Override the output path (default: <reportsDir>/report-YYYY-MM-DD-HHmmss.html) */
  outputPath?: string;
  /** Project name — used to load requirements coverage from memory/ */
  projectName?: string;
  /** Include requirements traceability sections (default: true) */
  includeRequirements?: boolean;
}

interface LabelEntry {
  label: string;
  area:  string;
}

interface LabelsConfig {
  labels: Record<string, LabelEntry>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a PascalCase/camelCase C# test name to readable English (fallback). */
function humanize(name: string): string {
  // Strip trailing parameter list, e.g. Foo("bar","baz",null) → Foo
  const base = name.replace(/\(.*\)$/, '').trim();
  // Insert spaces before uppercase letters that follow lowercase letters or digits
  return base
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Extract the base test name (strip parameterised suffix). */
function baseName(name: string): string {
  return name.replace(/\(.*\)$/, '').trim();
}

/** Format milliseconds as "20m 39s" or "45s" or "1h 5m". */
function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const h   = Math.floor(totalSec / 3600);
  const m   = Math.floor((totalSec % 3600) / 60);
  const s   = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Format a test-level duration (stored as ms in ExecutionReport). */
function formatTestDuration(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** ISO timestamp → "08 May 2026, 19:45" */
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  } catch {
    return iso;
  }
}

/** Strip HTML entities like &#xD; from error strings. */
function cleanError(raw: string): string {
  return raw
    .replace(/&#xD;/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g,  '<')
    .replace(/&gt;/g,  '>')
    .replace(/&quot;/g, '"')
    .replace(/\r\n|\r/g, '\n')
    .trim();
}

/** Escape a string for safe HTML insertion. */
function esc(s: string): string {
  return s
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

export class HtmlReportService {
  private reportService: ReportService;
  private reportsDir:    string;
  private labels:        Record<string, LabelEntry>;

  constructor(reportsDir: string) {
    this.reportsDir   = reportsDir;
    this.reportService = new ReportService(reportsDir);
    this.labels        = this.loadLabels();
  }

  // ── Label loading ──────────────────────────────────────────────────────────

  private loadLabels(): Record<string, LabelEntry> {
    // __dirname is dist/services/ in compiled output.
    // test-labels.json lives in src/config/ — go up to project root first.
    const candidates = [
      path.join(__dirname, '..', 'config', 'test-labels.json'),          // src/services → src/config
      path.join(__dirname, '..', '..', 'src', 'config', 'test-labels.json'), // dist/services → src/config
      path.join(__dirname, '..', '..', 'dist', 'config', 'test-labels.json') // dist/services → dist/config
    ];
    for (const p of candidates) {
      try {
        const raw    = fs.readFileSync(p, 'utf-8');
        const config = JSON.parse(raw) as LabelsConfig;
        return config.labels ?? {};
      } catch {
        // try next candidate
      }
    }
    return {};
  }

  private getLabel(testName: string): LabelEntry {
    const base = baseName(testName);
    if (this.labels[base]) return this.labels[base]!;
    // Partial match: label key is a prefix of the test name
    for (const [key, entry] of Object.entries(this.labels)) {
      if (base.startsWith(key) || testName.startsWith(key)) return entry;
    }
    return { label: humanize(testName), area: this.inferArea(testName) };
  }

  private inferArea(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('export'))      return 'Export';
    if (lower.includes('audit'))       return 'Audit';
    if (lower.includes('bulk') || lower.includes('batch')) return 'Bulk Generate';
    if (lower.includes('filter') || lower.includes('search')) return 'Filter & Search';
    if (lower.includes('duplicate'))   return 'Duplicate Prevention';
    if (lower.includes('tenant'))      return 'Multi-Tenant';
    if (lower.includes('rate') || lower.includes('numeric') || lower.includes('decimal')) return 'Rate Validation';
    if (lower.includes('edit') || lower.includes('update') || lower.includes('enddate')) return 'Edit';
    if (lower.includes('navigation') || lower.includes('back') || lower.includes('portfolio')) return 'Navigation';
    if (lower.includes('generate') || lower.includes('create') || lower.includes('single')) return 'Generate';
    return 'General';
  }

  // ── Trend data ─────────────────────────────────────────────────────────────

  private getTrendData(limit = 6): Array<{ label: string; passRate: number; passed: number; total: number }> {
    const reports = this.reportService.getAllReports().slice(0, limit).reverse();
    return reports.map((r, i) => ({
      label:    formatTimestamp(r.timestamp).split(',')[0] ?? `Run ${i + 1}`,
      passRate: r.totalTests > 0 ? Math.round((r.passed / r.totalTests) * 100) : 0,
      passed:   r.passed,
      total:    r.totalTests
    }));
  }

  // ── Screenshot discovery ───────────────────────────────────────────────────

  private findScreenshots(): string[] {
    try {
      return fs.readdirSync(this.reportsDir)
        .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
        .sort()
        .reverse()
        .slice(0, 20);
    } catch {
      return [];
    }
  }

  // ── Requirements data loader ───────────────────────────────────────────────

  private loadRequirementsData(
    projectName?: string,
    include?: boolean,
  ): { coverage: RequirementsCoverage | null; requirements: ProjectRequirements | null } {
    if (include === false || !projectName) return { coverage: null, requirements: null };

    const memBase = path.join(__dirname, '..', '..', 'memory', 'requirements');

    let coverage:     RequirementsCoverage  | null = null;
    let requirements: ProjectRequirements   | null = null;

    // Try coverage first (richer data)
    try {
      const cp = path.join(memBase, `${projectName}-coverage.json`);
      if (fs.existsSync(cp)) {
        coverage = JSON.parse(fs.readFileSync(cp, 'utf-8')) as RequirementsCoverage;
      }
    } catch { /* ignore */ }

    // Try requirements doc for req text (coverage only has IDs)
    try {
      const rp = path.join(memBase, `${projectName}-requirements.json`);
      if (fs.existsSync(rp)) {
        requirements = JSON.parse(fs.readFileSync(rp, 'utf-8')) as ProjectRequirements;
      }
    } catch { /* ignore */ }

    return { coverage, requirements };
  }

  // ── Requirements HTML builder ───────────────────────────────────────────────

  private buildRequirementsHtml(
    coverage:     RequirementsCoverage,
    requirements: ProjectRequirements | null,
  ): string {
    const { summary, details, failingRequirements, notCoveredRequirements, verdict } = coverage;

    const pct         = summary.coveragePercent;
    const barColour   = pct >= 80 ? '#27ae60' : pct >= 50 ? '#f39c12' : '#c0392b';
    const verdictColour =
      verdict === 'SAFE'    ? '#27ae60' :
      verdict === 'CAUTION' ? '#f39c12' :
      verdict === 'BLOCK'   ? '#c0392b' :
      '#2980b9';

    // Helper — get req text from requirements doc
    const reqText = (id: string): string => {
      if (!requirements) return id;
      return requirements.requirements.find(r => r.id === id)?.text ?? id;
    };
    const reqSection = (id: string): string => {
      return requirements?.requirements.find(r => r.id === id)?.section ?? '—';
    };
    const reqType = (id: string): string => {
      return requirements?.requirements.find(r => r.id === id)?.type ?? '—';
    };
    const reqPriority = (id: string): string => {
      return requirements?.requirements.find(r => r.id === id)?.priority ?? '—';
    };

    // ── Summary cards ─────────────────────────────────────────────────────────
    const summaryCards = `
      <div class="req-summary-cards">
        <div class="card card-blue">
          <div class="card-value">${summary.total}</div>
          <div class="card-label">Total Reqs</div>
        </div>
        <div class="card ${pct >= 80 ? 'card-green' : pct >= 50 ? 'card-amber' : 'card-red'}">
          <div class="card-value">${pct}%</div>
          <div class="card-label">Covered</div>
        </div>
        <div class="card ${summary.failing > 0 ? 'card-red' : 'card-green'}">
          <div class="card-value">${summary.failing}</div>
          <div class="card-label">Failing</div>
        </div>
        <div class="card ${summary.notCovered > 0 ? 'card-amber' : 'card-green'}">
          <div class="card-value">${summary.notCovered}</div>
          <div class="card-label">No Test</div>
        </div>
        <div class="card" style="border-top: 3px solid ${verdictColour};">
          <div class="card-value" style="font-size:18px;color:${verdictColour};">${verdict}</div>
          <div class="card-label">Req Verdict</div>
        </div>
      </div>`;

    // ── Coverage progress bar ─────────────────────────────────────────────────
    const progressBar = `
      <div style="margin-top:16px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;
                    color:#555;margin-bottom:4px;">
          <span>Requirements Coverage: <strong>${summary.covered} / ${summary.total}</strong></span>
          <span style="color:${barColour};font-weight:700;">${pct}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%;background:${barColour};"></div>
        </div>
      </div>`;

    // ── Traceability matrix table ─────────────────────────────────────────────
    const allIds = Object.keys(details).sort((a, b) => {
      const order = (id: string) => {
        const d = details[id];
        if (!d) return 3;
        if (d.testResult === 'failed') return 0;
        if (d.covered)                 return 1;
        return 2;
      };
      return order(a) - order(b);
    });

    const tableRows = allIds.map(id => {
      const d         = details[id]!;
      const status    = !d.covered              ? 'NO TEST'
                      : d.testResult === 'passed' ? 'PASSED'
                      : d.testResult === 'failed' ? 'FAILED'
                      : 'NOT RUN';
      const rowClass  = status === 'FAILED'  ? 'row-failed'
                      : status === 'NO TEST' ? 'row-notest'
                      : '';
      const statusCls = status === 'PASSED'  ? 'status-passed'
                      : status === 'FAILED'  ? 'status-failed'
                      : status === 'NO TEST' ? 'status-notest'
                      : 'status-notrun';
      const priCls    = `priority-${reqPriority(id)}`;
      const scenName  = d.scenarioName ? esc(d.scenarioName.substring(0, 60)) : '—';

      return `
        <tr class="${rowClass}">
          <td style="padding:8px 12px;white-space:nowrap;">
            <span class="req-id">${esc(id)}</span>
          </td>
          <td style="padding:8px 12px;font-size:12px;max-width:280px;">
            ${esc(reqText(id).substring(0, 90))}
          </td>
          <td style="padding:8px 12px;font-size:11px;color:#666;">${esc(reqSection(id))}</td>
          <td style="padding:8px 12px;font-size:11px;color:#666;">${esc(reqType(id))}</td>
          <td style="padding:8px 12px;">
            <span class="badge ${priCls}">${esc(reqPriority(id))}</span>
          </td>
          <td style="padding:8px 12px;">
            <span class="badge ${statusCls}">${status}</span>
          </td>
          <td style="padding:8px 12px;font-size:11px;color:#555;max-width:200px;">${scenName}</td>
        </tr>`;
    }).join('');

    const matrix = `
      <div style="overflow-x:auto;">
        <table class="req-table">
          <thead>
            <tr>
              <th>REQ ID</th>
              <th>Requirement</th>
              <th>Section</th>
              <th>Type</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Scenario</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;

    // ── Failing requirements detail ───────────────────────────────────────────
    let failingCards = '';
    if (failingRequirements.length > 0) {
      const cards = failingRequirements.map(id => {
        const pri = reqPriority(id);
        const isHighPri = pri === 'high';
        return `
          <div class="req-failure-card">
            ${isHighPri ? `<div class="impact-block">⛔ BLOCKS RELEASE</div>` : ''}
            <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;">
              <span class="req-id">${esc(id)}</span>
              <span class="badge priority-${pri}">${pri}</span>
              <span style="font-size:11px;color:#888;">${esc(reqSection(id))}</span>
            </div>
            <div style="font-weight:600;color:#1a1a1a;margin-bottom:4px;font-size:13px;">
              ${esc(reqText(id).substring(0, 120))}
            </div>
            ${details[id]?.scenarioName
              ? `<div style="font-size:12px;color:#555;margin-top:6px;">
                   Scenario: ${esc(details[id]!.scenarioName!)}
                 </div>`
              : ''}
          </div>`;
      }).join('');
      failingCards = `
        <div class="section">
          <div class="section-header">❌ Failing Requirements (${failingRequirements.length})</div>
          <div class="section-body">${cards}</div>
        </div>`;
    }

    // ── Not covered list ──────────────────────────────────────────────────────
    let notCoveredCards = '';
    if (notCoveredRequirements.length > 0) {
      const cards = notCoveredRequirements.map(id => {
        const pri = reqPriority(id);
        return `
          <div class="req-notest-card">
            <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:6px;">
              <span class="req-id">${esc(id)}</span>
              <span class="badge priority-${pri}">${pri}</span>
              <span style="font-size:11px;color:#888;">${esc(reqSection(id))}</span>
            </div>
            <div style="font-size:13px;color:#333;margin-bottom:4px;">
              ${esc(reqText(id).substring(0, 120))}
            </div>
            <div style="font-size:11px;color:#e67e22;margin-top:4px;">
              💡 Add test in next sprint using generate_tests_from_requirements
            </div>
          </div>`;
      }).join('');
      notCoveredCards = `
        <div class="section">
          <div class="section-header">⚠️ Not Covered — No Test Exists (${notCoveredRequirements.length})</div>
          <div class="section-body">${cards}</div>
        </div>`;
    }

    return `
      <!-- ── Requirements Summary ──────────────────────────────── -->
      <div class="section" id="req-section">
        <div class="section-header">📋 Requirements Traceability</div>
        <div class="section-body">
          ${summaryCards}
          ${progressBar}
        </div>
      </div>

      <!-- ── Traceability Matrix ────────────────────────────────── -->
      <div class="section">
        <div class="section-header">🗂️ Traceability Matrix</div>
        <div class="section-body" style="padding:0;">
          ${matrix}
        </div>
      </div>

      ${failingCards}
      ${notCoveredCards}`;
  }

  // ── Risk verdict from report data ──────────────────────────────────────────

  private deriveVerdict(report: ExecutionReport, failures: FailureAnalysis[]): {
    level: 'GO' | 'CAUTION' | 'NO-GO';
    label: string;
    colour: string;
    bgColour: string;
  } {
    const passRate = report.totalTests > 0 ? report.passed / report.totalTests : 1;
    const regressions = failures.filter(f => f.classification === 'regression' || f.classification === 'new-failure');

    if (regressions.length > 2 || passRate < 0.90) {
      return { level: 'NO-GO', label: '❌ RELEASE BLOCKED — QA lead sign-off required', colour: '#fff', bgColour: '#c0392b' };
    }
    if (regressions.length > 0 || passRate < 0.95) {
      return { level: 'CAUTION', label: '⚠️ PROCEED WITH CAUTION — QA sign-off required', colour: '#1a1a1a', bgColour: '#f39c12' };
    }
    return { level: 'GO', label: '✅ CLEAR TO RELEASE', colour: '#fff', bgColour: '#27ae60' };
  }

  // ── SVG Trend sparkline ────────────────────────────────────────────────────

  private buildSparkline(trend: Array<{ label: string; passRate: number }>): string {
    if (trend.length === 0) return '<p style="color:#888;font-size:13px;">No historical data yet.</p>';

    const W = 560, H = 80, pad = 10;
    const innerW = W - pad * 2;
    const innerH = H - pad * 2;
    const barW   = Math.min(60, Math.floor(innerW / trend.length) - 6);
    const gap    = Math.floor((innerW - barW * trend.length) / (trend.length + 1));

    const bars = trend.map((t, i) => {
      const barH   = Math.max(4, Math.round((t.passRate / 100) * innerH));
      const x      = pad + gap + i * (barW + gap);
      const y      = pad + innerH - barH;
      const colour = t.passRate >= 95 ? '#27ae60' : t.passRate >= 80 ? '#f39c12' : '#c0392b';
      return `
        <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${colour}" opacity="0.85"/>
        <text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" font-size="11" fill="${colour}" font-weight="600">${t.passRate}%</text>
        <text x="${x + barW / 2}" y="${H - 1}" text-anchor="middle" font-size="9" fill="#888">${esc(t.label)}</text>`;
    }).join('');

    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
  }

  // ── Main HTML generator ────────────────────────────────────────────────────

  generate(options: HtmlReportOptions = {}): string {
    const report   = this.reportService.getLatestReport();
    const failures = this.reportService.analyzeFailures();
    const trend    = this.getTrendData();
    const shots    = this.findScreenshots();

    // Load requirements data — returns nulls when missing (backwards compatible)
    const { coverage: reqCoverage, requirements: reqDoc } =
      this.loadRequirementsData(options.projectName, options.includeRequirements);

    if (!report) {
      throw new Error('No test report found. Run tests first.');
    }

    const verdict   = this.deriveVerdict(report, failures);
    const passRate  = report.totalTests > 0
      ? ((report.passed / report.totalTests) * 100).toFixed(1)
      : '0.0';
    const title     = options.title ?? 'CouponHive QA Report';
    const runDate   = formatTimestamp(report.timestamp);
    const duration  = formatDuration(report.duration);

    // Group failures by area
    const failuresByArea = new Map<string, Array<{ test: TestResult; analysis: FailureAnalysis; labelEntry: LabelEntry }>>();
    for (const analysis of failures) {
      const testResult  = report.tests.find(t => t.name === analysis.name);
      const labelEntry  = this.getLabel(analysis.name);
      const area        = labelEntry.area;
      if (!failuresByArea.has(area)) failuresByArea.set(area, []);
      failuresByArea.get(area)!.push({
        test: testResult ?? { name: analysis.name, status: 'failed', duration: 0, tags: [] },
        analysis,
        labelEntry
      });
    }

    // Group passed by area
    const passedByArea = new Map<string, Array<{ test: TestResult; labelEntry: LabelEntry }>>();
    for (const test of report.tests.filter(t => t.status === 'passed' || t.status === 'skipped')) {
      const labelEntry = this.getLabel(test.name);
      const area       = labelEntry.area;
      if (!passedByArea.has(area)) passedByArea.set(area, []);
      passedByArea.get(area)!.push({ test, labelEntry });
    }

    const sparkline = this.buildSparkline(trend);

    // ── Failure rows HTML ──────────────────────────────────────────────────
    let failureRows = '';
    if (failures.length === 0) {
      failureRows = `
        <tr>
          <td colspan="4" style="text-align:center;padding:24px;color:#27ae60;font-weight:600;font-size:15px;">
            ✅ No failures — all tests passed
          </td>
        </tr>`;
    } else {
      for (const [area, items] of failuresByArea) {
        failureRows += `
          <tr>
            <td colspan="4" style="background:#f8f0f0;padding:8px 16px;font-weight:700;
                color:#c0392b;font-size:12px;letter-spacing:.5px;text-transform:uppercase;border-top:2px solid #e8b4b4;">
              ${esc(area)} &nbsp;(${items.length})
            </td>
          </tr>`;
        for (const { analysis, labelEntry } of items) {
          const classIcon: Record<string, string> = {
            'regression':         '⚠️ Regression',
            'new-failure':        '🆕 New failure',
            'flaky':              '🔄 Flaky',
            'environment-issue':  '🌍 Environment'
          };
          const classLabel = classIcon[analysis.classification] ?? analysis.classification;
          const errorSnip  = analysis.error
            ? esc(cleanError(analysis.error).split('\n')[0]?.substring(0, 120) ?? '')
            : '—';
          failureRows += `
            <tr class="fail-row">
              <td style="padding:10px 16px;">
                <span style="font-weight:600;color:#1a1a1a;">${esc(labelEntry.label)}</span>
              </td>
              <td style="padding:10px 12px;white-space:nowrap;">
                <span class="badge badge-${analysis.classification}">${classLabel}</span>
              </td>
              <td style="padding:10px 12px;font-size:12px;color:#555;max-width:340px;word-break:break-word;">
                ${errorSnip}
              </td>
              <td style="padding:10px 12px;white-space:nowrap;font-size:12px;color:#888;">
                ${new Date(analysis.lastFailureTime).toLocaleDateString('en-GB')}
              </td>
            </tr>`;
        }
      }
    }

    // ── Passed rows HTML ───────────────────────────────────────────────────
    let passedRows = '';
    for (const [area, items] of passedByArea) {
      passedRows += `
        <tr>
          <td colspan="2" style="background:#f0f8f0;padding:6px 16px;font-weight:700;
              color:#27ae60;font-size:11px;letter-spacing:.5px;text-transform:uppercase;border-top:2px solid #b4d9b4;">
            ${esc(area)} &nbsp;(${items.length})
          </td>
        </tr>`;
      for (const { test, labelEntry } of items) {
        passedRows += `
          <tr class="pass-row">
            <td style="padding:7px 16px;font-size:13px;color:#333;">${esc(labelEntry.label)}</td>
            <td style="padding:7px 12px;font-size:12px;color:#888;white-space:nowrap;text-align:right;">
              ${formatTestDuration(test.duration)}
            </td>
          </tr>`;
      }
    }

    // ── Screenshot thumbnails ──────────────────────────────────────────────
    let screenshotHtml = '';
    if (shots.length > 0) {
      screenshotHtml = shots.map(f => {
        const nameClean = f.replace(/_\d{8}_\d{6}\.png$/i, '').replace(/_/g, ' ');
        return `
          <div style="display:inline-block;margin:6px;vertical-align:top;text-align:center;">
            <a href="${esc(f)}" target="_blank">
              <img src="${esc(f)}" alt="${esc(nameClean)}"
                style="width:160px;height:100px;object-fit:cover;border-radius:6px;
                       border:1px solid #ddd;box-shadow:0 2px 6px rgba(0,0,0,.1);"
                onerror="this.parentElement.parentElement.style.display='none'"/>
            </a>
            <div style="font-size:10px;color:#888;margin-top:4px;max-width:160px;
                        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(nameClean)}">
              ${esc(nameClean)}
            </div>
          </div>`;
      }).join('');
    } else {
      screenshotHtml = '<p style="color:#888;font-size:13px;">No screenshots found in reports directory.</p>';
    }

    // ── Coverage section ───────────────────────────────────────────────────
    let coverageHtml = '<p style="color:#888;font-size:13px;">Coverage analysis not included in this run.</p>';
    if (options.coverageText) {
      // Extract gap lines from the coverage text output
      const lines = options.coverageText.split('\n');
      const gapLines = lines.filter(l => l.includes('❌') && !l.includes('NO COVERAGE') && !l.includes('Total gaps'));
      const commitLines = lines.filter(l => l.trim().startsWith('Commit:'));
      const totalLine   = lines.find(l => l.includes('Total gaps found'));

      if (gapLines.length === 0) {
        coverageHtml = '<p style="color:#27ae60;font-weight:600;">✅ No coverage gaps found.</p>';
      } else {
        coverageHtml = `
          <p style="color:#e67e22;font-weight:600;margin-bottom:12px;">
            ${totalLine ? esc(totalLine.trim()) : `${gapLines.length} area(s) with no test coverage`}
          </p>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#fdf3e7;">
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#e67e22;border-bottom:1px solid #f0c080;">Area</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#e67e22;border-bottom:1px solid #f0c080;">Last Changed</th>
              </tr>
            </thead>
            <tbody>
              ${gapLines.map((line, i) => {
                const area    = line.replace('❌', '').trim();
                const commit  = commitLines[i] ? commitLines[i]!.replace('Commit:', '').trim() : '—';
                return `
                  <tr style="border-bottom:1px solid #fce8c8;">
                    <td style="padding:8px 12px;font-weight:600;color:#1a1a1a;font-size:13px;">${esc(area)}</td>
                    <td style="padding:8px 12px;font-size:12px;color:#888;">${esc(commit)}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>`;
      }
    }

    // ── Full HTML ──────────────────────────────────────────────────────────
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)} — ${esc(runDate)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f4f6f9;
      color: #1a1a1a;
      font-size: 14px;
      line-height: 1.5;
    }

    /* ── Header ── */
    .header {
      background: linear-gradient(135deg, #1a2744 0%, #2c3e6b 100%);
      color: #fff;
      padding: 28px 40px 24px;
    }
    .header h1 { font-size: 22px; font-weight: 700; letter-spacing: .3px; }
    .header .meta { font-size: 13px; color: #a8b8d8; margin-top: 4px; }

    /* ── Verdict banner ── */
    .verdict {
      padding: 16px 40px;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: .3px;
      color: ${verdict.colour};
      background: ${verdict.bgColour};
    }

    /* ── Content wrapper ── */
    .content { max-width: 1100px; margin: 0 auto; padding: 24px 32px; }

    /* ── Section ── */
    .section {
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,.08);
      margin-bottom: 20px;
      overflow: hidden;
    }
    .section-header {
      padding: 14px 20px;
      border-bottom: 1px solid #eef0f4;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .5px;
      text-transform: uppercase;
      color: #4a5568;
      background: #fafbfc;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-body { padding: 20px; }

    /* ── Summary cards ── */
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 14px;
    }
    .card {
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,.08);
      padding: 18px 16px;
      text-align: center;
    }
    .card-value { font-size: 32px; font-weight: 800; line-height: 1; }
    .card-label { font-size: 11px; color: #888; text-transform: uppercase; margin-top: 6px; letter-spacing: .5px; }
    .card-green  .card-value { color: #27ae60; }
    .card-red    .card-value { color: #c0392b; }
    .card-amber  .card-value { color: #e67e22; }
    .card-blue   .card-value { color: #2980b9; }
    .card-grey   .card-value { color: #7f8c8d; }

    /* ── Tables ── */
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #f7f8fa; }
    th { padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 700;
         letter-spacing: .5px; text-transform: uppercase; color: #666;
         border-bottom: 2px solid #eef0f4; }
    td { border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    .fail-row:hover { background: #fff8f8; }
    .pass-row:hover { background: #f8fff8; }

    /* ── Classification badges ── */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge-regression       { background: #fde8e8; color: #c0392b; }
    .badge-new-failure      { background: #f8e8f8; color: #8e44ad; }
    .badge-flaky            { background: #fef3e2; color: #e67e22; }
    .badge-environment-issue{ background: #e8f4fd; color: #2980b9; }

    /* ── Collapsible passed section ── */
    details > summary {
      cursor: pointer;
      padding: 14px 20px;
      border-bottom: 1px solid #eef0f4;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .5px;
      text-transform: uppercase;
      color: #4a5568;
      background: #fafbfc;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 8px;
      user-select: none;
    }
    details > summary::-webkit-details-marker { display: none; }
    details > summary::before {
      content: '▶';
      font-size: 10px;
      transition: transform .15s;
    }
    details[open] > summary::before { transform: rotate(90deg); }

    /* ── Print button ── */
    .print-bar {
      text-align: right;
      margin-bottom: 16px;
    }
    .print-btn {
      background: #2c3e6b;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 9px 20px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: .3px;
    }
    .print-btn:hover { background: #1a2744; }

    /* ── Footer ── */
    .footer {
      text-align: center;
      padding: 20px;
      font-size: 11px;
      color: #aaa;
    }

    /* ── Requirements traceability ── */
    .req-summary-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 14px; }
    .progress-track { height: 12px; background: #eef0f4; border-radius: 6px; overflow: hidden; }
    .progress-fill  { height: 100%; border-radius: 6px; transition: width .4s; }
    .req-table th   { background: #f7f8fa; }
    .req-id         { font-family: monospace; font-size: 12px; font-weight: 700; color: #2c3e6b;
                      background: #eef2ff; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
    .priority-high  { background: #fde8e8; color: #c0392b; }
    .priority-medium{ background: #fef3e2; color: #e67e22; }
    .priority-low   { background: #e8f8f0; color: #27ae60; }
    .status-passed  { background: #e8f8f0; color: #27ae60; }
    .status-failed  { background: #fde8e8; color: #c0392b; }
    .status-notest  { background: #fdf3e7; color: #e67e22; }
    .status-notrun  { background: #f0f0f0; color: #888; }
    .row-failed     { background: #fff8f8; }
    .row-notest     { background: #fffbf5; }
    .req-failure-card { background: #fff; border: 1px solid #f0b4b4; border-radius: 8px;
                        padding: 16px; margin-bottom: 12px; position: relative; }
    .req-notest-card  { background: #fffbf5; border: 1px solid #f5d87a; border-radius: 8px;
                        padding: 14px; margin-bottom: 10px; }
    .impact-block   { position: absolute; top: 12px; right: 12px; background: #c0392b;
                      color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px;
                      border-radius: 4px; letter-spacing: .3px; }

    /* ── Print styles ── */
    @media print {
      body { background: #fff; }
      .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .verdict { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-bar { display: none; }
      .section { box-shadow: none; border: 1px solid #eee; page-break-inside: avoid; }
      details[open] .pass-table { display: table !important; }
    }
  </style>
</head>
<body>

<!-- ── Header ──────────────────────────────────────────────────────── -->
<div class="header">
  <h1>${esc(title)}</h1>
  <div class="meta">
    Run: ${esc(runDate)} &nbsp;|&nbsp;
    Duration: ${esc(duration)} &nbsp;|&nbsp;
    Environment: ${esc(report.environment ?? 'development')}
  </div>
</div>

<!-- ── Verdict banner ──────────────────────────────────────────────── -->
<div class="verdict">${verdict.label}</div>

<!-- ── Content ─────────────────────────────────────────────────────── -->
<div class="content">

  <!-- Print button -->
  <div class="print-bar">
    <button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
  </div>

  <!-- ── Summary cards ───────────────────────────────────────────── -->
  <div class="cards" style="margin-bottom:20px;">
    <div class="card card-blue">
      <div class="card-value">${report.totalTests}</div>
      <div class="card-label">Total Tests</div>
    </div>
    <div class="card card-green">
      <div class="card-value">${report.passed}</div>
      <div class="card-label">Passed</div>
    </div>
    <div class="card card-red">
      <div class="card-value">${report.failed}</div>
      <div class="card-label">Failed</div>
    </div>
    <div class="card card-amber">
      <div class="card-value">${report.skipped}</div>
      <div class="card-label">Skipped</div>
    </div>
    <div class="card ${Number(passRate) >= 95 ? 'card-green' : Number(passRate) >= 80 ? 'card-amber' : 'card-red'}">
      <div class="card-value">${passRate}%</div>
      <div class="card-label">Pass Rate</div>
    </div>
    <div class="card card-grey">
      <div class="card-value" style="font-size:22px;">${esc(duration)}</div>
      <div class="card-label">Duration</div>
    </div>
  </div>

  <!-- ── Trend ────────────────────────────────────────────────────── -->
  ${trend.length > 1 ? `
  <div class="section">
    <div class="section-header">📈 Pass Rate Trend (last ${trend.length} runs)</div>
    <div class="section-body" style="overflow-x:auto;">
      ${sparkline}
    </div>
  </div>` : ''}

  ${reqCoverage ? this.buildRequirementsHtml(reqCoverage, reqDoc) : ''}

  <!-- ── Failures ─────────────────────────────────────────────────── -->
  <div class="section">
    <div class="section-header">
      ❌ Failures
      <span style="margin-left:auto;font-size:12px;font-weight:400;color:#c0392b;">
        ${failures.length > 0 ? `${failures.length} test${failures.length > 1 ? 's' : ''} failed` : 'None'}
      </span>
    </div>
    <div class="section-body" style="padding:0;">
      <table>
        <thead>
          <tr>
            <th>Test</th>
            <th>Classification</th>
            <th>Error</th>
            <th>Last Failed</th>
          </tr>
        </thead>
        <tbody>${failureRows}</tbody>
      </table>
    </div>
  </div>

  <!-- ── Screenshots ──────────────────────────────────────────────── -->
  ${shots.length > 0 ? `
  <div class="section">
    <div class="section-header">📸 Failure Screenshots (${shots.length})</div>
    <div class="section-body">
      ${screenshotHtml}
    </div>
  </div>` : ''}

  <!-- ── Coverage gaps ────────────────────────────────────────────── -->
  <div class="section">
    <div class="section-header">⚠️ Test Coverage Gaps</div>
    <div class="section-body">
      ${coverageHtml}
    </div>
  </div>

  <!-- ── Passed tests (collapsed) ─────────────────────────────────── -->
  <div class="section">
    <details>
      <summary>
        ✅ Passed Tests
        <span style="margin-left:auto;font-size:12px;font-weight:400;color:#27ae60;">
          ${report.passed} test${report.passed !== 1 ? 's' : ''} — click to expand
        </span>
      </summary>
      <div>
        <table class="pass-table">
          <thead>
            <tr>
              <th>Test</th>
              <th style="text-align:right;">Duration</th>
            </tr>
          </thead>
          <tbody>${passedRows}</tbody>
        </table>
      </div>
    </details>
  </div>

</div><!-- /content -->

<div class="footer">
  Generated by qa-mcp-server &nbsp;|&nbsp; ${esc(runDate)} &nbsp;|&nbsp;
  Report ID: ${esc(report.id)}
</div>

</body>
</html>`;
  }

  // ── Write to file ──────────────────────────────────────────────────────────

  generateAndSave(options: HtmlReportOptions = {}): string {
    const html = this.generate(options);

    const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const outputPath = options.outputPath
      ?? path.join(this.reportsDir, `report-${timestamp}.html`);

    fs.writeFileSync(outputPath, html, 'utf-8');

    if (options.openInBrowser) {
      this.openInBrowser(outputPath);
    }

    return outputPath;
  }

  private openInBrowser(filePath: string): void {
    try {
      const { execSync } = require('child_process') as typeof import('child_process');
      const url          = `file:///${filePath.replace(/\\/g, '/')}`;
      const cmd = process.platform === 'win32'  ? `start "" "${url}"` :
                  process.platform === 'darwin' ? `open "${url}"`     :
                  `xdg-open "${url}"`;
      execSync(cmd, { stdio: 'ignore' });
    } catch {
      // silently ignore — file is still saved
    }
  }
}
