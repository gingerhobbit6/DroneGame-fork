# Continuous integration

The workflows in `.github/workflows/` check pull requests and pushes to `main`. They have been validated locally but have not yet run on GitHub with these changes. Nothing here deploys the application.

## Checks

| Workflow | Checks |
|---|---|
| `ci.yml` | Actionlint, production frontend build, all frontend tests with coverage and reference digests, backend tests with the existing 90% coverage gate, and map builder tests |
| `security.yml` | `npm audit`, `pip-audit` of both hashed Python lockfiles including development dependencies, and Gitleaks over reachable git history. Also runs weekly |
| `codeql.yml` | JavaScript and Python analysis on trusted `main`, scheduled and manual runs, where GitHub supports it |
| `dependabot.yml` | Weekly dependency update proposals for GitHub Actions, npm and both uv projects, with a 14-day cooldown |

Frontend tests use one worker, no file parallelism and a 4 GB Node heap. This keeps generated worlds from multiplying memory use. `reference.test.js` is part of the coverage run, so the recorded digests are checked without re-recording them.

Actions are pinned to full commit hashes. Downloaded Actionlint and Gitleaks binaries have pinned versions and SHA-256 checksums. Pull request jobs have `contents: read` and disable persisted checkout credentials. Only the CodeQL analysis job receives `security-events: write`, and it does not run pull request code.

## Private repository setup

The ordinary tests, dependency audits, Gitleaks and Dependabot configuration do not depend on GitHub Code Security. CodeQL and dependency review are conditional because this repository is private. After enabling those features for an eligible repository, set the repository Actions variable `ENABLE_CODE_SECURITY` to `true`. Public repositories also pass that condition.

After pushing these files:

1. Inspect the first CI and security workflow runs.
2. Configure GitHub branch rules to require the successful checks before merging. Workflow files alone do not enforce branch protection.
3. Enable eligible GitHub security features before opting into their conditional jobs.

The Python projects resolve only releases at least two weeks old (`exclude-newer = "2 weeks"`, a rolling window). Dependabot waits 15 days before proposing a Python release, so its proposals always fall inside that window. A fixed cutoff date, used until 10 November 2026, made every proposal newer than the date fail.

## Local verification

Run the frontend suite on its own, with the heap setting from [DEVELOPING.md](DEVELOPING.md#frontend-gently):

```sh
npm --prefix frontend run coverage -- --maxWorkers=1 --no-file-parallelism
npm --prefix frontend run build
uv --directory backend run --frozen pytest
uv --directory tools/mapbuild run --frozen pytest
```

Dependency audits need network access to vulnerability databases. The security workflow exports locked Python requirements and uses `pip-audit --require-hashes --disable-pip`, so the audit does not install or execute the project packages.
