/**
 * MCP Tool: get_crawl
 *
 * Reads the saved crawl JSON for a given project from
 * memory/crawls/{project_name}-crawl.json and returns the full structured
 * result.  Used by scaffold_project internally to auto-fill selectors.
 */

import { LiveCrawlerService } from '../services/liveCrawler.service.js';
import type { ToolOutput }    from '../types/mcp.types.js';

interface GetCrawlInput {
  project_name: string;
}

export async function getCrawl(input: GetCrawlInput): Promise<ToolOutput> {
  try {
    if (!input.project_name?.trim()) {
      return { content: [{ type: 'text', text: '❌ project_name is required.' }], isError: true };
    }

    const service = new LiveCrawlerService();
    const crawl   = service.loadCrawl(input.project_name.trim());
    const el      = crawl.elements;

    const allCount = (
      el.buttons.length + el.inputs.length + el.dropdowns.length +
      el.tables.length  + el.links.length  + el.modals.length
    );
    const unstable = [
      ...el.buttons, ...el.inputs, ...el.dropdowns,
      ...el.tables,  ...el.links,  ...el.modals,
    ].filter(e => e.selectorStability === 'unstable').length;

    const lines: string[] = [
      `📋 Crawl for "${crawl.projectName}"`,
      ``,
      `🌐 URL        : ${crawl.url}`,
      `🕐 Crawled at : ${new Date(crawl.crawledAt).toLocaleString()}`,
      `🔐 Login used : ${crawl.loginRequired ? 'Yes' : 'No'}`,
      `📦 Total elements : ${allCount}  (${unstable} unstable)`,
      ``,
      `── RAW JSON ──────────────────────────────────────────────────────────────`,
      JSON.stringify(crawl, null, 2),
    ];

    return { content: [{ type: 'text', text: lines.join('\n') }] };

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `❌ get_crawl failed: ${msg}` }],
      isError: true,
    };
  }
}
