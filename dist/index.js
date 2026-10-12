// Deploy Guard — zero-dependency GitHub Action (Node 20).
// Scans changed files in a PR for dangerous deploy patterns and reports findings.
// Uses only Node built-ins + global fetch, so no bundling/npm install is required.

const fs = require('fs');

// ---- Workflow command helpers -------------------------------------------------
const log = (m) => process.stdout.write(m + '\n');
const annotate = (level, f) => {
  // level: error | warning | notice
  const loc = f.line ? `,line=${f.line}` : '';
  log(`::${level} file=${f.file}${loc},title=${f.title}::${f.message}`);
};
const setOutput = (name, val) => {
  const out = process.env.GITHUB_OUTPUT;
  if (out) fs.appendFileSync(out, `${name}<<__EOF__\n${val}\n__EOF__\n`);
};

// ---- Rules --------------------------------------------------------------------
const RULES = require('./index.rules.js');

// ---- PR file loading ----------------------------------------------------------
async function getChangedFiles() {
  const token = process.env.GITHUB_TOKEN || process.env.INPUT_TOKEN;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('No GITHUB_EVENT_PATH — run this on a pull_request event.');
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr) {
    log('::notice::Deploy Guard only runs on pull_request events. Skipping.');
    return null;
  }
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  const files = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${pr.number}/files?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'deploy-guard',
        },
      }
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    files.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return files;
}

// ---- Main ---------------------------------------------------------------------
async function run() {
  const failOn = (process.env.INPUT_FAIL_ON || 'error').toLowerCase();
  const files = await getChangedFiles();
  if (!files) return;

  const findings = [];
  for (const file of files) {
    if (file.status === 'removed' || !file.patch) continue;
    const addedLines = file.patch
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1));
    for (const rule of RULES) {
      if (!rule.appliesTo.test(file.filename)) continue;
      for (const line of addedLines) {
        if (rule.test(line)) {
          findings.push({
            rule: rule.id,
            severity: rule.severity,
            file: file.filename,
            title: rule.title,
            message: rule.message,
          });
          break; // one finding per rule per file is enough
        }
      }
    }
  }

  for (const f of findings) {
    annotate(f.severity === 'error' ? 'error' : 'warning', f);
  }
  setOutput('findings', JSON.stringify(findings));

  const errors = findings.filter((f) => f.severity === 'error');
  log('');
  log(`Deploy Guard: ${findings.length} finding(s) — ${errors.length} error, ${findings.length - errors.length} warn.`);

  if (failOn === 'off') return;
  if (failOn === 'warn' && findings.length > 0) process.exit(1);
  if (failOn === 'error' && errors.length > 0) process.exit(1);
}

run().catch((e) => {
  log(`::error::Deploy Guard failed: ${e.message}`);
  process.exit(1);
});
