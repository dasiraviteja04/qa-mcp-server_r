/**
 * Environment-specific configuration for UIAutomationTests (C# / Reqnroll / NUnit)
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface EnvironmentConfig {
  name: string;
  playwrightProjectRoot: string;   // root folder of the C# project
  csprojFile: string;              // .csproj filename
  runSettingsFile: string;         // .runsettings filename for this environment
  featuresDir: string;             // absolute path to Features/ folder
  reportOutputDir: string;         // where TRX + JSON reports are written
  testEnvironment: string;         // ASPNETCORE_ENVIRONMENT value
  allowedTags: string[];           // tags permitted to run in this environment
  timeoutMs: number;               // per-test timeout hint (ms)
  workers: number;                 // max parallel workers
  appCodeRoot?: string;            // root of the application source repo (for coverage gap analysis)
}

// Override project root via env var, e.g. when running in CI
const getCSharpProjectRoot = (): string => {
  return process.env.DOTNET_PROJECT_ROOT ||
    path.join(
      'C:', 'Users', 'Ravi Teja Dasi', 'source', 'repos',
      'Explore', 'Playwright_AutomationDB', 'Explore', 'Code',
      'UIAutomationTests', 'UIAutomationTests'
    );
};

// Root of the application source repo — used by GitService/CoverageService to detect
// code changes in the app being tested (not just changes to the test project itself).
const getAppCodeRoot = (): string =>
  process.env.APP_CODE_ROOT ||
  path.join('C:', 'Users', 'Ravi Teja Dasi', 'source', 'repos', 'Explore', 'Code', 'CouponHive');

const getServerRoot = (): string => {
  // __dirname is src/config, go up 2 levels to project root
  return path.join(__dirname, '..', '..');
};

const getReportsDir = (): string => {
  return path.join(getServerRoot(), 'reports');
};

// Every tag that exists across all feature files
const ALL_TAGS: string[] = [
  'regression',
  'production',
  'staging',
  'chargeoff',
  'paidoffsettlement',
  'ontracksettlement',
  'payoff',
  'editloan',
  'partialpayment',
  'regenschedule',
  'paymentextenstion',
  'outgoingemail',
  'outgoingsms',
  'vwf',
  'vportal',
  'postleads',
  'search',
  'couponhive',
  'couponhive-create',
  'couponhive-bulk',
  'couponhive-audit',
  'couponhive-ui',
  'couponhive-ui-create',
  'couponhive-ui-export',
  'couponhive-ui-audit',
  'couponhive-ui-bulk'
];

export const ENVIRONMENTS: { [key: string]: EnvironmentConfig } = {
  // auto_qa – local development / auto QA database
  development: {
    name: 'development',
    playwrightProjectRoot: getCSharpProjectRoot(),
    csprojFile: 'UIAutomationTests.csproj',
    runSettingsFile: 'auto.runsettings',
    featuresDir: path.join(getCSharpProjectRoot(), 'Features'),
    reportOutputDir: getReportsDir(),
    testEnvironment: 'auto_qa',
    allowedTags: ALL_TAGS,
    timeoutMs: 300000,   // 5 min – C# tests are slower than JS
    workers: 2,          // matches project MaxCpuCount=2
    appCodeRoot: getAppCodeRoot()
  },

  // staging – explorecredit staging environment
  staging: {
    name: 'staging',
    playwrightProjectRoot: getCSharpProjectRoot(),
    csprojFile: 'UIAutomationTests.csproj',
    runSettingsFile: 'staging.runsettings',
    featuresDir: path.join(getCSharpProjectRoot(), 'Features'),
    reportOutputDir: getReportsDir(),
    testEnvironment: 'staging',
    allowedTags: ALL_TAGS,
    timeoutMs: 300000,
    workers: 2,
    appCodeRoot: getAppCodeRoot()
  },

  // production – explorecredit production; only @production health checks allowed
  production: {
    name: 'production',
    playwrightProjectRoot: getCSharpProjectRoot(),
    csprojFile: 'UIAutomationTests.csproj',
    runSettingsFile: 'production.runsettings',
    featuresDir: path.join(getCSharpProjectRoot(), 'Features'),
    reportOutputDir: getReportsDir(),
    testEnvironment: 'production',
    allowedTags: ['production'],   // strictly limited to production health checks
    timeoutMs: 120000,
    workers: 1,                    // sequential in production
    appCodeRoot: getAppCodeRoot()
  },

  // qafence – isolated QA fence environment
  qafence: {
    name: 'qafence',
    playwrightProjectRoot: getCSharpProjectRoot(),
    csprojFile: 'UIAutomationTests.csproj',
    runSettingsFile: 'qafence.runsettings',
    featuresDir: path.join(getCSharpProjectRoot(), 'Features'),
    reportOutputDir: getReportsDir(),
    testEnvironment: 'qafence',
    allowedTags: ALL_TAGS,
    timeoutMs: 300000,
    workers: 2,
    appCodeRoot: getAppCodeRoot()
  }
};

/**
 * Get environment config – defaults to development
 */
export const getEnvironmentConfig = (env?: string): EnvironmentConfig => {
  const environment = env || process.env.TEST_ENV || 'development';
  const config = ENVIRONMENTS[environment];

  if (!config) {
    console.warn(`Unknown environment: ${environment}. Using development.`);
    return ENVIRONMENTS['development']!;
  }

  return config;
};
