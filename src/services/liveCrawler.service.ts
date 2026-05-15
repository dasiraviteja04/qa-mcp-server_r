/**
 * LiveCrawlerService
 *
 * Opens a real Chromium browser, navigates to a URL, discovers every
 * interactive UI element, classifies each one with a best-selector and
 * stability rating, persists the result as a structured JSON crawl, and
 * optionally generates a pre-filled C# Page Object .cs file from a
 * framework blueprint.
 *
 * Separate from the lightweight PageCrawlerService used by read_page_source.
 * This service is used exclusively by crawl_page.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type {
  CrawlPageInput, PageCrawl, CrawlElements,
  CrawlButton, CrawlInput, CrawlDropdown,
  CrawlTable, CrawlLink, CrawlModal,
  CrawlSummary, LoginOptions,
  RawCrawlResult,
} from '../types/crawl.types.js';
import type { FrameworkBlueprint } from '../types/framework.types.js';
import { FrameworkMemoryService } from './frameworkMemory.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function serverRoot(): string {
  return path.join(__dirname, '..', '..');
}
function crawlsDir(): string {
  return path.join(serverRoot(), 'memory', 'crawls');
}
function outputDir(projectName: string): string {
  return path.join(serverRoot(), 'output', projectName);
}

// ---------------------------------------------------------------------------
// Shared text utilities (Node-side only)
// ---------------------------------------------------------------------------

/** Convert any display text or kebab/snake identifier to PascalCase. */
function toPascalCase(str: string): string {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => (w[0]?.toUpperCase() ?? '') + w.slice(1).toLowerCase())
    .join('');
}

/** C# property name: PascalCase + suffix, never duplicate the suffix. */
function toPropertyName(text: string, suffix: string): string {
  const base = toPascalCase(text.trim()) || `Unknown`;
  return base.endsWith(suffix) ? base : base + suffix;
}

/** C# method parameter name from type name. */
function paramName(typeName: string): string {
  const map: Record<string, string> = {
    IPage:             'page',
    ScenarioContext:   'scenarioContext',
    IObjectContainer:  'objectContainer',
    ITestOutputHelper: 'output',
  };
  return map[typeName] ?? typeName.charAt(0).toLowerCase() + typeName.slice(1);
}

/** Infer a one-line purpose string from button visible text. */
function guessButtonPurpose(text: string): string {
  const t = text.toLowerCase();
  if (/save|submit/.test(t))             return 'save or submit form data';
  if (/cancel|close|dismiss/.test(t))    return 'dismiss or cancel action';
  if (/delete|remove/.test(t))           return 'delete or remove a record';
  if (/edit|update|modify/.test(t))      return 'open edit mode';
  if (/add|create|new/.test(t))          return 'create a new record';
  if (/search|find|look/.test(t))        return 'trigger a search';
  if (/export|download/.test(t))         return 'export or download data';
  if (/import|upload/.test(t))           return 'import or upload data';
  if (/login|sign.?in|log.?in/.test(t))  return 'authenticate user';
  if (/logout|sign.?out/.test(t))        return 'end user session';
  if (/next|continue|forward/.test(t))   return 'navigate to next step';
  if (/prev|back/.test(t))               return 'navigate to previous step';
  if (/confirm|yes|ok/.test(t))          return 'confirm action';
  if (/refresh|reload/.test(t))          return 'refresh page data';
  if (/filter|sort/.test(t))             return 'filter or sort results';
  if (/print/.test(t))                   return 'print or export to PDF';
  if (/approve|reject/.test(t))          return 'approve or reject a record';
  return `perform "${text}" action`;
}

// ---------------------------------------------------------------------------
// LiveCrawlerService
// ---------------------------------------------------------------------------

export class LiveCrawlerService {

  // ── Public entry point ────────────────────────────────────────────────────

  async run(input: CrawlPageInput): Promise<{
    crawl: PageCrawl;
    crawlPath: string;
    pageObjectPath: string | null;
  }> {
    fs.mkdirSync(crawlsDir(), { recursive: true });

    let browser: Browser | null  = null;
    let context: BrowserContext | null = null;

    try {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                   'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                   'Chrome/120.0.0.0 Safari/537.36'
      });
      const page = await context.newPage();

