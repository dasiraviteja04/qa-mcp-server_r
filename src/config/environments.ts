/**
 * Environment-specific configuration
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface EnvironmentConfig {
  name: string;
  playwrightProjectRoot: string;
  reportOutputDir: string;
  testEnvironment: string;
  allowedTags: string[];
  timeoutMs: number;
  workers: number;
}

// Get the directory where this server is running from (go up to project root)
const getServerRoot = (): string => {
  // __dirname is src/config, go up 2 levels to project root
  return path.join(__dirname, '..', '..');
};

// You can set PLAYWRIGHT_PROJECT_ROOT env var to override the default path
const getPlaywrightRoot = (): string => {
  return process.env.PLAYWRIGHT_PROJECT_ROOT || 
    path.join(process.cwd(), '..', 'playwright-automation');
};

// Get reports directory - use absolute path from server root
const getReportsDir = (): string => {
  return path.join(getServerRoot(), 'reports');
};

export const ENVIRONMENTS: { [key: string]: EnvironmentConfig } = {
  development: {
    name: 'development',
    playwrightProjectRoot: getPlaywrightRoot(),
    reportOutputDir: getReportsDir(),
    testEnvironment: 'staging',
    allowedTags: ['critical', 'smoke', 'regression', 'e2e', 'api'],
    timeoutMs: 30000,
    workers: 4
  },

  staging: {
    name: 'staging',
    playwrightProjectRoot: getPlaywrightRoot(),
    reportOutputDir: getReportsDir(),
    testEnvironment: 'staging',
    allowedTags: ['critical', 'smoke', 'regression', 'e2e', 'api'],
    timeoutMs: 60000,
    workers: 2
  },

  production: {
    name: 'production',
    playwrightProjectRoot: getPlaywrightRoot(),
    reportOutputDir: getReportsDir(),
    testEnvironment: 'production',
    allowedTags: ['critical', 'smoke'], // Only critical and smoke in prod
    timeoutMs: 120000,
    workers: 1 // Single worker for production
  }
};

/**
 * Get environment config
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
