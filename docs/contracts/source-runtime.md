# Shared Source Runtime Contract

## Ownership

A canonical shared source is identified by `sourceId`. One `SourceRuntime` per `sourceId` owns the mutable editor state, content history, engine version, storage baseline revision, save generation, emission cause ID, composition state, and unresolved conflict. A `SourceRuntimeRegistry` owns runtime lifetime.

Occurrences own only presentation state: focus, scroll, and an optional caret/selection bookmark. At most one occurrence of a source is editable and attached to the engine. Other occurrences render a readonly projection from the same runtime snapshot. Switching occurrences moves the attachment without recreating editor state or history.

Engine state remains native engine state. The registry does not maintain an engine-free JSON mirror as a second content authority.

## Versions And Saves

Engine version and storage revision are distinct. Each queued save captures its original storage baseline, source generation, and cause ID.

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

Attaching requires a declared engine capability and an occurrence ID belonging to the source. Switching detaches the old editable occurrence before attaching the next. Bookmarks map by stable block ID and engine position mapping; missing targets collapse to an explicit safe fallback rather than a guessed node.

Inactive occurrences hide selection, menus, format bars, and rails. Their stored bookmark cannot route clipboard or commands until the occurrence is activated again.

## Content Boundaries

Source IDs, block IDs, and occurrence IDs occupy separate namespaces. A source section may contain optional headings and nested blocks; rendering derives heading depth without writing it back.

Persisted workspace input is parsed at the boundary. Known core blocks are editable. Unknown blocks are retained as opaque readonly blocks so editing known neighbors cannot drop data. Creating or persisting source references validates the complete reachable source graph and rejects cycles and dangling references atomically.

## Runtime API

The reusable runtime exposes registration, snapshot subscription, occurrence attach/detach, local transaction delivery, composition state, remote record delivery, save acknowledgement, save rejection, and conflict resolution. Application node views adapt ProseMirror and rendering to this API; the reusable package has no React, DOM, ProseMirror, or application dependency.
