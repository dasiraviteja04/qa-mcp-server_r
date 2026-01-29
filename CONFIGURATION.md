# QA MCP Server - Configuration Guide

## Environment Setup

### Setting Playwright Project Path

You can configure the Playwright project path in multiple ways:

#### Option 1: Environment Variable (Recommended for CI/CD)

```bash
export PLAYWRIGHT_PROJECT_ROOT=/path/to/playwright-automation
npm start
```

#### Option 2: Edit Configuration File

Edit `src/config/environments.ts`:

```typescript
const getPlaywrightRoot = (): string => {
  return '/path/to/playwright-automation';
};
```

### Environment Modes

The server supports three environments:

#### Development
- 4 parallel workers
- Longer timeouts (30s)
- All test tags allowed

#### Staging
- 2 parallel workers  
- Medium timeouts (60s)
- All test tags allowed

#### Production
- 1 worker (sequential)
- Longest timeouts (120s)
- Only critical and smoke tests allowed

Switch environments with:
```bash
TEST_ENV=production npm start
```

## Test Tagging Convention

Tag your Playwright tests to enable intelligent orchestration:

```typescript
test('@critical @smoke Login works', async ({ page }) => {
  // Critical: Test must pass
  // Smoke: Run in smoke test suite
});

test('@regression Form validation', async ({ page }) => {
  // Regression: Included in regression suite
});

test('@e2e @high Complete checkout flow', async ({ page }) => {
  // E2E: End-to-end test
  // High: High criticality
});
```

## Report Configuration

Playwright must output JSON reports for the MCP server to analyze:

### playwright.config.ts

```typescript
export default defineConfig({
  reporter: [
    ['json', { outputFile: 'reports/latest.json' }],
  ],
  // ... other config
});
```

The MCP server will read from:
- `reports/latest.json` - Latest test execution
- `reports/run-*.json` - Historical reports (for flaky detection)

## MCP Client Configuration

### Using with Claude

Create or update `.cursor/rules.md` or configure Claude with:

```json
{
  "mcpServers": {
    "qa-server": {
      "command": "node",
      "args": ["/path/to/qa-mcp-server/dist/server.js"],
      "type": "stdio"
    }
  }
}
```

### Using with Other MCP Clients

The server communicates via JSON-RPC over stdio. Any MCP-compatible client can connect.

## Policies Configuration

Edit `src/services/policy.service.ts` to customize governance:

```typescript
const DEFAULT_POLICIES = [
  {
    name: 'critical-failures-block-release',
    description: 'Block release if critical tests fail',
    enabled: true,
    action: 'block'
  },
  // Add custom policies here
];
```

## Advanced: Custom Tools

To add a custom tool:

1. Create `src/tools/myTool.ts`:

```typescript
export async function myTool(
  input: Record<string, unknown> | undefined
): Promise<ToolResult> {
  return {
    content: [{
      type: 'text',
      text: 'Custom tool output'
    }]
  };
}
```

2. Register in `src/server.ts`:

```typescript
mcpServer.registerTool(
  "my_tool",
  {
    description: "My custom tool",
    inputSchema: z.object({
      // Define input schema
    })
  },
  async (input) => myTool(input)
);
```

3. Rebuild:

```bash
npm run build
```

## Troubleshooting

### "No tests found"

- Verify `PLAYWRIGHT_PROJECT_ROOT` points to correct Playwright project
- Ensure tests exist in `tests/` directory with `*.spec.ts` or `*.spec.js` naming
- Run `npx playwright test --list` in the Playwright project to verify tests

### "No reports found"

- Run tests in Playwright project first: `npx playwright test`
- Verify `playwright.config.ts` has JSON reporter enabled
- Check `reports/latest.json` exists

### "Connection refused"

- Ensure MCP server is running: `npm start`
- Verify stdio transport is properly configured
- Check Node version is >= 18

## Performance Tuning

### Increasing Test Parallelism

Edit `src/config/environments.ts`:

```typescript
development: {
  // ...
  workers: 8  // Increase from 4
}
```

### Report Analysis Depth

Edit `src/services/report.service.ts`:

```typescript
getTestHistory(testName: string, limit: number = 10) {
  // Increase from 5 to 10 for deeper flaky detection
}
```

## CI/CD Integration Example

### GitHub Actions

```yaml
- name: Run QA Tests
  env:
    TEST_ENV: staging
    PLAYWRIGHT_PROJECT_ROOT: ./automation-framework
  run: npm run build && npm start
```

### GitLab CI

```yaml
qa_tests:
  script:
    - npm run build
    - npm start
  env:
    TEST_ENV: staging
```

## See Also

- [Playwright Config](https://playwright.dev/docs/test-configuration)
- [MCP Types and Schemas](../src/types/mcp.types.ts)
- [Policy Service](../src/services/policy.service.ts)
