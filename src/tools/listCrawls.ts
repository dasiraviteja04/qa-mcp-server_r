/**
 * MCP Tool: list_crawls
 *
 * Reads all files in memory/crawls/ and returns a summary list:
 *   projectName | crawledAt | url | elementCount
 *
 * Use this before crawl_page to see if a crawl already exists, or
 * before scaffold_project to confirm crawl data is available.
 */

import { LiveCrawlerService } from '../services/liveCrawler.service.js';
import type { ToolOutput }    from '../types/mcp.types.js';

export async function listCrawls(_input?: unknown): Promise<ToolOutput> {
  try {
    const service = new LiveCrawlerService();
    const crawls  = service.listCrawls();

    if (crawls.length === 0) {
      return {
        content: [{
          type: 'text',
          text: [
            `📂 No page crawls saved yet.`,
            ``,
            `To crawl your first page, run:`,
            `  crawl_page({`,
            `    project_name:   "BillingPortal",`,
            `    url:            "https://your-app.com/billing",`,
            `    blueprint_name: "CouponHive"   // optional — generates Page.cs`,
            `  })`,
          ].join('\n'),
        }],
      };
    }

    const lines: string[] = [
      `🌐 Saved Page Crawls (${crawls.length})`,
      ``,
    ];

    for (const c of crawls) {
      const crawledDate = new Date(c.crawledAt).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      lines.push(`  ┌─ "${c.projectName}"`);
      lines.push(`  │  Crawled    : ${crawledDate}`);
      lines.push(`  │  URL        : ${c.url}`);
      lines.push(`  │  Elements   : ${c.elementCount}`);
      lines.push(`  └─ Use with → get_crawl({ project_name: "${c.projectName}" })`);
      lines.push('');
    }

    lines.push(`💡 Tip: Run crawl_page again to refresh a crawl after the page changes.`);
    lines.push(`        scaffold_project will auto-use crawl selectors when building Page.cs.`);

    return { content: [{ type: 'text', text: lines.join('\n') }] };

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `❌ list_crawls failed: ${msg}` }],
      isError: true,
    };
  }
}
