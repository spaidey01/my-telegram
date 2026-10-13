# Stargram Stage Status & Branch Audit

> **Current phase: Phase A — deployment/install integration on `stargram_clone`.**
> `stargram_clone` is the active development and test branch. `main` remains unchanged until implementation, full debugging, final verification, and explicit approval.

## Development branch and release safety

- Repository: `spaidey01/my-telegram`
- Active integration/test branch: `stargram_clone`
- Initial baseline: `main` at `b40f6f37783f26a54e37e3e3dc952de21190f07e`
- `stargram_clone` is now the branch for implementing, adapting, testing, and debugging all requested capabilities against the current codebase.
- `main` must remain unchanged until all seven priority areas are implemented/reviewed, a complete regression/debug pass and final checks are done, and the owner explicitly approves promotion.
- Do not treat any branch or CI result as production-ready without verifying the exact commit and test evidence.

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


## Decision update — active integration on `stargram_clone` (2026-10-12)

The owner has explicitly directed that `stargram_clone` be the active integration/test branch. All seven priority areas remain in scope. Adapt and validate capabilities against the current code rather than merging divergent branches wholesale. Keep `main` unchanged until all implementation and debugging is complete and the owner explicitly approves promotion. Phase A starts with the Node.js mismatch, interactive runner, runner CI, and deployment validation. Passing CI is not a substitute for a disposable-VPS rehearsal.


## Phase A execution log

- Started: 2026-10-12.
- Branch role corrected: `stargram_clone` is the active integration/test branch, not an immutable snapshot.
- Confirmed baseline issue: `deploy/setup-vps.sh` installs/requires Node.js 20 while `package.json` requires Node `>=22.0.0 <23`.
- Pending Phase A validation: shellcheck/syntax, production config tests, CI runs, runner review, and a disposable-VPS installation rehearsal. No VPS run is claimed by this report.


### Phase A implementation update (2026-10-12)

Changes committed on `stargram_clone`:

- `20043e38ac1906d82123943ded8774864495c0b2`: updated this status document so `stargram_clone` is the active integration/test branch; `main` remains protected.
- `3047ba7db26c62e3bb5e008518ee6633e8e2834e`: corrected `deploy/setup-vps.sh` from Node.js 20 to Node.js 22 and changed its default checkout branch to `stargram_clone`.
- `87dc1a8d58e4a19143ed4d994d818d0420c85a8f`: expanded `test:deployment` to include the runner (subsequently extended to run deployment config assertions).
- `813b550bd0e90d10588faaa7a4d47760d1127afe`: added `deploy/stargram-runner.sh` to the active branch, defaulting to `stargram_clone`, exposing configurable image refs and using version-tagged MongoDB/MinIO images instead of `latest`.
- `1ace0f71697308b5db3c93ba04dce17bfc83739f`: added runner validation workflow with push trigger on `stargram_clone`.
- `269102d8d32800f058ab1dc1646594a7ed1f1cf8`: added service integration workflow with push trigger on `stargram_clone`.

Additional checks are being added to keep the Node.js/branch/image assumptions from silently regressing. Remote CI and a real VPS run remain unverified at this point; the current container cannot reach GitHub to clone the branch, so local shell execution was not possible here. Do not consider Phase A complete until the GitHub Actions checks and a disposable-VPS rehearsal are confirmed.


- Follow-up fix `7c7ee301920c872bb4a79b983f5d044863943653`: made `deploy/setup-vps.sh` create/reset the local tracking branch from `origin/stargram_clone` after fetching, so an existing checkout without a local `stargram_clone` branch does not fail at checkout.
- Follow-up regression assertion `a146b075b1927dc40efa4307cd7a3c659e365708`: deployment config tests now assert this checkout behavior as well.
- Source/config checks via GitHub file reads confirm: Node.js engine is `>=22.0.0 <23`; both installers default to `stargram_clone`; runner images no longer use `latest`; validation and integration workflows trigger on `stargram_clone`; `test:deployment` includes syntax checks plus the new deployment config tests.
- Verification boundary: these are source-level assertions only. The current combined commit status endpoint reports Vercel deployment contexts as pending and does not expose the GitHub Actions job result; local clone/testing was blocked by this environment's DNS/network inability to reach github.com. Therefore no shellcheck, npm test, full CI, or real VPS pass is claimed yet. Phase A remains in progress until those checks are observed and a disposable-VPS rehearsal is done.


### Phase A follow-up — installer compatibility and non-destructive updates (2026-10-12)

Additional source-level issues found while continuing review and fixes committed on `stargram_clone`:

