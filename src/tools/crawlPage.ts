/**
 * MCP Tool: crawl_page
 *
 * Opens a real Chromium browser, crawls every interactive UI element on a
 * page, saves a structured crawl JSON to memory/crawls/, and optionally
 * generates a pre-filled C# Page Object .cs file from a framework blueprint.
 *
 * Steps:
 *   1. Launch headless Chromium → navigate to URL (networkidle)
 *   2. Handle login if credentials supplied
 *   3. Discover & classify all buttons / inputs / dropdowns / tables /
 *      links / modals + special UI patterns
 *   4. Save memory/crawls/{project_name}-crawl.json
 *   5. Generate {ProjectName}Page.cs from blueprint (if blueprint_name given)
 *   6. Return structured summary
 */

import { LiveCrawlerService }   from '../services/liveCrawler.service.js';
import type { CrawlPageInput }  from '../types/crawl.types.js';
import type { ToolOutput }      from '../types/mcp.types.js';

export async function crawlPage(input: CrawlPageInput): Promise<ToolOutput> {
  try {
    if (!input.project_name?.trim()) {
      return { content: [{ type: 'text', text: '❌ project_name is required.' }], isError: true };
    }
    if (!input.url?.trim()) {
      return { content: [{ type: 'text', text: '❌ url is required.' }], isError: true };
    }

    const service = new LiveCrawlerService();
    const { crawl, crawlPath, pageObjectPath } = await service.run(input);

    const el = crawl.elements;

    // Count unstable selectors across all categories
    const allElements = [
      ...el.buttons, ...el.inputs, ...el.dropdowns,
      ...el.tables, ...el.links, ...el.modals,
    ];
    const unstableCount = allElements.filter(e => e.selectorStability === 'unstable').length;

    const warnings: string[] = [];
    if (unstableCount > 0) {
      warnings.push(
        `⚠️  ${unstableCount} selector${unstableCount > 1 ? 's use' : ' uses'} CSS class only — ` +
        `recommend adding data-testid to those elements.`
      );
    }
    if (!input.blueprint_name) {
      warnings.push(
        `💡 No blueprint_name supplied — Page Object not generated. ` +
        `Pass blueprint_name to auto-generate ${input.project_name}Page.cs.`
      );
    }

    // ── Special patterns block ────────────────────────────────────────────
    const sp = el.specialPatterns;
    const spLines: string[] = [];
    if (sp.hasPagination)     spLines.push('    • Pagination controls detected');
    if (sp.hasInfiniteScroll) spLines.push('    • Infinite scroll detected');
    if (sp.hasFileUpload)     spLines.push('    • File upload input detected');
    if (sp.hasDatePicker)     spLines.push('    • Date picker detected');
    if (sp.hasRichTextEditor) spLines.push('    • Rich text editor detected');

    const lines: string[] = [
      `✅ Crawl complete — "${crawl.projectName}"`,
      ``,
      `🌐 URL        : ${crawl.url}`,
      `🕐 Crawled at : ${new Date(crawl.crawledAt).toLocaleString()}`,
      `🔐 Login used : ${crawl.loginRequired ? 'Yes' : 'No'}`,
      ``,
      `📦 Elements discovered:`,
      `   Buttons    : ${el.buttons.length}`,
      `   Inputs     : ${el.inputs.length}`,
      `   Dropdowns  : ${el.dropdowns.length}`,
      `   Tables     : ${el.tables.length}`,
      `   Links      : ${el.links.length}`,
      `   Modals     : ${el.modals.length}`,
      `   ─────────────────────────────────`,
      `   Total      : ${allElements.length}`,
      `   Unstable selectors : ${unstableCount}`,
    ];

    if (spLines.length > 0) {
      lines.push('');
      lines.push('🔎 Special UI patterns:');
      lines.push(...spLines);
    }

    lines.push('');
    lines.push(`💾 Crawl saved : ${crawlPath}`);

    if (pageObjectPath) {
      lines.push(`📄 Page object : ${pageObjectPath}`);
      lines.push(`   → ${crawl.projectName}Page.cs generated with real selectors from this crawl.`);
    }

    if (warnings.length > 0) {
      lines.push('');
      lines.push('⚠️  Warnings:');
      warnings.forEach(w => lines.push(`   ${w}`));
    }

    // ── Selector preview (first few buttons/inputs) ───────────────────────
    if (el.buttons.length > 0 || el.inputs.length > 0) {
      lines.push('');
      lines.push('🔍 Selector preview:');

      if (el.inputs.length > 0) {
        lines.push('  Inputs:');
        el.inputs.slice(0, 4).forEach(i => {
          const label = i.labelText || i.inputType;
          const flag  = i.selectorStability === 'unstable' ? ' ⚠️' : '';
          lines.push(`    [${label}]  →  ${i.bestSelector}${flag}`);
        });
      }
      if (el.buttons.length > 0) {
        lines.push('  Buttons:');
        el.buttons.slice(0, 5).forEach(b => {
          const flag = b.selectorStability === 'unstable' ? ' ⚠️' : '';
          lines.push(`    ["${b.visibleText}"]  →  ${b.bestSelector}${flag}`);
        });
      }
      if (el.tables.length > 0) {
        lines.push('  Tables:');
        el.tables.slice(0, 2).forEach(t => {
          const hdrs = t.columnHeaders.length > 0 ? t.columnHeaders.join(', ') : '(no headers found)';
          lines.push(`    ${t.bestSelector}  →  [${hdrs}]`);
        });
      }
    }

    lines.push('');
    lines.push('💡 Next steps:');
    lines.push(`   • get_crawl({ project_name: "${crawl.projectName}" })       — retrieve full crawl JSON`);
    lines.push(`   • scaffold_project({ blueprint_name: "...", new_project_name: "${crawl.projectName}", output_path: "..." })`);
    lines.push(`     → will automatically use crawl selectors when generating ${crawl.projectName}Page.cs`);

    return { content: [{ type: 'text', text: lines.join('\n') }] };

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `❌ crawl_page failed: ${msg}` }],
      isError: true,
    };
  }
}
