# Document Workshop

Selection, focus, and clipboard ownership are defined in `docs/contracts/interaction.md`; shared-source state and persistence ownership in `docs/contracts/source-runtime.md`; and validation layers in `docs/contracts/testing.md`. The project distinguishes example-UI conveniences from engine and host contracts and does not claim fitness based on test counts alone.

This repository contains a block editor built with React and ProseMirror plus optional integration modules. The base editor can be used without a repository, domain service, or collaboration server.

Public libraries use `@slop-lab/blocks` and `@slop-lab/blocks-*`. The demo app `@this-project/demo` and the repository-web-build-dependent CLI `@this-project/block-docs` are local packages with `private: true`. The public package list, unresolved publication blockers, and production-use conditions are documented in the [release contract](docs/contracts/release.md). Renaming a package does not mean it has been published to npm.

## Run

See [`docs/development.md`](docs/development.md) for the full local development workflow and validation guidance.

```sh
pnpm install
pnpm build
pnpm start
```

During `prepare`, `pnpm install` builds the internal packages and generates JavaScript and type declarations in `packages/*/dist`. If install scripts were skipped, run `pnpm build:packages` first. Both `pnpm build` and `pnpm typecheck` also build the internal packages first.

The default address is `http://localhost:3000`. Change the port with `PORT=4174 pnpm start`. During development, run the server alongside `pnpm dev`.

The development server proxies `/api` and the collaboration WebSocket to port 3000 by default. If the backend port changes, use `BACKEND_URL=http://127.0.0.1:4174 pnpm dev`.

### Connect an OpenAI-Compatible Model

Keep credentials only in a local server-side file, never in the browser or `VITE_` variables. Copy the tracked example and edit `.env.local` locally. Never paste a real key into an issue, chat, command-line argument, or Git-tracked file.

```sh
cp .env.example .env.local
# Edit OPENAI_BASE_URL and OPENAI_API_KEY in .env.local
pnpm agent:check
pnpm start
```

`OPENAI_BASE_URL` accepts an API base such as `https://api.example.com/v1`; the app appends `/chat/completions` once. A trailing slash is ignored. URL credentials, queries, fragments, and an already-appended `/chat/completions` are rejected. Plain HTTP is allowed only for local mocks on `localhost`, `127.0.0.1`, or `::1`.
If any `OPENAI_*` variable is present, this preferred group takes precedence and both the base URL and API key are required. Set `OPENAI_MODEL` only to pin the default model. If required values are missing, the server and check fail with an explanation rather than silently falling back to the fixture.

`PART_API_BASE`, `PART_API_KEY`, and `PART_MODEL_ID` remain available for legacy configuration. They are used only when no preferred `OPENAI_*` variable is present. As historically defined, `PART_API_BASE` is the complete endpoint through `/v1/chat/completions`, not a base URL. Do not mix the groups. The server uses the deterministic fixture only when no provider variables are configured.

`agent:check` selects the default model from the authenticated `/models` list. Check a specific model with `pnpm agent:check -- --model model-id`. In an isolated temporary client draft, it runs a real Chat Completions request through the Part runtime, invokes the `candidate_patch` function tool, returns the tool result, executes the final model turn, and removes the file.
It never calls canonical document apply and prints only the model name, success state, and tool-turn count. It does not print provider response bodies or keys.
The default timeout is 45 seconds and can be raised to at most 60 seconds, for example with `pnpm agent:check -- --timeout-ms 60000`. The check uses the catalog lookup and usually two model requests, so it may consume quota or incur cost. A connected model that does not follow the requested function tool is treated as incompatible.

## Git Document Library CLI

`block-docs` creates or reuses a managed worktree per branch under `.runtime/git-documents` without touching the primary worktree of an existing non-bare Git repository. The browser calls only fixed document APIs on the same origin; no endpoint accepts Git commands or arguments.

```sh
pnpm build
pnpm docs:start -- --repo /absolute/path/to/repository --docs docs --port 3000
```

The default branch is `block-docs` and the default listen address is `127.0.0.1`. Use `--port 0` for an ephemeral port, `--data /absolute/runtime/path` for a separate runtime location, or `--branch notes/topic` to select an existing managed branch. Specify `--host 0.0.0.0` only in a container or on a trusted LAN. After startup, open the printed `http://127.0.0.1:<port>/?workspace=git-documents` URL.

