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
| Core messaging/auth/privacy | `main` has extensive server, session, privacy and scheduled-message code; compare exact security branch diffs for regressions | Partial source review; branch-by-branch review pending |
| TURN credentials and deployment | `main` already contains `src/utils/turnCredentials.js`, `src/app/api/calls/turn-credentials/route.ts`, `.env.example` TURN keys, and `tests/turn-credentials.test.mjs` | Feature is present on baseline; PR #9 is not a reason to re-add files blindly. Verify runtime/deployment deltas and tests |
| Call reconnect/ICE recovery | `main` `CallOverlay.tsx` contains reconnecting/failed states, persisted call state, ICE restart, stats/quality, and `tests/call-reliability.test.mjs` exists | Major reliability feature already present on baseline; compare exact remaining server/client differences from #10 |
| Proxy/IP trust | `main` defaults `TRUSTED_PROXY_COUNT` to `0`, trusts forwarding headers only when explicitly configured, and checks `X-Real-IP` only when configured | Baseline behavior is conservative; PR #5's different default and indexing need security review, do not apply wholesale |
| Runner/install flow | `deploy/stargram-runner.sh` exists only on `feature/setup-wizard-runner`, not `main`; current `main` `test:deployment` syntax-checks only `setup-vps.sh` and `deploy-vps.sh` | Runner is not in baseline; also baseline setup script says Node.js 20 while `package.json` requires Node >=22 <23. Must fix/verify before install |
| File upload / ClamAV | `main` has presign/verify/access/delete paths and pending-upload storage helpers; CI claims need rechecked against latest runs | Partial source review; test fail-closed paths and security branch deltas pending |
| Tests and CI | Baseline `package.json` includes TURN, call reliability, backlog, security, multi-node and Playwright WebRTC test scripts; `test:deployment` omits the runner | Some work from feature branches is already on `main`; verify workflow execution and actual runtime behavior before calling complete |

## Rules while auditing

- Keep `main` unchanged during this audit.
- Do not merge every branch or use branch names as evidence of feature completeness.
- Do not claim a test passed unless a corresponding CI/local result is observed.
- Do not run a production installer on Codespaces.
- Before deployment, use one reviewed candidate ref and verify its exact commit SHA.
- Any actual integration should be a separate, reviewable change with test evidence and a rollback path.

## Next action

Continue the audit from the exact `stargram_clone` snapshot: inspect current implementations and compare focused branch diffs one area at a time. Update this matrix with concrete file paths, tests, findings, and evidence before changing application code.


## Source-level audit findings (first pass, 2026-10-12)

### Confirmed present on the `stargram_clone` baseline

- TURN credential helper: `src/utils/turnCredentials.js`.
- Authenticated TURN endpoint: `src/app/api/calls/turn-credentials/route.ts`. Current baseline validates token subject/session version/session id, checks an active session record, rate-limits requests, and disables caching.
- TURN tests: `tests/turn-credentials.test.mjs`.
- Call recovery client code: `src/components/CallOverlay.tsx` includes `reconnecting` / `failed` states, persisted call identity, ICE restart, network online/offline listeners, and connection-quality reporting.
- Call reliability contract tests: `tests/call-reliability.test.mjs`.
- Real-browser WebRTC test: `tests/webrtc.e2e.spec.mjs`.
- Proxy trust default: `TRUSTED_PROXY_COUNT` defaults to `0`, which avoids trusting forwarded client headers on a direct deployment by default.

### Confirmed missing or inconsistent on the baseline

- `deploy/stargram-runner.sh` is not present on `main`; it exists on `feature/setup-wizard-runner`.
- `package.json` requires Node `>=22.0.0 <23`, but `deploy/setup-vps.sh` currently logs/installs Node.js 20. This is a deployment blocker until the installer is corrected and validated.
- `npm run test:deployment` on baseline checks shell syntax only for `deploy/setup-vps.sh` and `deploy/deploy-vps.sh`, not the interactive Runner.
- Existing TURN and call-reliability code means PR #9/#10 must be reviewed for only genuinely missing changes, fixes, or tests; re-applying the full PRs would risk duplicating or overwriting newer baseline logic.

### Security review note: proxy PR #5

The branch patch changes the default trusted proxy count from `0` to `1` and changes how the selected forwarded IP is indexed. The current baseline is safer for direct exposure by default. Do not apply this patch wholesale. First confirm the exact reverse-proxy topology and add tests for forged `X-Forwarded-For`, too-short chains, and both direct and proxied deployments.

### Still not yet concluded

This is a first-pass, file-backed audit—not the complete review of every branch. No feature branch has been merged into `stargram_clone` or `main` as part of this first pass. Next review the remaining security/backlog branches by their changed files, run/inspect current CI, and record concrete defects and conflicts before any code integration.


