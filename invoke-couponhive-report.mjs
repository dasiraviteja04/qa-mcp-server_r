/**
 * CouponHive Automation Report
 * Chains: run_tests → get_failures → get_release_risk → coverage_analysis
 *       → generate_html_report (+ auto_research if failures)
 * Usage: node invoke-couponhive-report.mjs
 */
import { runTests }            from './dist/tools/runTests.js';
import { getFailures }         from './dist/tools/getFailures.js';
import { getReleaseRisk }      from './dist/tools/getReleaseRisk.js';
import { coverageAnalysis }    from './dist/tools/coverageAnalysis.js';
import { autoResearch }        from './dist/tools/autoResearch.js';
import { generateHtmlReport }  from './dist/tools/generateHtmlReport.js';

const DIVIDER = '\n' + '═'.repeat(60) + '\n';

function text(result) {
  return result?.content?.[0]?.text ?? '(no output)';
}

// ── 1. Run all CouponHive UI tests ───────────────────────────────────────────
console.log('📋 CouponHive Automation Report');
console.log('⏳ Step 1/5 — Running couponhive-ui test suite...');

const runResult = await runTests({
  tags:    ['couponhive-ui'],
  device:  '',          // desktop
  workers: 2
});

const runText = text(runResult);
console.log(runText);

// ── Detect failures from run output ─────────────────────────────────────────
const hasFailed = runText.includes('✗ Failed') && !runText.includes('✗ Failed : 0');

// ── 2. Analyse failures ───────────────────────────────────────────────────────
console.log(DIVIDER + '⏳ Step 2/5 — Analysing failures...');
const failResult = await getFailures({});
const failText   = text(failResult);
console.log(failText);

// ── 3. Release risk verdict ───────────────────────────────────────────────────
console.log(DIVIDER + '⏳ Step 3/5 — Assessing release risk...');
const riskResult = await getReleaseRisk({});
const riskText   = text(riskResult);
console.log(riskText);

// ── 4. Coverage gap analysis (CouponHive area, last 30 days) ─────────────────
console.log(DIVIDER + '⏳ Step 4/5 — Scanning coverage gaps (couponhive, last 30d)...');
const coverResult = await coverageAnalysis({ since: '30d', area: 'couponhive' });
const coverText   = text(coverResult);
console.log(coverText);

// ── 5. Auto-research if failures found ───────────────────────────────────────
if (hasFailed) {
  console.log(DIVIDER + '🔬 Failures detected — running AutoResearch (deep)...');
  const researchResult = await autoResearch({ depth: 'deep', includeGit: true, includeCoverage: true });
  console.log(text(researchResult));
}

// ── 6. Generate HTML report ───────────────────────────────────────────────────
console.log(DIVIDER + '⏳ Step 5/5 — Generating HTML report...');
const htmlResult = await generateHtmlReport({
  title:         'CouponHive QA Report',
  coverageText:  coverText,
  riskText:      riskText,
  openInBrowser: true
});
console.log(text(htmlResult));

console.log(DIVIDER + '✅ CouponHive Automation Report Complete');
process.exit(hasFailed ? 1 : 0);
