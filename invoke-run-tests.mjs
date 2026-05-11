/**
 * One-shot invocation of qa-mcp-server run_tests tool.
 * Usage: node invoke-run-tests.mjs
 */
import { runTests } from './dist/tools/runTests.js';

const result = await runTests({
  filter:       'FullyQualifiedName~Non_NumericRateInput',  // only the 2 failed non-numeric scenarios
  device:       '',          // desktop mode — uses auto.runsettings
  autoResearch: true         // trigger ResearchService analysis if any test fails
});

const text = result.content?.[0]?.text ?? '(no output)';
console.log(text);
process.exit(result.isError ? 1 : 0);
