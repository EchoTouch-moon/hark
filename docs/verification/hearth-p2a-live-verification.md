# P2-A Live Verification · 2026-10-29

**Engineering loop PASS; recommendation usefulness pending human review.** This closes the previous live-auth blocker for the explicitly selected `stepfun-plan / step-5-preview`; it does not promote Observer/P1 pilot waivers or start P2-B/C.

## Findings and fix

Pi 1.4.0 defaults to stepfun-plan/step-5-preview on this machine. StepFun is registered by the installed `@d3ara1n/pi-provider-stepfun@0.3.1` extension. With all extensions disabled, the explicit CLI request failed `Unknown provider`; `auth check` without registration returned invalid_state. Loading only that provider registration (`--no-extensions -e <explicit path>`) produced READY, exit 0. No key was printed or copied. The earlier invalid-x-api-key error alone did not identify the intended provider; it is not evidence that the StepFun credential is invalid.

Hearth now requires explicit model identity, passes provider and model separately, and records `stepfun-plan/step-5-preview` in Analysis Run. Extension discovery remains disabled; a server-configured trusted provider extension can be explicitly loaded. Tools, MCP, skills, context discovery and session saving stay disabled. Offline startup and telemetry-off are set. Provider registration is executable local code, so this is not a general sandbox claim.

CLI text mode gives the adapter the final response text rather than a JSON event stream. The first real context response failed schema validation; this failure is preserved in `p2a-live-first-output-failure.json`. The prompt now specifies nested fields/limits and supports NO_RECOMMENDATION; the subsequent real response passed Zod. Provider errors persist an error category rather than raw stderr, and never silently fall back to Mock.

## Evidence

| Check | Actual result |
|---|---|
| Minimal live CLI | READY, exit 0 (`handoff/EVIDENCE/p2a-live-cli.json`) |
| Browser click → Hearth → Pi | succeeded, Run `anl_a61d0864a8bf28a7` |
| Provider/model | `pi` / `stepfun-plan/step-5-preview` |
| Project | existing authorized pindou, HEAD `f57fc770361e` |
| References | all returned reference IDs bind to supplied evidence; no unmatched reference |
| UNKNOWN | current tests explicitly UNKNOWN; historical doc test claims not treated as current pass |
| Read-only comparison | HEAD, raw index SHA256, porcelain status hash, 611 tracked/nonignored untracked file content/mode fingerprints unchanged |
| Fingerprint limits | ignored files excluded; symlinks hashed without following; before/after comparison cannot exclude transient modifications restored during call |
| Failure path | first real response persisted PROVIDER_OUTPUT with no recommendation; synthetic auth/timeout/malformed-output tests pass |
| Unit/integration | 38 files, **306 passed**, `p2a-live-tests.txt` |
| Typecheck | PASS, `p2a-live-typecheck.txt`; final web build also checks web types |
| Changed-file eslint | PASS, zero warnings, `p2a-live-lint.txt` |
| Web build | PASS, `p2a-live-build.txt` |
| UI | explicit Mock/real Pi label and model; removed global claims that all data remains local / all analysis is offline |

Raw structured recommendation and fingerprints: `handoff/EVIDENCE/p2a-live-verification.json`. Screenshot: `handoff/EVIDENCE/p2a-live-card.png`. Screenshot was refreshed from the persisted Run via GET only after the final display-copy adjustment; no extra model call. The verification used independent local databases under ignored `data/p2a-live-*/`; default running server configuration was not changed.

## Initial quality assessment

The model recognized 28 unstaged files, missing current test evidence and inconsistent historical status documentation. It offered specific local validation commands and documentation reconciliation as next steps, all requiring confirmation. It did not execute them. These are useful observation-level leads, not proven code defects.

Limitations: output is English despite Chinese UI; findings are lengthy; the first suggestion unnecessarily implies committing/stashing before validation. Different commit references alone do not establish conflicting history. Several risk items merely restate project constraints and are hypothetical. `verified` confirms reference binding, not semantic correctness of every sentence. Human judgment on accuracy/usefulness remains pending. Do not infer P2-B/C readiness solely from transport success.

## Reproduction

See README-dev.md P2-A configuration. Set HEARTH_ANALYSIS_PROVIDER=pi, HEARTH_PI_PROVIDER=stepfun-plan, HEARTH_PI_MODEL=step-5-preview, HEARTH_PI_PROVIDER_EXTENSION to the installed, reviewed provider entry point, and HEARTH_PILOT_PINDOU to the authorized absolute path. Build web, then run `pnpm exec tsx scripts/p2a-live-verify.ts`. It creates a fresh isolated runtime each time. No global Pi or Hermes configuration was modified.