To create a dedicated repository, use the fixed command below. The directory must be empty. The CLI creates only `docs/welcome.md`, `.gitignore`, and the initial commit, and does not modify existing repository or global Git configuration.

```sh
node packages/block-docs/dist/cli.js init \
  --repo /absolute/path/to/new-library \
  --author-name "Your Name" \
  --author-email "you@example.com"

node packages/block-docs/dist/cli.js --help
```

Git resolves identity in this order: the explicitly supplied author, the CLI environment, then repository or user configuration. Commit and init fail with an explanation if no identity is available. The CLI stores no credentials, uses only `origin`, and disables terminal prompts. Remote authentication is handled by the user's existing Git credential helper or SSH agent.

Supported document-library workflows:

- Source-preserving WYSIWYG and raw Markdown editing, a 500 ms recovery-draft autosave, and CAS-based managed-worktree persistence.
- Create, move, and delete Markdown files including folder paths; full-text search; and backlink candidates based on relative document names.
- Compare HEAD with the working copy, commit selected document paths, inspect per-document history, and restore a working copy.
- Create, list, and switch branches. Every branch has a separate managed worktree and draft scope.
- Manually fetch `origin`, apply fast-forward-only updates to a clean worktree, and push the current branch.
- Display divergence; prepare an explicit `--no-commit` merge; edit and resolve raw document conflicts; and commit or abort the merge.

Safety boundaries and intentional limitations:

- Only `.md` files below the configured repository-relative root are allowed. Absolute paths, `..`, backslashes, option-like names beginning with `-`, `.git`, and symlinks are rejected.
- Commit stages only selected paths under the document root. It is rejected if existing staged changes are present or a merge includes files outside the document root.
- Worktrees are never removed automatically. Shutdown and restart reuse the same registered worktree and per-branch drafts, so uncommitted changes are not lost.
- Reset, rebase, stash, force-push, arbitrary remote URLs, and arbitrary shell or Git argv are not exposed. If the primary branch is already checked out in another worktree, it is not opened again as a managed worktree.
- Git hooks are disabled per subprocess with `core.hooksPath=/dev/null`. This tool manages document files in a trusted personal repository and does not execute application code or package hooks from the repository.
- Request bodies are limited to 6 MiB, Markdown files and drafts to 5 MiB, search results to 100, and history to 100 entries. Attachment upload is not currently provided.
- Mutation requests are rejected when the browser Origin differs from Host. Default localhost operation is personal. When exposing `0.0.0.0`, the host operator must add reverse-proxy authentication and HTTPS.

## Examples

- **Local notes**: choose manual save, save after input, periodic autosave, or save on focus loss. Data is stored in localStorage.
- **Work briefing / read-only guide**: separates external task state from document captions and layout. Changing task state is not a content edit.
- **Markdown files**: reads and edits server files. Set the folder with `MARKDOWN_ROOT`; the default is `.runtime/markdown`. Saves use file hashes to detect conflicts. Block IDs and 1-based source line ranges are tracked temporarily in server memory; editor IDs are not inserted into files.
- **Collaborative writing**: edit the same room from two editor panes or multiple browsers. Yjs selective Undo manages local edits, and WebSocket carries changes and presence.
- **Tables and code**: provides cell selection, paste, row and column changes, merge and split, and an independent CodeMirror input area. The shared toolbar applies only to the active input context.
- **Document archive**: loads portions of a document from the server and renders them with virtualization. A save is a durable patch guarded by each block's revision and does not replace unread portions.
- **Proposal comparison**: compares a candidate separate from the original and accepts selected changes. It verifies dependencies and the original baseline for linked changes. Cancelling or replacing a stream provider never mixes an earlier result into a new candidate.
- **Documents and databases**: at `?workspace=structured-workspace`, edits JSON documents, nested pages, a typed database, and shared blocks. Page bodies, databases, and shared sources are separate CAS entities with 600 ms autosave and 2-second external-change refresh.

