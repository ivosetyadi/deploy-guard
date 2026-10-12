# 🛡️ Deploy Guard

A GitHub Action that **blocks a pull request when it carries dangerous deploy patterns** — before they reach production.

Built from real postmortems: a Flyway migration that locked 6M rows on an unscheduled restart, a `docker restart` that took a service down for an hour, a `.git/` folder leaked to a public host. Deploy Guard encodes those lessons as checks.

## What it catches

| Rule | Severity | Example |
|------|----------|---------|
| Mass `UPDATE`/`DELETE` without `LIMIT` | error | `UPDATE users SET phone = norm(phone) WHERE 1=1;` |
| Destructive DDL (`TRUNCATE`/`DROP TABLE`/`ALTER TABLE`) | error | `DROP TABLE orders;` |
| Unguarded `docker restart`/`stop` in deploy scripts | warn | `docker restart kpt-services` |
| Hardcoded secret / private key | error | `api_key = "sk-live-..."` |
| `.git/` included in a deploy/sync path | error | `rsync src/.git/ user@host:public_html` |

## Usage

```yaml
# .github/workflows/deploy-guard.yml
name: Deploy Guard
on: pull_request
permissions:
  contents: read
  pull-requests: read
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: ivosetyadi/deploy-guard@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          fail-on: error   # error | warn | off
```

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `config` | `.deployguard.yml` | Config file path (reserved for custom rules). |
| `fail-on` | `error` | Minimum severity that fails the check. |
| `comment` | `true` | Post findings as a PR comment. |

## Status

🚧 **In progress** — core rule engine works (zero-dependency, Node 20). Config-file custom rules and PR comments land next. Part of [DevGuard Tools](https://ivosetyadi.github.io).

## License

MIT © Ivo Setyadi