- `e7e8d492554e8832f98250bb4d5170aba33d8cc9`: production URL validation now permits local S3-compatible endpoints over HTTP only on loopback, which is needed by the automatic MinIO setup and the LocalStack CI service. Public app URLs remain HTTPS-only unless the explicit `STARGRAM_ALLOW_HTTP=true` test-mode switch is set.
- `7359a31cd581706c36d8df6d6f99d279efac11e3`: added regression tests for explicit HTTP test mode, loopback S3 endpoints, and rejection of non-loopback HTTP S3.
- `cc23121dbf55893645442fc04624502d7462cd61`: `deploy/deploy-vps.sh` now defaults to `stargram_clone`.
- `bc23e2c1dad952a06b175b8adf451f11028534ec` and `24928fc97356713974b66a19d2af2f2ebbde3c89`: runner checkout handling was reviewed and adjusted so a clean existing checkout can select/create the test branch and advance only with a fast-forward; dirty working trees are refused.
- `11d7e7992ebb45bb6a627a013675d562f11a1bdf`: validation workflow path filters now include both VPS scripts and deployment config tests.
- `c92a7b49c59af968537c92d942bf4132b5ac33a7`: firewall setup falls back to allowing SSH port 22 if it cannot infer the active SSH port from `SSH_CONNECTION`.
- `4921c8b336097dd886c2fe21b41ca06aae59d047` and `deaa12bf7f6f8cd8d18c77dd6fcab56825191c0b`: setup and update scripts now refuse dirty checkouts, fetch the configured branch, create the local tracking branch if needed, and use fast-forward-only updates instead of forcibly replacing the checkout.
- `c82a931025d0a2b91181543ff0c5be9528051d69`: deployment source assertions expanded to cover safe branch selection/update behavior.

Source reads confirm these changes are present on `stargram_clone`. The current combined-status API still only exposes pending Vercel contexts for the latest commit and does not give the Actions job result. This environment also cannot clone/fetch GitHub for local execution. No successful ShellCheck/npm/Actions/VPS run is claimed. Phase A is still in progress; the next gate is observing the actual Actions workflow result and running the installer on a disposable Debian/Ubuntu VPS.


- `2dbf6e311f2d70f7722b74bbc32101031409111b`, `a272d75204e782aa97d5fc1ffee84249ccabdad6`, `c04d3fe0bf73c002b03b37d16678109ee5886608`, and `e8dd03241bb02df629da9f373ffb18cb1deaa04f`: deployment scripts no longer evaluate the environment file as shell code; they parse KEY=VALUE lines and pass the values explicitly to validation/build. This also fixes the setup script trying to use the build environment before the environment file had been parsed. The setup script now builds only after production config validation passes.
- `180383e3317fe5c265385051157e9fdabc0df823` and `fe7e1e6c4f1dd745438b9f8645541063a02db023`: deployment source tests now include safe env-file parsing and verify production env is passed to the build.
- `850bbae819f94c765672a2c87b1877d9d0dc02a2`: validation workflow also triggers for changes to the deployment config test in pull requests targeting main.
- Final evidence boundary remains unchanged: GitHub file reads verify the edits, but no ShellCheck, Node test, build, GitHub Actions success, or VPS install has been executed/confirmed in this session. Do not promote this branch to main until those checks are green.

## Phase A continuation — 2026-10-13