      // ── STEP 1: Navigate ────────────────────────────────────────────────
      try {
        await page.goto(input.url, { waitUntil: 'networkidle', timeout: 30_000 });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Navigation failed for "${input.url}": ${msg}`);
      }

      // ── STEP 2: Login ────────────────────────────────────────────────────
      let loginRequired = false;
      if (input.login) {
        const pwdCount = await page.locator('input[type="password"]').count();
        if (pwdCount > 0) {
          loginRequired = true;
          await this.performLogin(page, input.login);
        }
      }

      // Short settle after navigation/login
      await page.waitForTimeout(800);

      // ── STEP 3: Discover elements ────────────────────────────────────────
      const raw = await this.extractElements(page);
      const elements = this.toTypedElements(raw);

      // ── STEP 4: Build + save crawl JSON ──────────────────────────────────
      const crawl: PageCrawl = {
        projectName:   input.project_name,
        url:           input.url,
        crawledAt:     new Date().toISOString(),
        loginRequired,
        elements,
      };

      const crawlPath = path.join(crawlsDir(), `${input.project_name}-crawl.json`);
      const tmp       = crawlPath + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(crawl, null, 2), 'utf-8');
      await fs.promises.rename(tmp, crawlPath);

      // ── STEP 5: Generate Page Object (optional) ──────────────────────────
      let pageObjectPath: string | null = null;
      if (input.blueprint_name) {
        pageObjectPath = await this.generatePageObject(crawl, input.blueprint_name);
      }

      return { crawl, crawlPath, pageObjectPath };

    } finally {
      if (context) await context.close().catch(() => undefined);
      if (browser) await browser.close().catch(() => undefined);
    }
  }

  // ── Login handler ─────────────────────────────────────────────────────────

  private async performLogin(page: Page, login: LoginOptions): Promise<void> {
    const password = process.env[login.password_env_key];
    if (!password) {
      throw new Error(
        `Environment variable "${login.password_env_key}" is not set — cannot fill password.`
      );
    }

    // Find username / email field
    const userSelectors = [
      'input[type="email"]',
      'input[name="username"]',
      'input[name="email"]',
      'input[name="login"]',
      'input[id*="email" i]',
      'input[id*="user" i]',
      'input[placeholder*="email" i]',
      'input[placeholder*="username" i]',
      'input[type="text"]:first-of-type',
    ];
    let filledUser = false;
    for (const sel of userSelectors) {
      if (await page.locator(sel).count() > 0) {
        await page.locator(sel).first().fill(login.username);
        filledUser = true;
        break;
      }
    }
    if (!filledUser) {
      throw new Error('Login failed: could not find a username / email input field.');
    }

    // Fill password
    await page.locator('input[type="password"]').first().fill(password);

    // Find + click submit
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Log in")',
      'button:has-text("Sign in")',
      'button:has-text("Continue")',
      'button:has-text("Next")',
    ];
    let clicked = false;
    for (const sel of submitSelectors) {
      if (await page.locator(sel).count() > 0) {
        await page.locator(sel).first().click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      throw new Error('Login failed: could not find a submit / login button.');
    }

    // Wait for navigation (SPA or full-page)
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15_000 });
    } catch {
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    }

    // Verify login succeeded
    if (await page.locator('input[type="password"]').count() > 0) {
      throw new Error('Login appears to have failed — password field is still visible after submit.');
    }
  }

  // ── Element extraction (runs inside Chromium via page.evaluate) ────────────

  private async extractElements(page: Page): Promise<RawCrawlResult> {
    return page.evaluate((): RawCrawlResult => {

      // ── Selector builder ─────────────────────────────────────────────────
      function bestSel(el: Element): { selector: string; stable: boolean } {
        // 1. data-testid / data-test / data-cy / data-qa / data-automation
        const testId =
          el.getAttribute('data-testid') ??
          el.getAttribute('data-test-id') ??
          el.getAttribute('data-test') ??
          el.getAttribute('data-cy') ??
          el.getAttribute('data-qa') ??
          el.getAttribute('data-automation');
        if (testId) return { selector: `[data-testid='${testId}']`, stable: true };

        // 2. aria-label (short enough to be meaningful)
        const aria = el.getAttribute('aria-label');
        if (aria && aria.length > 0 && aria.length < 80) {
          return { selector: `[aria-label='${aria}']`, stable: true };
        }

        // 3. Non-generated id
        const id = el.getAttribute('id');
        if (
          id && id.length > 0 && id.length < 60 &&
          !/^\d/.test(id) &&
          !/^[a-f0-9]{8}-[a-f0-9]{4}/.test(id) &&
          !/\d{6,}/.test(id)
        ) {
          return { selector: `#${id}`, stable: true };
        }

