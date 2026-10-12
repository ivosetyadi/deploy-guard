// Deploy Guard — zero-dependency GitHub Action (Node 20).
// Scans changed files in a PR for dangerous deploy patterns, annotates the
// exact lines, posts a single (updated) PR comment, and fails per `fail-on`.
// Uses only Node built-ins + global fetch — no bundling/npm install required.

const fs = require('fs');

// ---- Workflow command helpers -------------------------------------------------
const log = (m) => process.stdout.write(m + '\n');
const annotate = (level, f) => {
  const loc = f.line ? `,line=${f.line}` : '';
  log(`::${level} file=${f.file}${loc},title=${f.title}::${f.message}`);
};
const setOutput = (name, val) => {
  const out = process.env.GITHUB_OUTPUT;
  if (out) fs.appendFileSync(out, `${name}<<__EOF__\n${val}\n__EOF__\n`);
};

const RULES = require('./index.rules.js');

// ---- Minimal config loader (subset of YAML, no dependency) --------------------
// Supports:  fail-on: error   |   ignore:\n  - path   |   disable:\n  - rule-id
function loadConfig() {
  const cfg = { 'fail-on': null, ignore: [], disable: [] };
  const path = process.env.INPUT_CONFIG || '.deployguard.yml';
  let text;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch {
    return cfg; // no config file — use defaults
  }
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const val = kv[2].trim().replace(/^["']|["']$/g, '');
      if (key === 'fail-on') cfg['fail-on'] = val.toLowerCase();
      else if (key === 'ignore' || key === 'disable') current = key;
      else current = null;
      if (key === 'fail-on' && val) current = null;
      continue;
    }
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item && current) {
      cfg[current].push(item[1].trim().replace(/^["']|["']$/g, ''));
    }
  }
  return cfg;
}

// ---- Patch parsing: map each added line to its line number in the new file ----
function addedLinesWithNumbers(patch) {
  const out = [];
  let newLine = 0;
  for (const raw of patch.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      out.push({ text: raw.slice(1), line: newLine });
      newLine++;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      // removed line — does not advance new-file counter
    } else {
      newLine++; // context line
    }
  }
  return out;
}

// ---- GitHub API helpers -------------------------------------------------------
const GH = 'https://api.github.com';
function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'deploy-guard',
  };
}

async function getPrContext() {
  const token = process.env.GITHUB_TOKEN || process.env.INPUT_TOKEN;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('No GITHUB_EVENT_PATH — run this on a pull_request event.');
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr) {
    log('::notice::Deploy Guard only runs on pull_request events. Skipping.');
    return null;
  }
  return { token, repo: process.env.GITHUB_REPOSITORY, number: pr.number };
}

async function getChangedFiles(ctx) {
  const files = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${GH}/repos/${ctx.repo}/pulls/${ctx.number}/files?per_page=100&page=${page}`,
      { headers: ghHeaders(ctx.token) }
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    files.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return files;
}

const COMMENT_MARKER = '<!-- deploy-guard -->';

async function upsertComment(ctx, body) {
  // Find an existing Deploy Guard comment and update it, else create one.
  const listRes = await fetch(
    `${GH}/repos/${ctx.repo}/issues/${ctx.number}/comments?per_page=100`,
    { headers: ghHeaders(ctx.token) }
  );
  if (listRes.ok) {
    const comments = await listRes.json();
    const existing = comments.find((c) => c.body && c.body.includes(COMMENT_MARKER));
    if (existing) {
      await fetch(`${GH}/repos/${ctx.repo}/issues/comments/${existing.id}`, {
        method: 'PATCH',
        headers: ghHeaders(ctx.token),
        body: JSON.stringify({ body }),
      });
      return;
    }
  }
  await fetch(`${GH}/repos/${ctx.repo}/issues/${ctx.number}/comments`, {
    method: 'POST',
    headers: ghHeaders(ctx.token),
    body: JSON.stringify({ body }),
  });
}

function renderComment(findings) {
  if (findings.length === 0) {
    return `${COMMENT_MARKER}\n### 🛡️ Deploy Guard — ✅ no risky patterns found\n\nNothing to flag in this PR.`;
  }
  const rows = findings
    .map(
      (f) =>
        `| ${f.severity === 'error' ? '🔴 error' : '🟡 warn'} | \`${f.file}\`${
          f.line ? `:${f.line}` : ''
        } | ${f.title} | ${f.message} |`
    )
    .join('\n');
  const errors = findings.filter((f) => f.severity === 'error').length;
  return (
    `${COMMENT_MARKER}\n### 🛡️ Deploy Guard — ${errors} error, ${findings.length - errors} warn\n\n` +
    `| Severity | Location | Rule | Why it matters |\n|---|---|---|---|\n${rows}\n\n` +
    `<sub>Configure via \`.deployguard.yml\`. Part of [DevGuard Tools](https://ivosetyadi.github.io).</sub>`
  );
}

// ---- Main ---------------------------------------------------------------------
function isIgnored(filename, ignore) {
  return ignore.some((p) => p && filename.includes(p));
}

async function run() {
  const ctx = await getPrContext();
  if (!ctx) return;

  const cfg = loadConfig();
  const failOn = (cfg['fail-on'] || process.env.INPUT_FAIL_ON || 'error').toLowerCase();
  const disabled = new Set(cfg.disable);
  const activeRules = RULES.filter((r) => !disabled.has(r.id));

  const files = await getChangedFiles(ctx);
  const findings = [];
  for (const file of files) {
    if (file.status === 'removed' || !file.patch) continue;
    if (isIgnored(file.filename, cfg.ignore)) continue;
    const added = addedLinesWithNumbers(file.patch);
    for (const rule of activeRules) {
      if (!rule.appliesTo.test(file.filename)) continue;
      const hit = added.find((a) => rule.test(a.text));
      if (hit) {
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          file: file.filename,
          line: hit.line,
          title: rule.title,
          message: rule.message,
        });
      }
    }
  }

  for (const f of findings) annotate(f.severity === 'error' ? 'error' : 'warning', f);
  setOutput('findings', JSON.stringify(findings));

  if ((process.env.INPUT_COMMENT || 'true') === 'true') {
    try {
      await upsertComment(ctx, renderComment(findings));
    } catch (e) {
      log(`::warning::Could not post PR comment: ${e.message}`);
    }
  }

  const errors = findings.filter((f) => f.severity === 'error');
  log('');
  log(
    `Deploy Guard: ${findings.length} finding(s) — ${errors.length} error, ${
      findings.length - errors.length
    } warn. (fail-on=${failOn})`
  );

  if (failOn === 'off') return;
  if (failOn === 'warn' && findings.length > 0) process.exit(1);
  if (failOn === 'error' && errors.length > 0) process.exit(1);
}

if (require.main === module) {
  run().catch((e) => {
    log(`::error::Deploy Guard failed: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { loadConfig, addedLinesWithNumbers, isIgnored, renderComment, RULES };