In the structured workspace, edit the top **Page title** directly and save with Enter or focus movement. Escape cancels the title draft. Dropping a page grip above, in the middle of, or below another page moves it before, under, or after that page; the **Move to top level** target and per-page move select are also available. Body grips support moving blocks across nesting depths and **Cut**.
**Focus view** displays only the selected block; use the breadcrumb to return to a parent block or the full page. Shared sections preserve their source and Undo history. Ownership and validation boundaries for input and movement follow the [structured editing contract](docs/contracts/structured-editing.md).

Markdown, collaboration, table, and large-content functionality is loaded through its own entry point or when navigating to its example. The default viewer does not need to initialize those runtimes.

### Markdown Visual-Editing Scope

The visual editor structurally edits headings, paragraphs, quotes, ordered and unordered lists, emphasis, links, inline code, images, thematic breaks, indented code, and fenced code. Reference links resolve against definitions across the whole document. Only safe `http:`, `https:`, `mailto:`, hash, site-relative URLs, and ordinary relative image paths are activated. Ambiguous paths beginning with `//` or containing backslashes are not activated.

Tables, directives, mixed HTML blocks, and other unsupported extension syntax appear as locked source blocks. They cannot be edited or structurally changed in visual view, but their bytes are preserved exactly on save. Use the **Markdown source** tab to edit them. Adding, splitting, deleting, or reordering structural blocks regenerates only the necessary block boundaries; untouched CRLF and extension-syntax source is preserved.

## Library Entry Points

| Module | Role |
|---|---|
| `app/src/model.ts` | JSON codec, cloning, budgeted reads, output, change delivery, proposals, and host-integration contracts |
| `app/src/Viewer.tsx` | Engine-free React viewer for block arrays, custom renderers, and overlays. Links in static and read-only output activate only `http:`, `https:`, `mailto:`, hash, and site-relative URLs. |
| `app/src/editing.ts` | Local `ModelSession` and structural commands |
| `app/src/features/markdown/` | Markdown file integration and UI |
| `app/src/features/collaboration/` | Yjs integration and multi-editor surfaces |
| `app/src/features/composite/` | Optional table schema, composite input context, and migration |
| `app/src/features/large-content/` | Partial loading, block cache, virtualization, and reveal/focus |
| `@slop-lab/blocks-bindings` | Engine-independent change delivery, draft/ack policy, asynchronous external-action target guard, and strict revision schema |
| `@slop-lab/blocks-server-bindings` | Node file CAS repository, Yjs room repository, signed demo sessions and scope checks, and versioned approval workflow |
| `@slop-lab/blocks` | Engine-independent document contract, codec, explicit block registry, and React viewer |
| `@slop-lab/blocks-interactions` | Engine-independent selection, clipboard, and cut policy. ProseMirror integration is available through the opt-in `/prosemirror` entry point. |
| `@slop-lab/blocks-containers` | Engine-independent recursive tree movement and cloning, plus explicit minimal-connected-range wrapping plans |
| `@slop-lab/blocks-prosemirror` | Opt-in ProseMirror schema/snapshot adapter and per-block leaf exports |
| `@slop-lab/blocks-workspace` | Engine-independent page/document/database/synced-source Zod contracts, hierarchy commands, typed row patches, filters and sorting, and contextual heading projection |
| `@slop-lab/blocks-agent-tools` | Engine-independent tool schema, effect, context, budget, result, and provenance contracts. It owns neither model execution nor storage. |
| `@slop-lab/blocks-agent-tools-part` | Fixed Part 0.1 `functionTool` integration. The application server owns the execution lifecycle. |

`pnpm build:packages` generates ESM and declarations in `packages/*/dist`. The app directly uses `@slop-lab/blocks-bindings` for local-note save notifications, revision bookmarks in host forms, asynchronous proposal target guards, and partial-document save acknowledgements. The server uses `@slop-lab/blocks-server-bindings` for durable document, room, and workflow stores under `.runtime` and for permission checks.

```ts
import { ChangeDelivery, PersistenceBaseline } from "@slop-lab/blocks-bindings"
import { DemoSessionAuthority, FileCasRepository } from "@slop-lab/blocks-server-bindings"
```

### Custom Schemas and Tree Shaking