        // 4. name attribute (forms)
        const name = el.getAttribute('name');
        if (name && name.length < 60) {
          return { selector: `[name='${name}']`, stable: true };
        }

        // 5. For buttons / role=button — use visible text
        const tag = el.tagName.toLowerCase();
        if (tag === 'button' || el.getAttribute('role') === 'button') {
          const txt = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
          if (txt.length > 0 && txt.length < 60) {
            return { selector: `button:has-text('${txt}')`, stable: true };
          }
        }

        // 6. type-qualified tag
        const type = el.getAttribute('type');
        if (type && (tag === 'input' || tag === 'button')) {
          return { selector: `${tag}[type='${type}']`, stable: false };
        }

        // 7. First meaningful CSS class
        const cls = el.classList[0];
        if (cls) return { selector: `${tag}.${cls}`, stable: false };

        return { selector: tag, stable: false };
      }

      // ── Label finder ─────────────────────────────────────────────────────
      function findLabel(el: Element): string {
        // <label for="id">
        const id = el.getAttribute('id');
        if (id) {
          const lbl = document.querySelector(`label[for='${id}']`);
          if (lbl) return (lbl.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
        }
        // ancestor <label>
        let p: Element | null = el.parentElement;
        while (p) {
          if (p.tagName === 'LABEL') {
            return (p.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
          }
          p = p.parentElement;
        }
        // aria-labelledby
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const lblEl = document.getElementById(labelledBy);
          if (lblEl) return (lblEl.textContent ?? '').trim().slice(0, 60);
        }
        return '';
      }

      // ── Visibility check ─────────────────────────────────────────────────
      function isVisible(el: HTMLElement): boolean {
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      }

      // ── BUTTONS ──────────────────────────────────────────────────────────
      const buttons: RawCrawlResult['buttons'] = [];
      const seen = new Set<string>();

      for (const el of Array.from(document.querySelectorAll<HTMLElement>(
        'button, input[type="submit"], input[type="button"], [role="button"]'
      ))) {
        if (!isVisible(el)) continue;
        const text = (
          el.textContent ?? (el as HTMLInputElement).value ?? ''
        ).trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!text || text.length > 100) continue;
        const { selector, stable } = bestSel(el);
        if (seen.has(selector)) continue;
        seen.add(selector);
        buttons.push({ selector, stable, text });
      }

      // ── INPUTS ───────────────────────────────────────────────────────────
      const inputs: RawCrawlResult['inputs'] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"]), textarea'
      ))) {
        if (!isVisible(el)) continue;
        const { selector, stable } = bestSel(el);
        const inputType  = el.getAttribute('type') ?? (el.tagName === 'TEXTAREA' ? 'textarea' : 'text');
        const labelText  = findLabel(el);
        const placeholder = el.getAttribute('placeholder') ?? '';
        inputs.push({ selector, stable, inputType, labelText, placeholder });
      }

      // ── DROPDOWNS ────────────────────────────────────────────────────────
      const dropdowns: RawCrawlResult['dropdowns'] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLSelectElement>('select'))) {
        if (!isVisible(el)) continue;
        const { selector, stable } = bestSel(el);
        const labelText = findLabel(el);
        const options   = Array.from(el.options)
          .map(o => o.text.trim())
          .filter(Boolean)
          .slice(0, 20);
        dropdowns.push({ selector, stable, labelText, options });
      }

      // ── TABLES ───────────────────────────────────────────────────────────
      const tables: RawCrawlResult['tables'] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLTableElement>('table'))) {
        const { selector, stable } = bestSel(el);
        const headers = Array.from(el.querySelectorAll('th'))
          .map(th => (th.textContent ?? '').trim())
          .filter(Boolean);
        tables.push({ selector, stable, headers });
      }

      // ── LINKS (nav only — skip footer / legal) ────────────────────────────
      const links: RawCrawlResult['links'] = [];
      const seenLinks = new Set<string>();
      for (const el of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const href = el.getAttribute('href') ?? '';
        if (!href || href.startsWith('#') || href.startsWith('javascript:') ||
            href.startsWith('mailto:') || href.startsWith('tel:')) continue;
        if (el.closest('footer, .footer, #footer, [role="contentinfo"]')) continue;
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
        if (!text || text.length > 80) continue;
        const { selector, stable } = bestSel(el);
        if (seenLinks.has(selector)) continue;
        seenLinks.add(selector);
        links.push({ selector, stable, text: text.slice(0, 60), href: href.slice(0, 200) });
      }

      // ── MODALS ───────────────────────────────────────────────────────────
      const modals: RawCrawlResult['modals'] = [];
      for (const el of Array.from(document.querySelectorAll<Element>(
        '[role="dialog"], .modal, [data-modal], [aria-modal="true"]'
      ))) {
        const { selector, stable } = bestSel(el);
        const elId = el.getAttribute('id');
        let triggerBtn = '';
        if (elId) {
          const trig = document.querySelector(
            `[data-target="#${elId}"], [data-bs-target="#${elId}"], [aria-controls="${elId}"]`
          );
          if (trig) triggerBtn = bestSel(trig).selector;
        }
        modals.push({ selector, stable, triggerBtn });
      }

      // ── SPECIAL PATTERNS ─────────────────────────────────────────────────
      const body = document.body.innerHTML;
      const specialPatterns: RawCrawlResult['specialPatterns'] = {
        hasPagination: !!(
          document.querySelector('.pagination, [aria-label*="pagination" i], [role="navigation"] [aria-current="page"]') ||
          Array.from(document.querySelectorAll('button')).some(b =>
            /^next$/i.test((b.textContent ?? '').trim())
          )
        ),
        hasInfiniteScroll: (
          body.includes('IntersectionObserver') ||
          !!document.querySelector('[data-infinite-scroll], [infinite-scroll]')
        ),
        hasFileUpload:     !!document.querySelector('input[type="file"]'),
        hasDatePicker: !!(
          document.querySelector(
            'input[type="date"], input[type="datetime-local"], ' +
            '.datepicker, [data-datepicker], .react-datepicker, .MuiDatePicker-root'
          ) || body.includes('flatpickr') || body.includes('pikaday')
        ),
        hasRichTextEditor: !!(
          document.querySelector(
            '.ql-editor, .ProseMirror, .tox-tinymce, ' +
            '[contenteditable="true"]:not(input):not(textarea):not([role="combobox"])'
          )
        ),
      };

      return { buttons, inputs, dropdowns, tables, links, modals, specialPatterns };
    });
  }

  // ── Map raw browser results to typed domain objects ───────────────────────

  private toTypedElements(raw: RawCrawlResult): CrawlElements {
    const stability = (s: boolean): 'stable' | 'unstable' => s ? 'stable' : 'unstable';

    const buttons: CrawlButton[] = raw.buttons.map(b => ({
      bestSelector:      b.selector,
      visibleText:       b.text,
      purpose:           guessButtonPurpose(b.text),
      selectorStability: stability(b.stable),
    }));

    const inputs: CrawlInput[] = raw.inputs.map(i => ({
      bestSelector:      i.selector,
      inputType:         i.inputType,
      labelText:         i.labelText,
      placeholder:       i.placeholder,
      selectorStability: stability(i.stable),
    }));

    const dropdowns: CrawlDropdown[] = raw.dropdowns.map(d => ({
      bestSelector:      d.selector,
      labelText:         d.labelText,
      options:           d.options,
      selectorStability: stability(d.stable),
    }));

    const tables: CrawlTable[] = raw.tables.map(t => ({
      bestSelector:      t.selector,
      columnHeaders:     t.headers,
      selectorStability: stability(t.stable),
    }));

    const links: CrawlLink[] = raw.links.map(l => ({
      bestSelector:      l.selector,
      visibleText:       l.text,
      href:              l.href,
      selectorStability: stability(l.stable),
    }));

    const modals: CrawlModal[] = raw.modals.map(m => ({
      bestSelector:      m.selector,
      triggerButton:     m.triggerBtn,
      selectorStability: stability(m.stable),
    }));

    return {
      buttons, inputs, dropdowns, tables, links, modals,
      specialPatterns: raw.specialPatterns,
    };
  }

  // ── Page Object generation ────────────────────────────────────────────────

  async generatePageObject(crawl: PageCrawl, blueprintName: string): Promise<string> {
    const memSvc    = new FrameworkMemoryService();
    const blueprint = memSvc.loadBlueprint(blueprintName);
    const outDir    = outputDir(crawl.projectName);
    fs.mkdirSync(outDir, { recursive: true });

    const content  = this.buildPageObjectCs(crawl, blueprint);
    const filePath = path.join(outDir, `${crawl.projectName}Page.cs`);
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return filePath;
  }

  /** Build the full C# page object string from crawl + blueprint. Exposed as
   *  public so scaffoldProject can call it when writing to a custom path. */
  buildPageObjectCs(crawl: PageCrawl, blueprint: FrameworkBlueprint): string {
    const name = crawl.projectName;
    const po   = blueprint.pageObject;
    const ns   = po.namespace || `${name}.Tests.Pages`;
    const base = po.baseClass ? ` : ${po.baseClass}` : '';

    const ctorArgs  = po.constructorParams.map(t => `${t} ${paramName(t)}`).join(', ');
    const ctorAssign = po.constructorParams
      .map(t => `            _${paramName(t)} = ${paramName(t)};`)
      .join('\n');
    const fieldDecls = po.constructorParams
      .map(t => `        private readonly ${t} _${paramName(t)};`)
      .join('\n');

    const { inputs, buttons, dropdowns, tables, links, specialPatterns } = crawl.elements;

    // ── Locator block ──────────────────────────────────────────────────────
    const loc: string[] = [];

    if (inputs.length > 0) {
      loc.push('        // ── Inputs ──────────────────────────────────────────────────────────');
      for (const inp of inputs) {
        const prop      = toPropertyName(inp.labelText || inp.inputType || 'input', 'Input');
        const unstable  = inp.selectorStability === 'unstable'
          ? '  // ⚠️ Unstable — recommend adding data-testid' : '';
        const comment   = inp.labelText
          ? `        // ${inp.labelText}${inp.placeholder ? ` (placeholder: "${inp.placeholder}")` : ''}`
          : inp.placeholder ? `        // placeholder: "${inp.placeholder}"` : '';
        if (comment) loc.push(comment);
        loc.push(`        private ILocator ${prop} => _page.Locator("${inp.bestSelector}");${unstable}`);
      }
      loc.push('');
    }

    if (buttons.length > 0) {
      loc.push('        // ── Buttons ─────────────────────────────────────────────────────────');
      for (const btn of buttons) {
        const prop     = toPropertyName(btn.visibleText, 'Button');
        const unstable = btn.selectorStability === 'unstable'
          ? '  // ⚠️ Unstable — recommend adding data-testid' : '';
        loc.push(`        // ${btn.purpose}`);
        loc.push(`        private ILocator ${prop} => _page.Locator("${btn.bestSelector}");${unstable}`);
      }
      loc.push('');
    }

    if (dropdowns.length > 0) {
      loc.push('        // ── Dropdowns ───────────────────────────────────────────────────────');
      for (const dd of dropdowns) {
        const prop     = toPropertyName(dd.labelText || 'dropdown', 'Dropdown');
        const unstable = dd.selectorStability === 'unstable'
          ? '  // ⚠️ Unstable — recommend adding data-testid' : '';
        if (dd.labelText) loc.push(`        // ${dd.labelText}`);
        loc.push(`        private ILocator ${prop} => _page.Locator("${dd.bestSelector}");${unstable}`);
      }
      loc.push('');
    }

    if (tables.length > 0) {
      loc.push('        // ── Tables ──────────────────────────────────────────────────────────');
      for (const tbl of tables) {
        const prop     = toPropertyName(
          tbl.bestSelector.replace(/[^a-zA-Z0-9]/g, ' ').trim() || 'table', 'Table'
        );
        const unstable = tbl.selectorStability === 'unstable'
          ? '  // ⚠️ Unstable — recommend adding data-testid' : '';
        if (tbl.columnHeaders.length > 0) {
          loc.push(`        // Columns: ${tbl.columnHeaders.join(' | ')}`);
        }
        loc.push(`        private ILocator ${prop} => _page.Locator("${tbl.bestSelector}");${unstable}`);
      }
      loc.push('');
    }

    if (links.length > 0) {
      loc.push('        // ── Navigation Links ────────────────────────────────────────────────');
      for (const lnk of links) {
        const prop     = toPropertyName(lnk.visibleText, 'Link');
        const unstable = lnk.selectorStability === 'unstable'
          ? '  // ⚠️ Unstable — recommend adding data-testid' : '';
        loc.push(`        private ILocator ${prop} => _page.Locator("${lnk.bestSelector}");${unstable}`);
      }
      loc.push('');
    }

    // ── Methods block ──────────────────────────────────────────────────────
    const mth: string[] = [];

    // NavigateAsync
    mth.push('        /// <summary>Navigate to this page and wait for network idle.</summary>');
    mth.push('        public async Task NavigateAsync()');
    mth.push('        {');
    mth.push(`            await _page.GotoAsync("${crawl.url}");`);
    mth.push('            await _page.WaitForLoadStateAsync(LoadState.NetworkIdle);');
    mth.push('        }');
    mth.push('');

    // LoginAsync if the page has a password field
    const pwdInput = inputs.find(i => i.inputType === 'password');
    if (pwdInput) {
      const userInput = inputs.find(i =>
        i.inputType === 'email' ||
        /email|user|login/i.test(i.labelText) ||
        /email|user|login/i.test(i.placeholder)
      );
      const loginBtn = buttons.find(b => /login|sign.?in|log.?in/i.test(b.visibleText));

      mth.push('        /// <summary>Fill credentials and submit the login form.</summary>');
      mth.push('        public async Task LoginAsync(string username, string password)');
      mth.push('        {');
      if (userInput) {
        mth.push(`            await _page.Locator("${userInput.bestSelector}").FillAsync(username);`);
      }
      mth.push(`            await _page.Locator("${pwdInput.bestSelector}").FillAsync(password);`);
      if (loginBtn) {
        mth.push(`            await _page.Locator("${loginBtn.bestSelector}").ClickAsync();`);
      }
      mth.push('            await _page.WaitForLoadStateAsync(LoadState.NetworkIdle);');
      mth.push('        }');
      mth.push('');
    }

    // Click method per button
    for (const btn of buttons) {
      const method = `Click${toPascalCase(btn.visibleText)}Async`;
      mth.push(`        /// <summary>${btn.purpose}.</summary>`);
      mth.push(`        public async Task ${method}()`);
      mth.push('        {');
      mth.push(`            await _page.Locator("${btn.bestSelector}").ClickAsync();`);
      mth.push('        }');
      mth.push('');
    }

    // GetRows method per table
    for (const tbl of tables) {
      const tblProp  = toPropertyName(
        tbl.bestSelector.replace(/[^a-zA-Z0-9]/g, ' ').trim() || 'table', 'Table'
      );
      const method   = `Get${tblProp}RowsAsync`;
      mth.push(`        /// <summary>Return all visible rows in the ${tblProp}.</summary>`);
      mth.push(`        public async Task<IReadOnlyList<ILocator>> ${method}()`);
      mth.push('        {');
      mth.push(`            return await _page.Locator("${tbl.bestSelector} tbody tr").AllAsync();`);
      mth.push('        }');
      mth.push('');
    }

    // Special-pattern helpers
    if (specialPatterns.hasPagination) {
      mth.push('        /// <summary>Click the Next page button and wait for load.</summary>');
      mth.push('        public async Task ClickNextPageAsync()');
      mth.push('        {');
      mth.push('            await _page.Locator("[aria-label*=\'next\' i], button:has-text(\'Next\')").First.ClickAsync();');
      mth.push('            await _page.WaitForLoadStateAsync(LoadState.NetworkIdle);');
      mth.push('        }');
      mth.push('');
    }

    if (specialPatterns.hasFileUpload) {
      mth.push('        /// <summary>Set the file to upload via the hidden file input.</summary>');
      mth.push('        public async Task UploadFileAsync(string filePath)');
      mth.push('        {');
      mth.push('            await _page.Locator("input[type=\'file\']").SetInputFilesAsync(filePath);');
      mth.push('        }');
      mth.push('');
    }

    if (specialPatterns.hasDatePicker) {
      mth.push('        /// <summary>Set a date picker value (ISO date string: yyyy-MM-dd).</summary>');
      mth.push('        public async Task SetDateAsync(string isoDate)');
      mth.push('        {');
      mth.push('            await _page.Locator("input[type=\'date\']").First.FillAsync(isoDate);');
      mth.push('        }');
      mth.push('');
    }

    // Detected pattern summary as comments
    const patternNotes: string[] = [];
    if (specialPatterns.hasPagination)     patternNotes.push('    //   hasPagination      = true');
    if (specialPatterns.hasInfiniteScroll) patternNotes.push('    //   hasInfiniteScroll  = true');
    if (specialPatterns.hasFileUpload)     patternNotes.push('    //   hasFileUpload      = true');
    if (specialPatterns.hasDatePicker)     patternNotes.push('    //   hasDatePicker      = true');
    if (specialPatterns.hasRichTextEditor) patternNotes.push('    //   hasRichTextEditor  = true');

    const patternBlock = patternNotes.length > 0
      ? `\n        // ── Detected UI Patterns ──────────────────────────────────────────────\n` +
        patternNotes.join('\n') + '\n'
      : '';

    const crawledDate = new Date(crawl.crawledAt).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    });

    return [
      `using Microsoft.Playwright;`,
      `using Reqnroll;`,
      ``,
      `namespace ${ns}`,
      `{`,
      `    /// <summary>`,
      `    /// Page object for ${name}.`,
      `    /// Auto-generated by crawl_page on ${crawledDate}`,
      `    /// Source URL  : ${crawl.url}`,
      `    /// Blueprint   : ${blueprint.projectName} (${blueprint.scannedAt.split('T')[0]})`,
      `    /// Elements    : ${inputs.length} inputs | ${buttons.length} buttons | ` +
        `${tables.length} tables | ${dropdowns.length} dropdowns`,
      `    /// </summary>`,
      `    public class ${name}Page${base}`,
      `    {`,
      fieldDecls,
      ``,
      ...loc,
      patternBlock,
      `        // ── Constructor ─────────────────────────────────────────────────────────`,
      `        public ${name}Page(${ctorArgs})`,
      `        {`,
      ctorAssign,
      `        }`,
      ``,
      `        // ── Actions ─────────────────────────────────────────────────────────────`,
      ``,
      ...mth,
      `    }`,
      `}`,
      ``,
    ].join('\n');
  }

  // ── Read / List helpers ───────────────────────────────────────────────────

  loadCrawl(projectName: string): PageCrawl {
    const p = path.join(crawlsDir(), `${projectName}-crawl.json`);
    if (!fs.existsSync(p)) {
      throw new Error(
        `No crawl found for "${projectName}". Run crawl_page first.`
      );
    }
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as PageCrawl;
  }

  hasCrawl(projectName: string): boolean {
    return fs.existsSync(path.join(crawlsDir(), `${projectName}-crawl.json`));
  }

  listCrawls(): CrawlSummary[] {
    const dir = crawlsDir();
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('-crawl.json'))
        .map((f): CrawlSummary | null => {
          try {
            const raw = JSON.parse(
              fs.readFileSync(path.join(dir, f), 'utf-8')
            ) as PageCrawl;
            const el = raw.elements;
            return {
              projectName:  raw.projectName,
              crawledAt:    raw.crawledAt,
              url:          raw.url,
              elementCount: (
                el.buttons.length + el.inputs.length + el.dropdowns.length +
                el.tables.length  + el.links.length  + el.modals.length
              ),
            };
          } catch { return null; }
        })
        .filter((s): s is CrawlSummary => s !== null)
        .sort((a, b) => b.crawledAt.localeCompare(a.crawledAt));
    } catch { return []; }
  }
}
