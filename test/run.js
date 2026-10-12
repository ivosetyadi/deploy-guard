// Minimal offline test: exercise the rule set against sample lines.
// Mirrors the RULES in dist/index.js so the engine can be validated without a live PR.
const assert = require('assert');

const RULES = require('../dist/index.rules.js');

const cases = [
  ['UPDATE users SET phone = norm(phone) WHERE active = 1;', 'users.sql', 'mass-dml-no-limit', true],
  ['UPDATE users SET x=1 WHERE id=1 LIMIT 1;', 'users.sql', 'mass-dml-no-limit', false],
  ['DROP TABLE orders;', 'v2.sql', 'destructive-ddl', true],
  ['docker restart kpt-services', 'deploy.sh', 'unguarded-restart', true],
  ['const api_key = "sk-live-abcd1234efgh";', 'app.js', 'committed-secret', true],
  ['rsync -a src/.git/ user@host:/var/www/public_html', 'deploy.sh', 'git-dir-leak', true],
  ['const total = a + b;', 'app.js', null, false],
];

let pass = 0;
for (const [line, file, ruleId, expected] of cases) {
  const rule = RULES.find((r) => r.id === ruleId) || RULES.find((r) => r.appliesTo.test(file) && r.test(line));
  const hit = ruleId ? (RULES.find((r) => r.id === ruleId).appliesTo.test(file) && RULES.find((r) => r.id === ruleId).test(line)) : RULES.some((r) => r.appliesTo.test(file) && r.test(line));
  assert.strictEqual(hit, expected, `FAIL: ${line} (${file}) expected ${expected}`);
  pass++;
}
console.log(`✓ ${pass}/${cases.length} rule cases passed`);
