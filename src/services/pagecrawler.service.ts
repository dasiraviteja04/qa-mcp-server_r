/**
 * PageCrawlerService — launches a Playwright browser, navigates to a URL,
 * and returns only the interactive elements on the page.
 *
 * Why interactive elements only?
 *   Page HTML is ~100 KB.  Feeding the full DOM to Claude wastes context.
 *   Inputs, buttons, selects, links, and labelled regions are what matter
 *   for writing accurate page-object locators.
 *
 * Authentication:
 *   The C# framework uses Playwright state.json files (saved browser storage)
 *   to authenticate.  This service looks for those same files so it can
 *   browse authenticated pages without re-logging-in.
 *
 *   State files are resolved in this order:
 *     1. Explicit stateFile argument passed to crawlPage()
 *     2. <projectRoot>/state.json
 *     3. <projectRoot>/playwright/.auth/<env>.json
 *     4. Unauthenticated (anonymous browser)
 */

import * as fs from 'fs';
import * as path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { getEnvironmentConfig } from '../config/environments.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface InteractiveElement {
  tag: string;                  // input, button, select, a, textarea, ...
  type?: string;                // input type attribute (text, password, checkbox, ...)
  id?: string;
  name?: string;
  placeholder?: string;
  label?: string;               // text of <label for="..."> or aria-label
  dataTestId?: string;          // data-testid / data-test / data-qa attribute
  ariaLabel?: string;
  text?: string;                // visible inner text (buttons, links, etc.)
  selector: string;             // best CSS / attribute selector for this element
}

export interface PageSource {
  url: string;
  title: string;
  elements: InteractiveElement[];
  crawledAt: string;
  authenticated: boolean;
  stateFileUsed?: string;
}

// ---------------------------------------------------------------------------
// PageCrawlerService
// ---------------------------------------------------------------------------

export class PageCrawlerService {

  async crawlPage(url: string, stateFile?: string): Promise<PageSource> {
    const resolvedState = stateFile ?? this.resolveStateFile();
    const authenticated = !!(resolvedState && fs.existsSync(resolvedState));

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      browser = await chromium.launch({ headless: true });

      context = authenticated
        ? await browser.newContext({ storageState: resolvedState! })
        : await browser.newContext();

      const page = await context.newPage();

      // Navigate with a reasonable timeout
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Let dynamic content settle
      await page.waitForTimeout(1500);

      const title = await page.title();
      const elements = await this.extractInteractiveElements(page);

      return {
        url,
        title,
        elements,
        crawledAt: new Date().toISOString(),
        authenticated,
        ...(authenticated && resolvedState ? { stateFileUsed: resolvedState } : {})
      };
    } finally {
      if (context) await context.close();
      if (browser) await browser.close();
    }
  }

  // -------------------------------------------------------------------------
  // Element extraction (runs inside the browser via page.evaluate)
  // -------------------------------------------------------------------------

  private async extractInteractiveElements(page: Page): Promise<InteractiveElement[]> {
    return page.evaluate(() => {
      const results: any[] = [];

      // Collect <label> elements for later lookup
      const labelsByFor = new Map<string, string>();
      document.querySelectorAll<HTMLLabelElement>('label').forEach(lbl => {
        if (lbl.htmlFor) {
          labelsByFor.set(lbl.htmlFor, lbl.textContent?.trim() ?? '');
        }
      });

      const SELECTORS = [
        'input:not([type="hidden"])',
        'button',
        'select',
        'textarea',
        'a[href]',
        '[role="button"]',
        '[role="combobox"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="textbox"]',
        '[role="listbox"]',
        '[contenteditable="true"]'
      ].join(',');

      document.querySelectorAll<HTMLElement>(SELECTORS).forEach(el => {
        const tag = el.tagName.toLowerCase();
        const id = el.id || undefined;
        const name = (el as HTMLInputElement).name || undefined;
        const type = (el as HTMLInputElement).type || undefined;
        const placeholder = (el as HTMLInputElement).placeholder || undefined;
        const ariaLabel = el.getAttribute('aria-label') || undefined;
        const dataTestId =
          el.getAttribute('data-testid') ||
          el.getAttribute('data-test') ||
          el.getAttribute('data-qa') ||
          undefined;
        const labelText = id ? labelsByFor.get(id) : undefined;
        const text = (el.textContent?.trim().substring(0, 80)) || undefined;

        // Build the most stable selector we can
        let selector = tag;
        if (dataTestId) {
          selector = `[data-testid="${dataTestId}"]`;
        } else if (id) {
          selector = `#${id}`;
        } else if (name) {
          selector = `${tag}[name="${name}"]`;
        } else if (ariaLabel) {
          selector = `[aria-label="${ariaLabel}"]`;
        } else if (placeholder) {
          selector = `${tag}[placeholder="${placeholder}"]`;
        } else if (text && (tag === 'button' || tag === 'a')) {
          selector = `${tag}:has-text("${text.substring(0, 40)}")`;
        }

        results.push({
          tag,
          ...(type        ? { type }        : {}),
          ...(id          ? { id }          : {}),
          ...(name        ? { name }        : {}),
          ...(placeholder ? { placeholder } : {}),
          ...(labelText   ? { label: labelText }  : {}),
          ...(dataTestId  ? { dataTestId }  : {}),
          ...(ariaLabel   ? { ariaLabel }   : {}),
          ...(text        ? { text }        : {}),
          selector
        });
      });

      return results;
    });
  }

  // -------------------------------------------------------------------------
  // State file resolution
  // -------------------------------------------------------------------------

  private resolveStateFile(): string | null {
    const config = getEnvironmentConfig();
    const root = config.playwrightProjectRoot;

    const candidates = [
      path.join(root, 'state.json'),
      path.join(root, 'playwright', '.auth', `${config.testEnvironment}.json`),
      path.join(root, 'playwright', '.auth', 'state.json'),
      path.join(root, '.auth', 'state.json')
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }
}
