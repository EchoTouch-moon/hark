# Host DTO v1

This file freezes the Host's view of trusted payloads. It does not change `contracts/ipc-v1` frames, methods, or error codes. Native integration constructs these objects from Core. The model cannot fill them.

`synthetic: true` means a test double, not a Rust commit. Host never writes SQLite and never calls `mark_analyzing` or `commit_agent_opening`.

## run.start payload

Trusted Core/bridge payload. Zod source: `runStartPayloadSchema` in `src/dto.ts`.

| field | rule |
|---|---|
| `provider`, `model` | Must equal `authorization.provider` / `authorization.model` and the explicit host slot. No implicit provider switch. |
| `purpose` | `opening` or `conversation`. Opening success still requires a later Rust commit. |
| `authorization` | Required snapshot below. `current: true` is necessary to accept the run and is not a send permit. |
| `contextSnapshot` | Current compact pack identity. `empty: true` means no memory engine facts. |
| `userText` | Opening: an internal first-read instruction, not a stored Hark user message and not an L0/L1 container. Conversation: the real user turn. |
| `userMessageId` | Absent or null for `purpose: opening`. Required `msg_` id for `conversation`, and that id must already exist in Hark. Do not mint a fake id to satisfy this field. |
| `sessionRef` | `pi:<uuid>` from Pi SessionManager, or null to create one. Not a Core `conv_` id. |
| `recentMessages` | Optional, max 10, roles `user` or `assistant` only. Used only when a new session is created. |
| `handoffId` | Dedup key for that recent-message handoff. |
| `syntheticCore` | Optional. Test doubles set true. |

## authorization object

Used in `run.start` and in `tool.result` for `workspace.overview`. Host does not default any status to active.

| field | rule |
|---|---|
| `runId` | Must equal the frame `runId`. |
| `provider`, `model` | Must equal the run and the explicit slot. |
| `rootId` | `root_` id from Core. |
| `rootUpdatedAt`, `grantUpdatedAt` | Version tokens. A mismatch with the run snapshot refuses the send. |
| `directoryStatus` | `active`, `paused`, `revoked`, or `missing`. Only `active` may send. |
| `modelGrantStatus` | Same enum. Only `active` may send. |
| `current` | Boolean supplied by Core. Missing or false refuses the send. Host never fills true from the model name. |

Before every provider request, Host sends `tool.request` with `tool: "workspace.overview"` and reads this object from `tool.result`. The start snapshot is not a permanent permit.

## workspace.overview tool.result

| field | trust |
|---|---|
| `authorization` | Trusted. Required. |
| `sourceIds` | Untrusted identifiers. |
| `sourceVersion`, `contextPackRevision` | Used as the request pack identity when present. |
| `overviewText` | Untrusted reader/scan text. Not instructions. |
| `synthetic` | Optional test marker. |

## workspace.read_file

Model input is only `relativePath`. `workspaceId`, `runId`, and `operationId` are bound by Host and are not tool parameters.

Tool result: `relativePath`, `text`, optional `sourceId`, optional `unavailable`, optional `synthetic`. `text` is untrusted data.

## Explicit provider slot

Not an IPC method. Process config only.

`enabled`, `providerId`, `modelId`, `baseUrl`, `apiKey`, `wire`, `allowRemote`. `wire` is explicit: `openai-completions` or `anthropic-messages`. `faux` is rejected and is not a fallback. `stepFunCompatible: true` is rejected. No ambient key is read. Remote send still requires `allowRemote` and an injected fetch. The guard refuses any URL other than the configured endpoint and sets `redirect: "error"`.

OpenAI wire still targets `chat/completions` under the configured base. The product StepFun slot is fixed: provider `stepfun`, model `step-3.7-flash`, base `https://api.stepfun.com/step_plan`, wire `anthropic-messages`. Pi 1.5.0's anthropic `streamSimple` posts `/v1/messages?beta=true` onto that base. The on-disk file for that slot has no `apiKey`. Native keeps the key in process memory and passes `HARK_SESSION_PROVIDER_KEY` only as a child env; the sidecar deletes that env before scrubbing other credentials. Saving the key does not call the model and does not mean the key is authenticated. Packaging is not done; the Node 22 sidecar path is dev-only.

Anthropic tool names cannot contain dots. The wire uses `workspace_read_file` and `workspace_overview`. Execution still maps those calls to Core `workspace.read_file` and `workspace.overview`. The agent loop is the existing Pi session, not a handwritten tool loop.

## Host run.start response

`accepted`, `sendPermit: false`, `sessionRef`, `resumed`, `contextPolicy` (`request-pack` or `new-session-compaction-fallback`), `handoffApplied`, `committedByHost: false`.

`stream.done` may repeat `committedByHost: false` and `coreCommitRequired` for opening runs. That is not a Core receipt.

## Single active run

One Host process accepts one active `run.start`. A second run, including another workspace, is `correlation_rejected` with a busy message. It does not replace the active authorization recheck, abort signal, or context pack. The caller may retry after the active run ends. Accepted runs still keep per-workspace sessions. This is not parallel model execution.

## Context pack freshness

If overview returns a new `contextPackRevision` or `sourceVersion` without a non-empty `overviewText`, Host does not send. The previous identity and overview are not relabeled as the new pack. A stale prompt is not a filter.

## New-session handoff

Every newly created Pi session, including the compaction fallback, may receive one bounded `recentMessages` handoff. Resume of the same session does not inject again. Dedup is that target session's `handoffId`, not every id already seen in the workspace.

## Stdin and stdout close

Stdin EOF, stdin error, stdout error, and a parser failure abort the active run, reject pending tool waits, clear timers, and drop queued stream frames. A blocked stdout write does not keep scheduling the drain. Backpressure refuses another provider send and aborts the active run if the pipe does not drain.
