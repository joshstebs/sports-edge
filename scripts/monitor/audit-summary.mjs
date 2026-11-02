import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function summarizeAudit(audit) {
  if (!audit || typeof audit !== 'object' || !audit.vulnerabilities || !audit.metadata?.vulnerabilities) {
    throw new Error('npm audit did not return a valid vulnerability report');
  }
  const findings = Object.entries(audit.vulnerabilities).map(([name, data]) => ({
    name,
    severity: data.severity || 'unknown',
    range: data.range || 'unknown',
    isDirect: Boolean(data.isDirect),
    fixAvailable: Boolean(data.fixAvailable),
  })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return { counts: audit.metadata.vulnerabilities, findings };
}

function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: audit-summary.mjs <audit.json> [--report-only]');
  const report = summarizeAudit(JSON.parse(readFileSync(file, 'utf8')));
  const counts = report.counts;
  console.log('npm audit: critical=' + counts.critical + ' high=' + counts.high + ' moderate=' + counts.moderate + ' low=' + counts.low);
  for (const item of report.findings) {
    console.log('npm audit finding: ' + item.name + ' (' + item.severity + ', affected: ' + item.range + ', direct: ' + item.isDirect + ', fix available: ' + item.fixAvailable + ')');
  }
  if (process.argv[3] !== '--report-only' && (counts.critical > 0 || counts.high > 0)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error('npm audit could not be assessed:', error.message); process.exitCode = 2; }
}
