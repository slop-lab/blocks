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

An optional OpenAI-compatible adapter is configured only when the server receives all three values:
`PART_API_BASE`, `PART_MODEL_ID`, and `PART_API_KEY`. The key remains server-side and fetch is
allowlisted to the configured origin. Repository verification covers adapter construction and the
deterministic Part loop. No paid remote provider was contacted, so provider-specific latency,
streaming, billing, and response compatibility remain deployment verification responsibilities.