## Second-pass source comparison (2026-10-12)

### CI evidence observed

- Latest Validate run for feature/setup-wizard-runner at 0e625ec663cc3425b7ed7eb9f9a062fc8bec0da4: **success** (run https://github.com/spaidey01/my-telegram/actions/runs/38230850452).
- Latest Stargram service integration run for that same commit: **success** (run https://github.com/spaidey01/my-telegram/actions/runs/38230850401).
- The integration workflow's earlier run at 1e65e256... also passed. These are CI results on the runner branch, not proof of a real VPS installation or public two-network TURN call.

### Concrete branch risks found

| Branch / PR | Files inspected | Finding | Audit decision |
|---|---|---|---|
| fix-trusted-proxy-ip / PR #5 | src/utils/rateLimit.ts | Changes default TRUSTED_PROXY_COUNT from 0 to 1. This can trust spoofable forwarding data in direct deployments or a topology that does not sanitize headers. The current main version deliberately opts in only when proxy count is configured. | Do not cherry-pick/merge as-is. Add spoofing and topology tests first. |
| security-hardening-v2 | src/app/api/files/access/route.ts, delete/route.ts, verify/route.ts | The branch versions are older/simpler than baseline. Compared with main, the access route lacks the current session/privacy/sticker access logic; delete lacks current CSRF/session checks; verify lacks current CSRF/session handling and newer promotion logic. | Whole-branch integration risks security regressions and loss of current features. Extract only a specifically demonstrated fix, if any. |
| security-fixes-upload-dm-link-v2 | src/app/api/files/presign/route.ts, verify/route.ts, users/find/route.ts, server/index.js | The branch is based on a substantially older implementation: the compared server file is 793 lines vs 2256 lines on main; its upload routes lack newer session/CSRF controls present on main, and its user-find implementation predates current privacy/session behavior. | Do not merge branch wholesale. File-by-file transplant would require fresh tests and security review. |
| fix/audit-p0 | src/utils/rateLimit.ts, server/index.js and changed-file list | Its rate limiter has older Redis connection handling (no current connection failure reset/fail-closed recovery structure) and it diverges from the current large server implementation. | Do not merge wholesale; review each individual finding against current main. |
| feature/setup-wizard-runner / PR #12 | deploy/stargram-runner.sh, src/utils/productionConfig.js, workflows, package scripts | Runner is not on main. It has passing CI syntax/config and service integration runs at its latest SHA, but it has not been executed against a real VPS. It also uses floating container tags such as quay.io/minio/minio:latest and quay.io/minio/mc:latest, so install reproducibility is not pinned. | Candidate for focused review, not automatic approval. Pin images, review firewall/proxy/backup behavior, and test on disposable VPS before production. |
| feature/turn-system / PR #9 and feature/call-reliability / PR #10 | TURN helper/route, call overlay and tests | Main already contains these major features and test files. The TURN PR diff includes an older package.json engine declaration (>=20.9.0 <21) in its historical context, unlike current main's Node 22 requirement. PR #10 targets #9, not main. | Compare only the actual delta to main; do not merge either PR wholesale. |

### Confirmed deployment compatibility defect

package.json on main declares Node.js >=22.0.0 <23, but deploy/setup-vps.sh explicitly installs and requires Node.js 20. The script then runs npm ci and npm run build; this version mismatch can prevent a valid production build or run unsupported dependencies. Fix the installer to use Node 22 and test it before deployment.

### What these findings do and do not establish

- The findings above are source-level comparisons of selected high-risk files, not an exhaustive review of every line in every branch.
- Passing CI on the runner branch does not prove production network/firewall/DNS/TLS setup or successful WebRTC between independent networks.
- No branch was merged and main was not changed during this audit.
- Remaining work: inspect the rest of the branch list and PR diffs, check all security-sensitive route/server changes, validate test coverage against behavior rather than token-presence tests, and record each finding with severity and a reproducible test before any integration.


## Third-pass audit of remaining security branches (2026-10-12)

| Branch | Compared against main | Evidence-based disposition |
|---|---|---|
| audit-fixes | server/index.js (437 lines vs 2256 on main), auth/currentuser and users/find routes | Stale implementation. The branch server is far behind current Socket.IO/session/call/security functionality; currentuser route lacks newer CSRF, rate-limit and session-version checks visible on main. Do not merge wholesale. |
| production-fixes | server/index.js (739 lines vs 2256 on main), auth/files and package/workflow changes | Broad, stale fork of production code. Its large apparent diff is not a ready-made patch; merging risks deleting many current features and security fixes. Mine individual fixes only after reproducing the underlying issue. |
| security-hardening | auth/login, auth/register, TokenDecoder, server and upload utilities | The branch versions of login/register lack current rate limiting, CSRF and session logic. Its TokenDecoder calls verify without the current explicit HS256 algorithm restriction and does not reject socket-scoped tokens in the same way as main. Do not merge wholesale; main has the stronger/current implementation in these inspected areas. |
| restore-security-hardening | GitHub compare reports no changed files against main despite divergent commit history | No content delta surfaced in the compare response; likely redundant in tree content. Verify branch tree SHA if considering cleanup; no merge is needed to recover code that is already identical. |
| security-hardening-v2 | file access/delete/verify, proxy and file schema | Several route files are older than main and omit current session/privacy/CSRF behavior. The proxy and schema had no text differences in the sampled comparison, but that does not make the rest of the branch safe. |
| security-fixes-upload-dm-link (v1) and (v2) | presign/verify, users/find, server | Both diverge from current main. v2 has the same older server architecture and predates current session/CSRF protections. Treat as historical evidence, not merge candidates. |
| fix/audit-p0 | 16 changed files including server, file access, rate limiter, UI and schemas | Divergent and older. The current main rate limiter includes Redis connection-failure handling and fail-closed behavior absent from the inspected branch version. Review each claimed P0 against current main rather than reapplying the branch. |

## Branch-level feature inventory (not a merge recommendation)

- feature/turn-system: TURN setup/credential/call changes are largely already present on main; check the exact 10-file delta before considering any isolated patch.
- feature/call-reliability: call recovery is substantially represented on main, but this branch also changes server/index.js and many UI files. PR #10 is based on feature/turn-system rather than main, so its PR diff includes dependency-branch content; do not treat every changed line as unique call-reliability work.
- feature/backlog-completion: comparison reports 590 commits ahead and 4 behind, with many deployment, docs, tests and application files. Main already contains much of the named backlog and test surface, but the histories are divergent; perform a content-by-content diff rather than merging this branch.
- feature/setup-wizard-runner: 38 commits ahead and no commits behind in the earlier comparison; the runner/workflows are the clearest missing standalone capability. Latest Validate and service-integration CI runs at 0e625ec663cc3425b7ed7eb9f9a062fc8bec0da4 both succeeded.
- fix-trusted-proxy-ip: single-file patch only, but the changed default is a security-sensitive behavior and should not be accepted without proxy-chain tests.
- audit-fixes, production-fixes, security-hardening, security-hardening-v2, security-fixes-upload-dm-link, security-fixes-upload-dm-link-v2 and fix/audit-p0: current main has moved substantially beyond these branches; these are not safe whole-branch merge candidates.

## Test-quality observation

tests/call-reliability.test.mjs checks for the presence of expected source-code strings. This is useful as a regression smoke check, but it does not prove that reconnect, ICE restart, state rollback, multi-node recovery or call cleanup actually behave correctly at runtime. Keep it, but rely on browser-level/runtime tests for behavior and expand those tests for the failure/reconnect cases. The Playwright WebRTC test and service integration CI are stronger evidence, but neither substitutes for a real public VPS/network verification.

## Current conclusion

The initial branch audit now has concrete source-level evidence across all named branch families, and identifies multiple stale branches that would regress main if merged wholesale. The main confirmed deployment blocker is the Node 20 vs Node 22 mismatch in deploy/setup-vps.sh. The setup runner is a separate feature candidate with passing CI but still needs a disposable-VPS run and operational review. This audit is still not a claim that every line of all 14 branches has received a full manual review; before release integration, complete the remaining per-file diff and behavior tests, then produce a prioritized patch list with reproduction evidence.


## Decision update — rebuild on the audited baseline (2026-10-12)

The project owner prefers rebuilding/revalidating needed capabilities on the current baseline instead of merging the divergent feature/security branches wholesale. Adopt this as the working strategy:

1. Keep `stargram_clone` as the immutable reference snapshot for the audit stage; do not turn it into the development branch.
2. Keep `main` unchanged until an explicitly approved change is ready.
3. Do not merge the old divergent branches wholesale. Treat them as historical reference only; extract a requirement or test idea only when useful.
4. Implement each genuinely needed capability as a small, reviewable patch based on current main, with regression tests and evidence.
5. First priority is the verified Node.js 20-vs-22 installer mismatch. Next priorities are behavior-level tests for auth/session, upload/file access, trusted proxy IP, TURN and call recovery, followed by a disposable-VPS installation rehearsal.
6. Before each implementation, confirm the current main code does not already provide the behavior. Avoid duplicate implementations and avoid replacing newer code with older branch copies.
7. After a patch passes relevant CI and review, present its exact files, commit SHA, test results, risk and rollback approach for approval before changing main or merging.

This decision changes the integration strategy, not the feature inventory: existing working capabilities on main should be retained and verified, not rewritten merely for the sake of rebuilding.
