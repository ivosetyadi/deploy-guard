// Offline test suite for Deploy Guard. No network, no live PR.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadConfig, addedLinesWithNumbers, isIgnored, renderComment, RULES } = require('../dist/index.js');

let pass = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  pass++;
};

// --- Rules -------------------------------------------------------------------
const ruleCases = [
  ['UPDATE users SET phone = norm(phone) WHERE active = 1;', 'users.sql', 'mass-dml-no-limit', true],
  ['UPDATE users SET x=1 WHERE id=1 LIMIT 1;', 'users.sql', 'mass-dml-no-limit', false],
  ['DROP TABLE orders;', 'v2.sql', 'destructive-ddl', true],
  ['docker restart kpt-services', 'deploy.sh', 'unguarded-restart', true],
  ['const api_key = "sk-live-abcd1234efgh";', 'app.js', 'committed-secret', true],
  ['rsync -a src/.git/ user@host:/var/www/public_html', 'deploy.sh', 'git-dir-leak', true],
  ['const total = a + b;', 'app.js', null, false],
];
for (const [line, file, ruleId, expected] of ruleCases) {
  const hit = ruleId
    ? RULES.find((r) => r.id === ruleId).appliesTo.test(file) && RULES.find((r) => r.id === ruleId).test(line)
    : RULES.some((r) => r.appliesTo.test(file) && r.test(line));
  ok(hit === expected, `rule: ${line} (${file}) expected ${expected}`);
}

// --- addedLinesWithNumbers ---------------------------------------------------
const patch = [
  '@@ -1,2 +1,4 @@',
  ' context line',
  '+DROP TABLE orders;',
  '+SELECT 1;',
  '-removed',
  ' tail',
].join('\n');
const added = addedLinesWithNumbers(patch);
ok(added.length === 2, 'patch: 2 added lines');
ok(added[0].text === 'DROP TABLE orders;' && added[0].line === 2, `patch: first added at line 2 (got ${added[0].line})`);
ok(added[1].line === 3, `patch: second added at line 3 (got ${added[1].line})`);

// --- loadConfig --------------------------------------------------------------
const tmp = path.join(__dirname, '.tmp.deployguard.yml');
fs.writeFileSync(tmp, 'fail-on: warn\nignore:\n  - test/fixtures/\n  - docs/\ndisable:\n  - unguarded-restart\n');
process.env.INPUT_CONFIG = tmp;
const cfg = loadConfig();
ok(cfg['fail-on'] === 'warn', `config: fail-on=warn (got ${cfg['fail-on']})`);
ok(cfg.ignore.length === 2 && cfg.ignore[0] === 'test/fixtures/', 'config: ignore list parsed');
ok(cfg.disable.includes('unguarded-restart'), 'config: disable list parsed');
fs.unlinkSync(tmp);
delete process.env.INPUT_CONFIG;

// missing config → defaults
process.env.INPUT_CONFIG = path.join(__dirname, 'does-not-exist.yml');
const dflt = loadConfig();
ok(dflt['fail-on'] === null && dflt.ignore.length === 0, 'config: missing file → defaults');
delete process.env.INPUT_CONFIG;

// --- isIgnored ---------------------------------------------------------------
ok(isIgnored('docs/readme.md', ['docs/']) === true, 'ignore: matches docs/');
ok(isIgnored('src/app.js', ['docs/']) === false, 'ignore: non-match');

// --- renderComment -----------------------------------------------------------
ok(renderComment([]).includes('no risky patterns'), 'comment: clean message');
const c = renderComment([{ severity: 'error', file: 'v.sql', line: 3, title: 'X', message: 'Y' }]);
ok(c.includes('deploy-guard') && c.includes('v.sql') && c.includes(':3'), 'comment: renders finding row');

console.log(`✓ ${pass} assertions passed`);
