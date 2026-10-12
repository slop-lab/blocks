# Shared Source Runtime Contract

## Ownership

A canonical shared source is identified by `sourceId`. One `SourceRuntime` per `sourceId` owns the mutable editor state, content history, engine version, storage baseline revision, save generation, emission cause ID, composition state, and unresolved conflict. A `SourceRuntimeRegistry` owns runtime lifetime.

Occurrences own only presentation state: focus, scroll, and an optional caret/selection bookmark. At most one occurrence of a source is editable and attached to the engine. Other occurrences render a readonly projection from the same runtime snapshot. Switching occurrences moves the attachment without recreating editor state or history.

Engine state remains native engine state. The registry does not maintain an engine-free JSON mirror as a second content authority.

The engine-independent runtime coordinates an opaque adapter session. The adapter owns native content and history, exposes a version-tagged derived projection, applies native transactions, and declares whether an editable occurrence may attach. The default is one editable attachment per source and readonly inactive projections, not arbitrary multi-contenteditable support. The registry belongs to the workspace session and retains the adapter session across occurrence detach and page navigation. Closing that workspace disposes it. A host may evict a clean, inactive source explicitly; dirty, composing, saving or conflicted sources must remain recoverable. Projection updates may be coalesced and latest-wins when tagged revisions are monotonic; projections are never an independent mutable content copy.

## Versions And Saves

Engine version and storage revision are distinct. Each queued save captures its original storage baseline, source generation, and cause ID.

`generation` is the local content-change clock; selection and focus do not increment it. Each submitted save registers an outstanding token consisting of source ID, baseline storage revision, generation and cause ID. An acknowledgement must match an outstanding submitted token, not merely the latest local generation or equal content. A valid A acknowledgement advances the storage baseline monotonically and the acknowledged generation while a newer local generation B remains dirty. Older or unknown acknowledgements cannot regress the baseline. A save request may carry B forward from A's acknowledged baseline only as an explicit local follow-up, never as an implicit rebase onto an unrelated remote winner.

- An acknowledgement updates the baseline only when it matches the submitted generation and cause.
- A newer local generation remains dirty and is saved after the acknowledgement.
- A stale/CAS-rejected draft keeps its original baseline and content, enters conflict state, and is never silently staged against the remote winner.
- Save failure and conflict are observable states; promises are handled and no rejection is dropped.
- Undo changes engine content only. It does not rewind storage revision or acknowledge a save.

## Remote Updates

Remote records are processed while a source is active; activity is not a reason to ignore them.

- If the runtime is clean and not composing, a newer remote revision may replace engine content while preserving the runtime object.
- An exact own acknowledgement advances the baseline without resetting history.
- If local content is dirty or IME composition is active, a newer remote record is buffered as a conflict. The local draft and original baseline remain available for recovery.
- Polling may merge clean entities. Dirty or conflicted entities keep local content and report the remote revision rather than pretending the local draft is based on it.

## Attachments And Bookmarks

Attaching requires a declared engine capability and an occurrence ID belonging to the source. Switching detaches the old editable occurrence before attaching the next. Bookmarks map by stable block ID and engine position mapping when supported. A missing target yields an explicit unresolved bookmark; the surface may focus the editor root as a disclosed fallback but must not select or modify a guessed neighboring block.

Inactive occurrences hide selection, menus, format bars, and rails. Their stored bookmark cannot route clipboard or commands until the occurrence is activated again.

## Content Boundaries

Source IDs, block IDs, and occurrence IDs occupy separate namespaces. A source section may contain optional headings and nested blocks; rendering derives heading depth without writing it back.

Persisted workspace input is parsed at the boundary. Known core blocks are editable. Unknown blocks are retained as opaque readonly blocks so editing known neighbors cannot drop data. Creating or persisting source references validates the complete reachable source graph and rejects cycles and dangling references atomically.

Graph validation belongs to the host/model codec using declared dependency metadata. The generic runtime does not inspect ProseMirror nodes or guess references inside arbitrary JSON. Atomic graph validation and writing are serialized within the configured workspace/server process; distributed atomicity is not implied.

## Runtime API

The reusable runtime exposes registration, snapshot subscription, occurrence attach/detach, local transaction delivery, composition state, remote record delivery, save acknowledgement, save rejection, and conflict resolution. Application node views adapt ProseMirror and rendering to this API; the reusable package has no React, DOM, ProseMirror, or application dependency.
