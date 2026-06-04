/**
 * Type definitions for the Live Page Crawler (crawl_page tool).
 *
 * Separate from the lightweight InteractiveElement used by read_page_source.
 * These types capture a full, structured crawl with selector stability,
 * element categorisation, and special UI pattern detection.
 */

// ---------------------------------------------------------------------------
// Discovered element types
// ---------------------------------------------------------------------------

export interface CrawlButton {
  bestSelector:      string;
  visibleText:       string;
  purpose:           string;
  selectorStability: 'stable' | 'unstable';
}

export interface CrawlInput {
  bestSelector:      string;
  inputType:         string;     // text | email | password | number | date | checkbox | textarea | …
  labelText:         string;
  placeholder:       string;
  selectorStability: 'stable' | 'unstable';
}

export interface CrawlDropdown {
  bestSelector:      string;
  labelText:         string;
  options:           string[];
  selectorStability: 'stable' | 'unstable';
}

export interface CrawlTable {
  bestSelector:      string;
  columnHeaders:     string[];
  selectorStability: 'stable' | 'unstable';
}

export interface CrawlLink {
  bestSelector:      string;
  visibleText:       string;
  href:              string;
  selectorStability: 'stable' | 'unstable';
}

export interface CrawlModal {
  bestSelector:      string;
  triggerButton:     string;
  selectorStability: 'stable' | 'unstable';
}

export interface SpecialPatterns {
  hasPagination:     boolean;
  hasInfiniteScroll: boolean;
  hasFileUpload:     boolean;
  hasDatePicker:     boolean;
  hasRichTextEditor: boolean;
}

export interface CrawlElements {
  buttons:         CrawlButton[];
  inputs:          CrawlInput[];
  dropdowns:       CrawlDropdown[];
  tables:          CrawlTable[];
  links:           CrawlLink[];
  modals:          CrawlModal[];
  specialPatterns: SpecialPatterns;
}

// ---------------------------------------------------------------------------
// Persisted crawl document  (memory/crawls/{projectName}-crawl.json)
// ---------------------------------------------------------------------------

export interface PageCrawl {
  projectName:   string;
  url:           string;
  crawledAt:     string;    // ISO-8601
  loginRequired: boolean;
  elements:      CrawlElements;
}

// ---------------------------------------------------------------------------
// Summary (used by list_crawls)
// ---------------------------------------------------------------------------

export interface CrawlSummary {
  projectName:  string;
  crawledAt:    string;
  url:          string;
  elementCount: number;
}

// ---------------------------------------------------------------------------
// Tool input / output shapes
// ---------------------------------------------------------------------------

export interface LoginOptions {
  username:         string;
  password_env_key: string;
}

export interface CrawlPageInput {
  project_name:    string;
  url:             string;
  blueprint_name?: string;
  login?:          LoginOptions;
}

export interface CrawlPageOutput {
  status:              'success' | 'error';
  projectName:         string;
  crawlSaved:          string;
  pageObjectGenerated?: string;
  summary: {
    buttonsFound:       number;
    inputsFound:        number;
    tablesFound:        number;
    dropdownsFound:     number;
    unstableSelectors:  number;
    warnings:           string[];
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// Raw shapes returned from page.evaluate() — serialisable plain objects
// ---------------------------------------------------------------------------

export interface RawElement {
  selector: string;
  stable:   boolean;
}

export interface RawButton extends RawElement { text: string; }

export interface RawInput extends RawElement {
  inputType:   string;
  labelText:   string;
  placeholder: string;
}

export interface RawDropdown extends RawElement {
  labelText: string;
  options:   string[];
}

export interface RawTable   extends RawElement { headers: string[]; }
export interface RawLink    extends RawElement { text: string; href: string; }
export interface RawModal   extends RawElement { triggerBtn: string; }

export interface RawSpecialPatterns {
  hasPagination:     boolean;
  hasInfiniteScroll: boolean;
  hasFileUpload:     boolean;
  hasDatePicker:     boolean;
  hasRichTextEditor: boolean;
}

export interface RawCrawlResult {
  buttons:         RawButton[];
  inputs:          RawInput[];
  dropdowns:       RawDropdown[];
  tables:          RawTable[];
  links:           RawLink[];
  modals:          RawModal[];
  specialPatterns: RawSpecialPatterns;
}