The core document contract has no required paragraph type. With ProseMirror, consumers import only the block leaves they need and assemble a schema. For convenience, the existing editor uses `@slop-lab/blocks-prosemirror/preset`, preserving its public behavior.

```tsx
import { BlockViewer } from "@slop-lab/blocks/viewer"
import { blockAttrs, createProseMirrorProfile } from "@slop-lab/blocks-prosemirror"

const notesText = {
  type: "notes.text",
  nodeName: "notes_text",
  text: true,
  nodeSpec: { group: "block", content: "inline*", attrs: blockAttrs },
  render: (block) => <p>{block.content.map((item) => item.kind === "text" ? item.text : "")}</p>,
} as const

const profile = createProseMirrorProfile([notesText], "notes.text")
const renderers = new Map([[notesText.type, notesText.render]])
const view = <BlockViewer content={document} renderers={renderers} />
```

Independent leaves are `@slop-lab/blocks-prosemirror/paragraph`, `/heading`, `/quote`, `/code`, `/caption`, and `/task-card`. Only consumers needing the common preset import `/preset`. Every package emits ESM and declarations and declares `sideEffects: false`. `app/tests/tree-shaking.test.ts` inspects actual esbuild metafile inputs to prove that a custom-text consumer contains no default block leaves and a view-only consumer contains no ProseMirror.

The structured domain imports neither a rendering engine nor Node storage. Hosts parse boundaries through the schema and pass command results to their own CAS adapters.

```ts
import {
  filterAndSortRows,
  headingLevelAtDepth,
  movePage,
  workspaceSchema,
  type WorkspaceStoragePort,
} from "@slop-lab/blocks-workspace"

const workspace = workspaceSchema.parse(payload)
const moved = movePage(workspace, "research", "project")
const htmlLevel = headingLevelAtDepth(2, 3) // 5; persisted 2 is unchanged
```

## Ownership Examples

The sidebar's **Ownership examples** compare the following boundaries through real mutations and persistence within one workspace:

- `notebook`: a custom schema with `notes.text` as the default. The block document is canonical and reloads after browser persistence.
- `projectboard`: task title and status are separate domain data; only a card occurrence's local ID and caption belong to presentation. Duplicating a reference to the same task assigns a new local ID, and deleting a card does not delete the task.
- `statusview`: an explicit renderer viewer using only query projection and server actions, without creating an editor.
- `filetree`: displays a recursive file tree under an allowed Markdown root. The server rejects absolute paths, traversal, backslashes, and symlinks, and does not write block IDs into `.md` source.
- `mixedbacklog`: the server domain owns search and current-run lists plus workflow state. Only captions and agent proposals under a read-only root are edited in the lower panel, and a proposal is rejected if the task dependency version changes. Additional task information opens through the Markdown file-tree service.

The demo identity cookie in this example reuses the existing signed session. It does not claim production authentication or atomicity across multiple services.

### Input, Change Delivery, and Persistence

Engine transactions and IME handling execute immediately. The internal local version tracks conflicts and positions and differs from file or server persistence revisions. `ChangeDelivery` batches host notifications with `immediate`, `debounce` including `maxWait`, `throttle`, and `manual` policies. `flush()` delivers the latest change, and `dispose()` cancels remaining timers.

A local session exclusively owns its ProseMirror state. UI snapshots are derived only when needed; normal input does not generate or persist full JSON on every change. Collaboration uses separate Yjs history and therefore does not also attach ordinary snapshot history.

### Data Boundaries

Persistence JSON retains unsupported structures. Content the current engine cannot safely interpret remains opaque. Markdown and HTML output are distinct from JSON persistence and return loss information. Markdown file integration preserves the original source and applies only changed ranges.

External content replacement checks model, epoch, and base version and is deferred during composition. If automatic reconciliation is impossible, the draft is preserved and a conflict is reported. External actions, rendering, and body persistence are separate paths.

`@slop-lab/blocks-agent-tools` is an execution-engine-independent bounded-tool contract. The optional `@slop-lab/blocks-agent-tools-part` integrates only with the fixed Part 0.1 `functionTool`. The example app under `app/server/agent/` owns the command, query, and watch lifecycle, execution journal, model selection, and authorization.
The browser uses only the same-origin `/api/agent/commands`, `/api/agent/queries`, and `/api/agent/events` routes and never receives model credentials. The default provider is the fixture labeled `Deterministic fixture / No model connected`. It runs the real Part model/tool loop but does not claim an external LLM connection.

