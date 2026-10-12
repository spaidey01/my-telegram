# Stargram Stage Status & Branch Audit

> **Current phase: Stage 1 — baseline inventory and integration audit.**
> This file is deliberately explicit so nobody mistakes the backup snapshot for a release-ready integrated build.

## Safety snapshot

- Repository: `spaidey01/my-telegram`
- Backup branch: `stargram_clone`
- Snapshot source: `main` at `b40f6f37783f26a54e37e3e3dc952de21190f07e`
- Snapshot created: 2026-10-12
- Purpose: preserve the current `main` code before evaluating branch-only changes.
- This snapshot does not merge any feature branch and does not modify `main`.
- Treat this branch as a backup/audit baseline, **not** as a verified release.

## User-requested workflow

1. Preserve the current project as `stargram_clone`.
2. Mark the stage clearly in the repository.
3. Compare each relevant branch against the baseline and identify features already present on `main`, features missing, and features that partially overlap.
4. Review branch changes for bugs, security regressions, conflicts, and compatibility with the current code.
5. Only after review, propose a safe integration order and run tests. Do not merge into `main` without explicit approval.

## Initial evidence from GitHub

Open PRs observed on 2026-10-12:

| PR | Branch | Goal | Initial status |
|---|---|---|---|
| [#5](https://github.com/spaidey01/my-telegram/pull/5) | `fix-trusted-proxy-ip` | Trusted proxy client IP selection | Open; reported merge state was dirty |
| [#9](https://github.com/spaidey01/my-telegram/pull/9) | `feature/turn-system` | TURN credentials/configuration and WebRTC integration | Open; reported merge state was dirty |
| [#10](https://github.com/spaidey01/my-telegram/pull/10) | `feature/call-reliability` | Call reconnect/ICE recovery and reliability | Open; targets #9's branch, not `main` |
| [#12](https://github.com/spaidey01/my-telegram/pull/12) | `feature/setup-wizard-runner` | Interactive setup runner | Open draft; targets `main` |

These statuses are an initial inventory, not a verdict that every change is needed or safe. PR mergeability can change as the base moves.

## Important comparison caveat

Git commit ancestry and file diffs are not the same as feature presence. A branch can show hundreds of commits ahead because of divergent history, even when much of its content is already present on `main`. Therefore, do not merge a whole branch just because it has a feature name. Review the actual file-level diff and the current implementation first.

The branch `feature/backlog-completion` has a large/diverged history relative to `main`; it must not be merged wholesale based only on commit counts. The focused branches `feature/turn-system` and `feature/call-reliability` form a dependency chain: #10 is based on #9.

## First-pass findings to verify

- The current `main` `package.json` already declares tests for TURN, call reliability, backlog, security, multi-node Socket.IO, and browser WebRTC. This is evidence that some work from older feature branches may already have been integrated. Each implementation still needs source-level comparison.
- The current `main` `package.json` has `test:deployment` checking only `deploy/setup-vps.sh` and `deploy/deploy-vps.sh`; it does not include `deploy/stargram-runner.sh`. Runner validation is currently branch-specific and must be assessed before deciding how to bring it into the release.
- Production configuration in `.env.example` includes MongoDB, Redis, S3-compatible storage, TURN, trusted proxy count, and ClamAV settings. Verify each corresponding implementation and deployment setup rather than assuming environment variables alone prove a feature works.
- A previous audit document claims extensive security and call coverage on a different HEAD. Treat that document as a lead to verify against this baseline and current CI, not as independent proof of the current `main`.

## Audit matrix

| Area | What to compare | Current status |
|---|---|---|
| Core messaging/auth/privacy | `main` versus backlog/security branches; review current source, not branch name | Pending source review |
| TURN credentials and deployment | `main` versus #9, including env/config/docs/tests | Pending detailed file diff |
| Call reconnect/ICE recovery | `main` versus #10 and its #9 base | Pending detailed file diff |
| Proxy/IP trust | `src/utils/rateLimit.ts` and actual reverse-proxy topology | Pending security review |
| Runner/install flow | `deploy/stargram-runner.sh`, service units, package test scripts and CI | Runner absent from baseline package syntax test; integration pending |
| File upload / ClamAV | presign, verify, access, delete routes and scanner fail-closed behavior | Pending source review |
| Tests and CI | workflow coverage, dependency lockfile, real browser/media scope | Pending complete CI review |

## Rules while auditing

- Keep `main` unchanged during this audit.
- Do not merge every branch or use branch names as evidence of feature completeness.
- Do not claim a test passed unless a corresponding CI/local result is observed.
- Do not run a production installer on Codespaces.
- Before deployment, use one reviewed candidate ref and verify its exact commit SHA.
- Any actual integration should be a separate, reviewable change with test evidence and a rollback path.

## Next action

Continue the audit from the exact `stargram_clone` snapshot: inspect current implementations and compare focused branch diffs one area at a time. Update this matrix with concrete file paths, tests, findings, and evidence before changing application code.
