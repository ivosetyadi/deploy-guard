// Shared rule set for Deploy Guard. Required by both dist/index.js and the test harness.
// Each rule inspects an added line (with the leading '+' already stripped).
// severity: error (fails the check) | warn (annotates only)
module.exports = [
  {
    id: 'mass-dml-no-limit',
    severity: 'error',
    title: 'Mass UPDATE/DELETE without LIMIT',
    appliesTo: /\.(sql)$/i,
    test: (line) =>
      /\b(update|delete)\b/i.test(line) &&
      /\bwhere\b/i.test(line) &&
      !/\blimit\b/i.test(line),
    message:
      'UPDATE/DELETE with a WHERE but no LIMIT can lock millions of rows. Chunk it or use a generated column.',
  },
  {
    id: 'destructive-ddl',
    severity: 'error',
    title: 'Destructive DDL in migration',
    appliesTo: /\.(sql)$/i,
    test: (line) => /\b(truncate|drop\s+table|alter\s+table)\b/i.test(line),
    message:
      'TRUNCATE / DROP TABLE / ALTER on a populated table is irreversible at scale. Review lock scope and backup.',
  },
  {
    id: 'unguarded-restart',
    severity: 'warn',
    title: 'docker restart/stop in deploy script',
    appliesTo: /\.(sh|ya?ml|bat|ps1)$/i,
    test: (line) => /docker\s+(restart|stop)\b/i.test(line),
    message:
      'Restarting a shared service can trigger pending migrations or cascade failures. Verify backup + pending migrations first.',
  },
  {
    id: 'committed-secret',
    severity: 'error',
    title: 'Possible hardcoded secret',
    appliesTo: /.*/,
    test: (line) =>
      /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(line) ||
      /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line),
    message: 'Looks like a credential committed in source. Move it to a secret store / env.',
  },
  {
    id: 'git-dir-leak',
    severity: 'error',
    title: '.git directory referenced in deploy path',
    appliesTo: /\.(sh|ya?ml|bat|ps1|conf)$/i,
    test: (line) =>
      /\.git\//.test(line) && /(sync|upload|cp|scp|rsync|deploy|public_html|www)/i.test(line),
    message: 'A deploy that includes .git/ exposes your full repo + history publicly. Exclude it.',
  },
];
