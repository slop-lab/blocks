# Agent tool boundary

## Scope

`@block-editor/agent-tools` is an engine-free contract package for bounded host tools. It defines
validated tool input/output, declared effects, execution identity, budgets, typed outcomes,
provenance, and trace redaction. It does not create agents, choose models, store runs, expose HTTP,
or own application data.

`@block-editor/agent-tools-part` is the optional Part 0.1 adapter. It translates a defined tool to
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

The app runner demonstrates three authoritative-host flows:

1. **Markdown/Git documents**: reads a managed `.md` file through the existing allowlisted,
   bounded Markdown host; creates a separate candidate; applies only after review with the file's
   SHA-256 baseline revision. A changed file returns a conflict rather than being overwritten.
2. **Structured workspace**: reads a page from the page CAS repository and projects bounded context
   for the model. Apply reparses `pageDocumentSchema`, runs the existing cross-entity workspace
   validator, and writes with the captured page revision.
3. **Mixed backlog**: reads the authoritative task, presentation/current proposal, and linked
   Markdown evidence. A proposal stores a `BlockDocument` with the task dependency version. Apply
   rejects either a changed task version or a changed mixed-backlog repository revision.

The model never receives authority from client target metadata alone. The target only identifies
which managed resource the server must reread. Supplied document snapshots are retained solely for
the local review-dialog fixture and are marked `client-draft`, so they cannot use the authoritative
apply command.

## Approval and lifecycle

Model tools can update a review candidate but cannot apply it. The authenticated caller must invoke
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
