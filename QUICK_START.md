# Quick Start Guide

## 30-Second Setup

```bash
# 1. Navigate to the project
cd /Users/administrator/Desktop/Playwright/MCP Project/qa-mcp-server

# 2. Build (already done)
npm run build

# 3. Start the server
npm start
```

## What You've Built

A **Thin MCP Server** that:
- ✅ Lists available Playwright tests with metadata
- ✅ Triggers test execution with controlled parameters
- ✅ Analyzes test failures and classifies them
- ✅ Assesses release risk based on test results
- ✅ Enforces QA policies (critical failures block release, flaky warnings, etc.)

## Four MCP Tools Ready to Use

### 1. list_tests
**What**: List all available tests with tags, criticality, and features
**Example use**: "What tests are available for checkout?"

### 2. run_tests  
**What**: Execute Playwright tests by tag
**Example use**: "Run critical tests and report pass rate"

### 3. get_failures
**What**: Analyze failures from latest test run
**Example use**: "Why are tests failing? Are they flaky?"

### 4. get_release_risk
**What**: Assess if safe to deploy
**Example use**: "Can we release to production?"

## File Structure

```
qa-mcp-server/
├── src/
│   ├── server.ts                    # Main MCP server (registers 4 tools)
│   ├── tools/simple-tools.ts        # Tool implementations
│   ├── services/                    # Business logic
│   │   ├── playwright.service.ts    # Playwright interaction
│   │   ├── report.service.ts        # Report parsing
│   │   └── policy.service.ts        # QA policies
│   ├── config/                      # Configuration
│   │   ├── environments.ts          # Environment-specific settings
│   │   └── policies.ts              # QA governance policies
│   └── types/                       # TypeScript types
│       └── mcp.types.ts
├── dist/                            # Compiled JavaScript (ready to run)
├── reports/                         # Playwright test reports go here
├── package.json
├── tsconfig.json
├── README.md                        # Full documentation
├── CONFIGURATION.md                 # Advanced configuration
└── QUICK_START.md                   # This file
```

## Next Steps

### Option A: Connect to Claude
Configure your Claude/Claude3 client to use this MCP server:

```json
{
  "mcpServers": {
    "qa": {
      "command": "node",
      "args": ["/Users/administrator/Desktop/Playwright/MCP Project/qa-mcp-server/dist/server.js"]
    }
  }
}
```

Then ask Claude:
- "List all tests"
- "Run critical tests"
- "Are we ready to release?"

### Option B: Use with Your Playwright Project
1. Update `PLAYWRIGHT_PROJECT_ROOT` environment variable to point to your Playwright project
2. Run tests in your Playwright project: `npx playwright test`
3. Start this MCP server: `npm start`
4. Tools will now read from your test reports

### Option C: Integrate with CI/CD
```bash
# In your CI pipeline
TEST_ENV=production npm start
```

## Key Design Principles

🎯 **Separation of Concerns**
- Playwright executes tests (browser control)
- MCP server interprets results (intelligence)
- Works with ANY Playwright framework

🔒 **Safe by Default**
- Critical test failures block release
- Policies enforced at MCP level
- No arbitrary shell execution

🧠 **AI-Ready**
- Structured tool responses
- Metadata-driven decisions
- Perfect for LLM integration

📈 **Scalable**
- Same server works for multiple projects
- Just change config/environment
- No code changes needed

## Common Tasks

### See all available tests
```
User: "List all tests"
→ MCP calls list_tests → Shows organized list by feature
```

### Run critical tests
```
User: "Run critical tests"
→ MCP calls run_tests with tags=['critical']
→ Executes tests via Playwright
→ Returns results
```

### Check if we can release
```
User: "Are we ready to release?"
→ MCP calls run_tests
→ MCP calls get_failures
→ MCP calls get_release_risk
→ Returns risk assessment + recommendation
```

### Investigate failures
```
User: "Why are tests failing?"
→ MCP calls get_failures
→ Classifies failures (flaky/regression/environment-issue)
→ Returns detailed analysis
```

## Troubleshooting

**Server won't start**
```bash
# Check Node version (need >= 18)
node --version

# Rebuild
npm run build

# Try again
npm start
```

**No tests found**
```bash
# Set correct path to Playwright project
export PLAYWRIGHT_PROJECT_ROOT=/path/to/playwright-automation
npm start
```

**No reports found**
```bash
# Must run Playwright tests first
cd ../playwright-automation
npx playwright test
# Then start MCP server
cd ../qa-mcp-server
npm start
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  LLM Client (Claude, etc.)                          │
│  "Run critical tests and tell me if we can release" │
└──────────────────────┬──────────────────────────────┘
                       │ (stdio/JSON-RPC)
┌──────────────────────▼──────────────────────────────┐
│  MCP Server (qa-mcp-server)                        │
│  ┌─────────┬────────────┬──────────┬──────────┐    │
│  │list     │run_tests   │get_       │get_      │    │
│  │_tests   │            │failures   │release_  │    │
│  │         │            │           │risk      │    │
│  └────┬────┴────┬───────┴─────┬─────┴────┬─────┘    │
│       │         │             │          │          │
│  Services:      │             │          │          │
│  • Playwright   │ Policies    │ Reports  │ Config   │
│  • Report       └─────────────┴──────────┴──────────┘
│  • Policy
└─────────────────────┬──────────────────────────────┘
                      │
           ┌──────────▼──────────┐
           │  Playwright         │
           │  Automation         │
           │  Framework          │
           └─────────────────────┘
```

## What's Next?

1. ✅ Server is built and ready to run
2. 🔗 Connect to Claude or another MCP client
3. 📊 Use tools to get QA insights
4. 🔧 Customize policies and configuration as needed
5. 🚀 Integrate with your CI/CD pipeline

## Support

- Full documentation: See [README.md](README.md)
- Configuration guide: See [CONFIGURATION.md](CONFIGURATION.md)
- Type definitions: See [src/types/mcp.types.ts](src/types/mcp.types.ts)
- Service implementation: See [src/services/](src/services/)

---

**Ready to get started?**

```bash
npm start
```

Then ask your MCP client: "What tests are available?"