- Reviewed actual GitHub Actions run history on `stargram_clone`, rather than relying only on source reads.
- Runner validation succeeded at `e8dd03241bb02df629da9f373ffb18cb1deaa04f` (run [38237351209](https://github.com/spaidey01/my-telegram/actions/runs/38237351209)); ShellCheck, deployment syntax/config tests, and production-config tests all passed on that SHA.
- Service integration succeeded at `2bb306fad0ea3d8edefcb8d0b14064d74f8367ae` (run [38237199790](https://github.com/spaidey01/my-telegram/actions/runs/38237199790)): locked dependency install, MongoDB/Redis, LocalStack S3 put/get, production build, socket integration, ClamAV EICAR detection, browser WebRTC/TURN recovery tests, and web/socket smoke checks passed. This is CI evidence, not a real VPS or public-network call test.
- Investigated earlier runner validation failures: the failed run at `32f70b90864a2d9bfea604787a90c9865332a93c` failed specifically at the deployment script test step; later run `e8dd03241bb02df629da9f373ffb18cb1deaa04f` passed the same workflow.
- Found a runner UX defect in option 4: after editing `/etc/my-telegram.env`, the script exited without validating, building, and restarting. Fixed on `stargram_clone` in commit `4aa3fd0fc283a9d5682b21e86f40aae8d7e8b8d4` so it calls `apply_config` after the editor, and added a regression assertion in `5e844bbb1202b8d7da6f84689005be38cf39bd40`.
- The new change has just been pushed; its new Actions result must be checked before claiming the regression test is green. The latest branch tip and this change are not yet evidence of a successful rerun.
- Phase A remains in progress: next validate the new test run, continue installer idempotency/rollback and security review, and arrange a disposable Debian/Ubuntu VPS rehearsal. Do not run this installer on the production host, do not claim production readiness, and keep `main` unchanged.

## Phase A continuation — follow-up test repair

- New regression test for runner menu option 4 exposed a test-authoring mistake, not an application runtime failure: the assertion initially matched across the wrong source range; a follow-up edit briefly inserted a literal escaped newline into the test source.
- Corrected the test source in commit `2aa1bcd898e323fda14f9f1e31ee4ff079b620cf`. The current assertion scopes option 4 and verifies it invokes `apply_config` after the editor.
- CI runs for the intermediate malformed test commit `39e28dc222df20ca935d95f9d901b9bc397117b0` failed; they must not be counted as green. Waiting for fresh Actions runs on the corrected head before declaring test validation complete.
- `npm ci` in CI reported five high-severity audit findings. They are not yet triaged; do not apply `npm audit fix --force` blindly. Review the advisory paths and compatible upgrades before deciding fixes.
- Phase A is not complete until current-head CI is green and the installer has been rehearsed on a disposable Debian/Ubuntu VPS, including failure/re-run behavior. No production VPS changes and no promotion to `main` are authorized.

## Phase A security hardening — 2026-10-13 (latest)

- During a deeper permissions review, found that the runner previously changed `/etc/my-telegram.env` ownership to the application user. Since the runner reads and exports env-file keys in a root shell, this would allow the app account to alter a privileged config file and potentially influence root-run subprocess environments.
- Fixed both ownership changes in commit `1463b64efc5ef681bfee9028cb98d1f3ba9dac93`: the file is now `root:<application-group>` with mode `0640`, preserving app read access without app write access.
- Added a regression test for root ownership in commit `bcce8b3b69b6865951db4c29fd4a90c321d54a87`. The current test formatting is corrected at `5d78575f20f26f32a7a8bd71c5b1952233d02092`.
- Runner validation on `1fd53a9323bbea2843dcd94c052f97854a464741` passed, including the corrected option-4 assertion. The latest validation and integration runs for `5d78575f20f26f32a7a8bd71c5b1952233d02092` were still in progress at the time of this note; verify their final conclusions before any Phase A completion claim.
- Remaining Phase A gates: green current-head runner + integration workflows; review the five high-severity npm audit findings and apply only compatible fixes; rehearse clean install, rerun, and failure handling on a disposable Debian/Ubuntu VPS. A real VPS rehearsal has not been performed in this environment, so Phase A is not yet marked complete and `main` must remain unchanged.


## Phase A implementation hardening — 2026-10-13 (latest)

- Fixed a privileged environment parsing risk in `deploy/stargram-runner.sh`: the root runner now reads only `secretKey` and `TURN_SECRET` into its own shell. All other configuration keys are passed only to the unprivileged application process, preventing environment-file entries such as `PATH`, `BASH_ENV`, or `LD_PRELOAD` from altering the root runner's environment.
- Fixed `deploy/setup-vps.sh` to keep `/etc/my-telegram.env` owned by `root:<app-group>` with mode `0640`, instead of allowing the application account to write the secrets file.
- Added regression tests for both protections.
- The added firewalld SSH-port regression assertion initially contained an invalid regular expression; corrected it to a literal string assertion in commit `564ab8067219e11a80f8d1cd61253796fd381313`.
- Current runner-validation workflow for that commit is green: [run 38449555314](https://github.com/spaidey01/my-telegram/actions/runs/38449555314). It passed ShellCheck, deployment syntax/config tests, and production configuration tests.
- The matching service integration workflow [run 38449555319](https://github.com/spaidey01/my-telegram/actions/runs/38449555319) is still running; do not treat it as green until its conclusion is recorded.
- Implementation status: source-level Phase A changes and targeted runner CI are complete. Full Phase A sign-off is intentionally held for the user's requested combined test window: real VPS installation/re-run/failure recovery and npm high-severity advisory triage remain outstanding. No production host changes and no promotion to `main`.
