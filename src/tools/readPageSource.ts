/**
 * read_page_source MCP tool
 *
 * Launches a headless Chromium browser, navigates to the given URL
 * (using saved auth state if available), and returns only the interactive
 * elements on the page.
 *
 * Why interactive elements only?
 *   Full page HTML is large and noisy.  For writing accurate C# page-object
 *   locators (GetByRole, GetByLabel, Locator) we only need inputs, buttons,
 *   selects, links and their associated labels / attributes.
 *
 * The tool returns a compact, structured list that Claude can use directly
 * to write PlaywrightPage.cs locator properties.
 */

import { PageCrawlerService } from '../services/pagecrawler.service.js';
import type { ToolOutput } from '../types/mcp.types.js';

interface ReadPageSourceInput {
  url: string;
  stateFile?: string;   // explicit path to Playwright state.json (optional)
}

export async function readPageSource(input: ReadPageSourceInput): Promise<ToolOutput> {
  if (!input.url) {
    return {
      content: [{ type: 'text', text: 'Error: url is required' }],
      isError: true
    };
  }

  const service = new PageCrawlerService();

  const pageSource = await service.crawlPage(input.url, input.stateFile);

  if (pageSource.elements.length === 0) {
    return {
      content: [{
        type: 'text',
        text: [
          `## Page Source — ${pageSource.url}`,
          `**Title:** ${pageSource.title}`,
          `**Auth:** ${pageSource.authenticated ? `Yes (${pageSource.stateFileUsed})` : 'No (anonymous)'}`,
          `**Crawled:** ${pageSource.crawledAt}`,
          '',
          'No interactive elements found.  The page may require additional login steps',
          'or the content may be rendered entirely client-side after a longer delay.'
        ].join('\n')
      }]
    };
  }

  const lines: string[] = [
    `## Page Source — ${pageSource.url}`,
    `**Title:** ${pageSource.title}`,
    `**Auth:** ${pageSource.authenticated ? `Yes (${pageSource.stateFileUsed})` : 'No (anonymous)'}`,
    `**Crawled:** ${pageSource.crawledAt}`,
    `**Interactive elements found:** ${pageSource.elements.length}`,
    ''
  ];

  // Group by element type for readability
  const groups = new Map<string, typeof pageSource.elements>();
  for (const el of pageSource.elements) {
    const group = el.type ? `${el.tag}[type=${el.type}]` : el.tag;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(el);
  }

  for (const [group, els] of groups) {
    lines.push(`### ${group} (${els.length})`);
    lines.push('');
    lines.push('| Selector | Label | Placeholder | AriaLabel | DataTestId | Text |');
    lines.push('|----------|-------|-------------|-----------|------------|------|');
    for (const el of els) {
      const safeText = (el.text ?? '').replace(/\|/g, '\\|').substring(0, 50);
      lines.push(
        `| \`${el.selector}\` | ${el.label ?? ''} | ${el.placeholder ?? ''} | ${el.ariaLabel ?? ''} | ${el.dataTestId ?? ''} | ${safeText} |`
      );
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('**Usage:** Use these selectors and labels to write C# Playwright page-object locators.');
  lines.push('Prefer `GetByLabel()` for form fields, `GetByRole()` for buttons, `Locator()` with data-testid for dynamic elements.');

  return {
    content: [{ type: 'text', text: lines.join('\n') }]
  };
}
