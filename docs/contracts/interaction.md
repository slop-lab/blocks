# Interaction Runtime Contract

## Ownership

An `EditingContext` owns one active interaction runtime for one engine surface. The runtime mode is exactly one of `none`, `text`, or `blocks`. A surface may retain an inactive bookmark, but inactive state is not rendered, cannot route clipboard commands, and cannot execute document commands.

The engine owns character selection. The interaction package owns engine-independent block-selection intent. A ProseMirror adapter stores the active mode and canonical block selection in plugin state. Decorations are the only projection of selected block styling. Application controls and menus consume callbacks and do not query application CSS selectors as state.

`BlockSelection` remains a compatibility helper around the pure reducer. It is not a second adapter authority.

## Selection State

Block state contains ordered selected root IDs, anchor ID, and focus ID. IDs are normalized against the current operation tree:

- Ancestor and descendant cannot both be explicit roots.
- Selecting an ancestor removes explicit descendants.
- Selecting a descendant removes selected ancestors, so the descendant becomes the explicit root.
- A selected ancestor visually covers its subtree. Descendants inherit the wash and do not repaint a white island.
- Slots, titles, controls, and occurrence IDs are not block IDs.

Replace selects one root. Ctrl/Cmd toggles one root. Shift applies an additive or subtractive range from the last focus over the flattened visible interactable block list, then canonicalizes roots. Hidden, collapsed, or unloaded blocks are never guessed into a range.

## Scope And Routing

One coordinator owns pointer, keyboard, clipboard, rail, menu, and dismissal routing for a surface. It classifies a target as `text`, `block-body`, `gutter`, `control`, `menu`, or `external`.

- Text input activates text mode and clears active block mode.
- Grip, gutter, marquee, or modified block click activates block mode.
- Menu and rail interactions preserve the active block selection.
- External pointer-down clears the active context by default and hides all context UI.
- Switching to nested CodeMirror or another editor deactivates this context without leaking commands or clipboard state.
- Pointer capture always has terminal cleanup for up, cancel, Escape, and destroy.

The rail corridor extends only from the near edge of the current block to the rail. It never covers the block body. A descendant under the actual pointer is always eligible after the 160 ms dwell. Delayed callbacks bind the candidate ID and runtime epoch and re-resolve the current node before acting.

Readonly contexts permit native text selection and copy. Structural mutation controls are absent. Operations containing any locked block or locked ancestor are all-or-nothing.

## Clipboard

Clipboard routing snapshots the active context, mode, canonical roots, model/epoch, source version, and insertion bookmark at intent time.

- Text mode delegates copy/cut/paste to the engine and never reuses inactive block IDs.
- Block mode writes `text/plain` plus the versioned custom MIME type.
- Custom payloads are parsed and every block is validated before any host callback or transaction.
- Clone assigns fresh IDs recursively and remaps only reference attributes declared by the schema adapter. Unknown opaque data is preserved or the whole paste is rejected.
- Link, clone, and reject are host policy decisions.
- A failed clipboard write preserves content.
- Deferred cut completion may mutate only the captured model/epoch/version target; it cannot delete a later selection.

## History And Updates

Interaction transactions are non-content transactions and do not enter content history. Undo never silently changes the document because selection changed. Plugin views deduplicate root/status/ARIA updates and do not dispatch on every pointer move when state is unchanged.

## Adapter API

An engine adapter provides operation-tree IDs, ancestry, visible order, engine selection mode, block geometry, clipboard codec hooks, and command execution. The coordinator provides active-state routing and application-menu callbacks. Neither package imports application components or application CSS constants.
