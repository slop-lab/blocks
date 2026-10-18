# Agent tool boundary

## Scope

`@slop-lab/blocks-agent-tools` is an engine-free contract package for bounded host tools. It defines
validated tool input/output, declared effects, execution identity, budgets, typed outcomes,
provenance, and trace redaction. It does not create agents, choose models, store runs, expose HTTP,
or own application data.

`@slop-lab/blocks-agent-tools-part` is the optional Part 0.1 adapter. It translates a defined tool to
the published `functionTool` API and advertises the same JSON Schema and effect as the core
definition. Both packages pin Part-facing dependencies to exactly `0.1.0`; Part remains
experimental and a `0.x` minor update is treated as breaking.

The operation runner under `app/server/agent/` is application code. It composes Part, chooses the
model, authenticates a principal/session, persists demo run records, owns cancellation and restart
interruption, and selects the host adapter. It is not exported as a framework and is not presented
as a production agent runtime replacement.

## Tool contract

Each tool declares one effect:

- `read`: bounded access to authoritative host state.
- `propose`: writes only a review artifact; it cannot mutate canonical state.
- `write`: a direct authoritative mutation. The application exposes these only behind explicit
  user approval and compare-and-swap checks.

`ToolContext` carries the authenticated principal and session, model epoch, expected authoritative
revision, operation ID, cooperative `AbortSignal`, and a shared operation budget. The budget limits
calls, elapsed time, returned bytes, items, and traversal depth. Input and output cross Zod
boundaries, while the matching advertised JSON Schemas are retained for model/tool discovery.

Expected host failures are typed as success, refusal, conflict, or cancelled results. Successful
results include the resources actually read in their provenance. Trace values recursively redact
credentials, authorization fields, prompts, and model traces before an observer receives them.

## Application examples

The app runner demonstrates three authoritative-host flows. Every proposal is a discriminated,
immutable artifact carrying exact before/after values, the revisions and linked reads used to form
it, and a canonical SHA-256 fingerprint. Apply recomputes that fingerprint before touching a host.

1. **Managed Markdown**: `search_documents` finds only bounded allowlisted files,
   `read_markdown_range` returns exact source ranges, and `propose_markdown_replacement` creates a
   `markdown-replacement` artifact. Apply checks the file SHA and exact before range, preserving
   untouched source bytes and CRLF. This is not a Git worktree adapter.
2. **Structured workspace**: `query_database_rows` reads the canonical typed database and
   `propose_row_status_patch` creates a `workspace-row-status` artifact. Apply executes inside
   `withWorkspaceMutation`, checks the database CAS revision and before value, calls the canonical
   typed row patch, validates the whole workspace, and preserves unrelated rows and properties.
3. **Mixed backlog**: `list_running_tasks`, `read_task_context`, and `read_linked_evidence` return
   the real task, proposal context, Markdown content, and hashes. `propose_task_plan` creates a
   `mixed-task-plan` artifact. Apply rejects a changed task version, repository revision, or linked
   evidence hash.

The model never receives authority from client target metadata alone. The target only identifies
which managed resource the server must reread. Supplied document snapshots are retained solely for
the local review-dialog fixture and are marked `client-draft`, so they cannot use the authoritative
apply command.

## Approval and lifecycle

Model tools can create a review artifact but cannot apply it. The authenticated caller must invoke
the apply action after review. Query, watch, cancel, and apply are restricted to the principal and
session that started the operation. Closing an observer only detaches that observer; explicit
cancellation aborts the tool context and requests Part cancellation. A restart marks active work
`interrupted` and never replays tools automatically.

The durable JSON journal and in-process watch hub are demonstration infrastructure. They do not
claim multi-process consistency, distributed transactions, retention policy, production identity,
or disaster recovery.

## Provider evidence

The default provider label is `결정적 시나리오 / 모델미연결`. It executes real Part model and
function-tool calls using Part's deterministic fake model; it does not claim an LLM connection.

The preferred server-only configuration requires `OPENAI_BASE_URL` and `OPENAI_API_KEY`;
`OPENAI_MODEL` optionally pins the startup default. The base URL ends at an API prefix such as `/v1`; the application normalizes
its trailing slash and appends `/chat/completions`. URLs must use HTTPS, except that loopback hosts
may use HTTP for tests, and may not contain credentials, a query, or a fragment. If any preferred
variable is present, that group takes precedence and an incomplete group is an error rather than a
fixture fallback. The server discovers `/models` with the same bearer credential, validates and caps
the response, caches it for 30 seconds, and exposes only model IDs and provider labels through the
author-only same-origin `GET /api/agent/models` route. Credentials and raw provider errors never enter
browser payloads or logs. Each start request may select one advertised `inferenceModel`; that exact ID
and its provider label are snapshotted in the durable run before tool execution.

The published legacy `PART_API_BASE`, `PART_API_KEY`, and `PART_MODEL_ID` group remains supported
only when no preferred variable is present. Its `PART_API_BASE` retains the historical exact-endpoint
meaning and must include `/chat/completions`. Credentials stay in the server process and fetch is
allowlisted to the parsed endpoint origin. No provider variable means the explicit deterministic
fixture; partial configuration never silently selects it.

Repository integration tests use an ephemeral loopback OpenAI-compatible server and the installed
Part fetch transport. They prove the exact POST route, bearer authorization, configured model,
advertised function schema, SSE tool call, returned tool-result message, review candidate creation,
no implicit apply, abort propagation, HTTP 401 result, and absence of the test credential from the
run journal. The mock is transport evidence, not evidence for a particular external provider.

`corepack pnpm agent:check` is the opt-in external connectivity check. Both it and `pnpm start` load
the ignored `.env.local` with Node's `--env-file-if-exists`; `.env.example` contains placeholders
only. The check runs an isolated client-draft operation through the same Part tool loop, requires one
`candidate_patch` turn, never invokes apply, removes its temporary journal, and prints metadata only.
It calls `/models`, and `--model <model-id>` can select a specific advertised entry. It can consume quota through two or more Chat Completions requests and
does not prove latency, billing, production reliability, Responses API support, media, or hosted
tools. Those remain provider and deployment responsibilities.
