# QA Intelligence MCP Server

A thin MCP (Model Context Protocol) server that orchestrates Playwright test execution and provides QA intelligence for automation frameworks.

## Overview

This MCP server sits on top of a Playwright automation framework and exposes four key tools:

1. **list_tests** - List all available tests with metadata (tags, criticality, feature)
2. **run_tests** - Execute Playwright tests with controlled parameters
3. **get_failures** - Analyze and classify failures from test execution
4. **get_release_risk** - Assess whether a release is safe based on test results

## Quick Start

### Prerequisites

- Node.js >= 18
- Playwright automation framework
- npm

### Installation

```bash
# Navigate to the project
cd qa-mcp-server

# Install dependencies
npm install

# Build the TypeScript
npm run build
```

### Running the Server

```bash
npm start
```

The server will start on stdio and wait for MCP client connections.

## Architecture

### Separation of Concerns

```
Playwright Project (Execution Layer)
  └─ Tests, selectors, browser control

QA MCP Server (Intelligence Layer)
  ├─ Test orchestration
  ├─ Result interpretation
  ├─ Policy enforcement
  └─ Risk assessment
```

### Project Structure

```
qa-mcp-server/
├── src/
│   ├── server.ts              # MCP bootstrap and tool registration
│   ├── tools/
│   │   └── simple-tools.ts    # Tool implementations
│   ├── services/
│   │   ├── playwright.service.ts
│   │   ├── report.service.ts
│   │   └── policy.service.ts
│   ├── config/
│   │   ├── environments.ts
│   │   └── policies.ts
│   └── types/
│       └── mcp.types.ts       # Type definitions
├── dist/                      # Compiled JavaScript
├── reports/                   # Test execution reports
├── package.json
├── tsconfig.json
└── README.md
```

## Tools

### list_tests

List all available tests with metadata.

**Parameters:**
- `tags` (optional): Filter tests by tag (e.g., 'critical', 'smoke', 'regression')

**Returns:**
- Test list grouped by feature
- Each test shows: name, criticality level, tags
- Summary statistics (critical count, smoke count, regression count)

### run_tests

Execute Playwright tests with specified tags and parameters.

**Parameters:**
- `tags` (optional): Test tags to run (string or array)
- `workers` (optional): Number of parallel workers
- `timeout` (optional): Test timeout in milliseconds

**Returns:**
- Execution summary with pass/fail counts
- Failed test names and error messages
- Pass rate percentage

### get_failures

Analyze and classify failures from the latest test execution.

**Returns:**
- Failures grouped by classification:
  - **Flaky**: Tests that fail intermittently
  - **Regression**: New failures in non-critical flows
  - **Environment Issue**: Failures specific to the environment
  - **New Failure**: Previously passing tests now failing
- Each failure includes: name, failure count, last failure time, error details

### get_release_risk

Assess whether a release is safe based on test results and QA policies.

**Returns:**
- Risk level: `LOW`, `MEDIUM`, or `HIGH`
- Recommendation: Proceed, Proceed with Caution, or Do NOT proceed
- Summary: Pass rate, critical failures, flaky tests, regressions
- Details: Lists of failing critical tests, flaky tests, regressions, and environment issues

## Configuration

### Environment Configuration

Edit `src/config/environments.ts` to configure Playwright project paths and test parameters for different environments:

```typescript
development: {
  playwrightProjectRoot: '/path/to/playwright-automation',
  reportOutputDir: './reports',
  testEnvironment: 'staging',
  workers: 4
}
```

### Policies

QA governance policies are defined in `src/config/policies.ts`. These control:
- Whether critical test failures block release
- Flaky test warnings
- Environment-specific issues
- Self-healing disabled in production

## Integration with Claude/Claude3

This MCP server is designed to work with Claude as an MCP client. Once the server is running:

1. Configure Claude with this server's stdio transport
2. Ask Claude questions like:
   - "What tests are available?"
   - "Run critical tests and tell me if we can release"
   - "What's causing the failures?"
   - "Is the automation framework ready for production?"

Claude will use the MCP tools to provide intelligent QA insights.

## Development

### Build

```bash
npm run build
```

### Development Mode

```bash
npm run dev
```

Runs TypeScript directly with `ts-node` for quicker iterations.

## Key Principles

1. **MCP Orchestrates, Playwright Executes** - The server never controls the browser, only orchestrates and interprets
2. **Metadata-Driven** - Tests are tagged with metadata (criticality, features) that drive intelligence
3. **Policy-Enforced** - Safety guarantees through QA policies
4. **Reusable Across Apps** - Same server works with different Playwright projects with configuration changes
5. **AI-Ready** - Structured responses enable AI-driven QA decision making

## Common Questions

**Q: How do I connect to a different Playwright project?**
A: Update `PLAYWRIGHT_PROJECT_ROOT` environment variable or edit `src/config/environments.ts`

**Q: Can I add custom tools?**
A: Yes, add tool implementations to `src/tools/` and register them in `src/server.ts`

**Q: How are test reports parsed?**
A: The `ReportService` reads Playwright's `latest.json` JSON report and extracts test results

**Q: Can I use this in CI/CD?**
A: Yes, the server can be invoked programmatically. The stdio transport makes it perfect for CI integration

## License

ISC

## See Also

- [Model Context Protocol Documentation](https://modelcontextprotocol.io)
- [Playwright Documentation](https://playwright.dev)
- [MCP SDK for TypeScript](https://github.com/modelcontextprotocol/typescript-sdk)
