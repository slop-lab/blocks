# Interaction Runtime Contract

## Ownership

An `EditingContext` owns one active interaction runtime for one engine surface. The runtime mode is exactly one of `none`, `text`, or `blocks`. A surface may retain an inactive bookmark, but inactive state is not rendered, cannot route clipboard commands, and cannot execute document commands.

The engine owns character selection. The interaction package owns engine-independent block-selection intent. A ProseMirror adapter stores the active mode and canonical block selection in plugin state. Decorations are the only projection of selected block styling. Application controls and menus consume callbacks and do not query application CSS selectors as state.

`BlockSelection` remains a compatibility helper around the pure reducer. It is not a second adapter authority.

An interaction scope groups surfaces whose commands can share a toolbar or clipboard route. Its context arbiter owns one active context ID and activation epoch. Activating another context deactivates the previous one before it can handle input. Engine state and native text selection remain owned by each engine session; the arbiter does not copy them. Separate embedded applications may use separate scopes. A surface's inactive bookmark is storage for later restoration, not another active selection.

## Selection State

Block state contains ordered selected root IDs, anchor ID, and focus ID. IDs are normalized against the current operation tree:

- Ancestor and descendant cannot both be explicit roots.
- Selecting an ancestor removes explicit descendants.
- Selecting a descendant removes selected ancestors, so the descendant becomes the explicit root.
- A selected ancestor visually covers its subtree. Descendants inherit the wash and do not repaint a white island.
- Slots, titles, controls, and occurrence IDs are not block IDs.

Replace selects one root. Ctrl/Cmd toggles one root. Shift applies an additive or subtractive range from the last focus over the flattened visible interactable block list, then canonicalizes roots. Hidden, collapsed, or unloaded blocks are never guessed into a range.

Modifier precedence is Shift first, then Ctrl/Cmd, then unmodified replace. Thus Ctrl/Cmd+Shift uses the same range intent as Shift alone. Range polarity is computed from the pre-intent state: if the clicked target is an explicit selected root, remove the range; otherwise add it. The range endpoints use the previous focus and the clicked target, and focus advances to the clicked target after the operation. During a batch range or marquee normalization, an included ancestor wins over its included descendants regardless of input order. An explicit single-target child intent instead removes selected ancestors so the child is the target. These are distinct operations, not order-dependent applications of a series of toggles.

## Scope And Routing

One coordinator owns pointer, keyboard, clipboard, rail, menu, and dismissal routing for a surface. It classifies a target as `text`, `block-body`, `gutter`, `control`, `menu`, or `external`.

- Text input activates text mode and clears active block mode.
- Grip, gutter, marquee, or modified block click activates block mode.
- Menu and rail interactions preserve the active block selection.
- External pointer-down clears the active context by default and hides all context UI.
- Switching to nested CodeMirror or another editor deactivates this context without leaking commands or clipboard state.
- Pointer capture always has terminal cleanup for up, cancel, Escape, and destroy.

The rail corridor extends only from the near edge of the current block to the rail. It never covers the block body. A descendant under the actual pointer is always eligible after the 160 ms dwell. Delayed callbacks bind the candidate ID and runtime epoch and re-resolve the current node before acting.

The default grip click selects its operation root and opens that root's contextual menu. Escape from the menu returns focus to the grip without erasing the block selection. An unmodified text click activates native text selection; a pointer-down outside this context clears active selection. Rail, menu and an open selection-format form are declared context controls, not arbitrary DOM descendants exempt from dismissal. Entering a different nested editor deactivates the previous context. Projects may choose a select-only grip presentation, but the input adapter does not infer that policy from CSS or element names.

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

Cut/delete policy and paste representation are independent. `remove-after-write` removes only the successfully copied captured range; `host-deferred` leaves the content until the host explicitly completes the operation; copy-only never removes it. Paste clone creates independent local identities; paste link creates an explicit host-resolved reference; reject consumes the offered structural operation without falling through to a different native mutation. Neither policy grants authorization. Identity/version checks establish whether the request still targets the same content; the current host permission and local locked-boundary checks must also allow a mutation when it executes.

## History And Updates

Interaction transactions are non-content transactions and do not enter content history. Undo never silently changes the document because selection changed. Plugin views deduplicate root/status/ARIA updates and do not dispatch on every pointer move when state is unchanged.

## Adapter API

An engine adapter provides operation-tree IDs, ancestry, visible order, engine selection mode, block geometry, clipboard codec hooks, and command execution. The coordinator provides active-state routing and application-menu callbacks. Neither package imports application components or application CSS constants.
