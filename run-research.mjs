// Direct invocation script for autoResearch — bypasses MCP transport
import path from 'path';
import { fileURLToPath } from 'url';
import { ReportService } from './src/services/report.service.js';
import { autoResearch } from './src/tools/autoResearch.js';
import { getEnvironmentConfig } from './src/config/environments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = getEnvironmentConfig();

// Step 1: Parse the TRX report into latest.json so autoResearch can read it
const trxPath = path.join(config.reportOutputDir, 'results.trx');
const reportService = new ReportService(config.reportOutputDir);
console.log(`📄 Parsing TRX report: ${trxPath}`);
reportService.parseTrxToLatest(trxPath);
console.log('✅ TRX parsed → latest.json\n');

// Step 2: Run auto research
console.log('🔬 Running QA Agent Auto-Research...\n');
const result = await autoResearch({ depth: 'deep', includeGit: true, includeCoverage: true });

if (result.content && result.content.length > 0) {
  console.log(result.content[0].text);
} else {
  console.log('No output returned.');
}