Connect an OpenAI-compatible model through the server-only `OPENAI_*` configuration described above. The endpoint origin is fixed in the Part fetch transport allowlist and the bearer key remains on the server. Repository loopback integration tests prove real HTTP/SSE and the tool loop; a real external provider must be validated separately with the local `agent:check`.

The execution journal is atomically stored in `.runtime/agent/runs.json`. Only explicit execution cancellation cancels the host task; closing a dialog or stopping event observation only detaches that observer. Work active during a server restart remains `interrupted`, and tools are never replayed automatically. Model tools do not directly change canonical documents; they only update review candidates.
The server rechecks the Markdown hash, workspace entity revision, mixed-task dependency, and repository revision and applies changes only after the user's explicit action. Detailed contracts and operational non-claims are defined in `docs/contracts/agent-tools.md`.

## Server Routes and Persistence Locations

- `GET /api/markdown`, `GET/PUT /api/markdown/file`: recursive file tree, reads, and conditional persistence. Paths and symlinks outside the root are not exposed.
- `GET /api/ownership/mixed`, `POST /api/ownership/mixed/task-status|presentation|proposal`: mixed-backlog domain workflow, lower-layer presentation, and dependency-guarded proposals.
- `/collaboration`: schema handshake, room-scope checks, Yjs synchronization, and restartable room snapshots.
- `/api/large-content`: page reads, block reads and updates, search, and full export.
- `POST /api/demo/session?identity=author|reviewer|viewer`: issues a signed opaque demo-session cookie.
- `POST /api/agent/commands|queries|events`: Part agent transport reusing signed-session and same-origin checks. Only author scope can execute operations.
- `GET/PUT /api/documents/:id`: durable CAS document guarded by room scope and role.
- `POST /api/workflows/:id/submit|approve`: versioned submission and approval pinned to the submitted content revision, with audit history. Submitted and approved documents cannot be modified through this example API.
- `GET /api/workspace`: reads the sample workspace and separate page, database, and synced-source entities.
- `PUT /api/workspace/:kind/:id`: parses `trees|pages|databases|sources` entities with Zod, then persists with `expectedRevision` CAS. New page documents and synced sources can be created without a revision.
- `.runtime/` contains runtime data and is excluded from Git.

The default server stores per-entity JSON snapshots and audit history for the structured workspace under `.runtime/workspace/{trees,pages,databases,sources}`. No API accepts `RUNTIME_ROOT` directly; tests isolate a temporary root with `createApplicationServer({ runtimeRoot })`. Persistence serializes through a per-file queue within one Node process and atomic rename. It does not provide multi-process or distributed transactions.

Markdown is stored in real files, while local notes and tables/code are stored in the browser. Collaboration rooms, ordinary documents, modified archive blocks, and approval workflows use atomic file replacement under `.runtime`. Collaboration clients retain their current replica while disconnected and merge on reconnection.
Before shutdown, the server stores the last Yjs snapshot and reopens it after restart. The archive's default 1,600 source blocks are synthetic; only modifications are persisted.

Demo sessions verify only the role and room scope of publicly selectable example identities and are not production authentication. Without `DEMO_SESSION_SECRET`, the server creates a random mode-0600 secret at `.runtime/demo-session.secret` and reuses it after restart. A host serving HTTPS directly or terminating HTTPS at a trusted proxy must set Secure cookies with `createApplicationServer({ secureCookies: true })`.
Public services must replace this with a real identity provider and session rotation. A displayed user name or editor input restriction is not authorization evidence. The host owns external AI credentials and atomicity across processes and services.

## Run Checks

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm check
pnpm test:browser
```

Set an existing Chromium executable with `CHROME_PATH`. The complete browser suite starts isolated local servers. To run only the core editing scenario against an existing server, use `QA_BASE_URL=http://localhost:3000 node app/tests/browser.mjs`. Test output, browser captures, and development progress reports are not maintained repository artifacts.
