# Structured Document Editing and Navigation

This contract applies to titles, composition input, page and block movement, focused block views, and grip-based cut operations in the `Documents and Databases` example. The host's page hierarchy, page bodies, databases, and shared sources are separate storage resources.

## Titles and Composition Input

- A page title is metadata in the workspace tree. Changing a title does not recreate the page body or a shared source.
- Titles follow the persisted schema's non-empty string and length constraints. Enter and blur during IME composition are not treated as normal input completion.
- Preserve the DOM of the composing contenteditable and the active ProseMirror session. React rerenders, autosave acknowledgements, and external refreshes must not replace composing text with an earlier snapshot.
- The final transaction after composition ends must be included in persistence without omission. External changes arriving during composition must not overwrite the draft; they follow the existing CAS and conflict policy.

## Page Movement

- Moving a page changes its parent and order in the tree while preserving the existing page ID and body entity. It does not duplicate the page or save its body as another entity.
- A page can move under another page, before or after another page, or to the top level. Visible indentation and navigation order must match the persisted hierarchy.
- A move that makes the page itself or one of its descendants the parent is rejected before persistence. Cancelling a drag or losing its target must not trigger a delayed move.
- Provide an accessible movement path that does not require pointer input. If a title edit and a move overlap, both changes must be preserved or an explicit conflict must be reported; a last update must not silently remove the other change.

## Block Movement

- A move is one undoable content change that preserves the block ID and its complete subtree.
- Blocks move between the root and nested containers within the same canonical owner. The drop indicator must distinguish the actual insertion depth and position.
- Reject moves into the block's own subtree, targets that cannot contain valid children, locked structures, and stale drops. A cancelled drag does not change content.
- A shared section's occurrence shell is not part of the canonical source body. Do not treat moving a page block into a shared source, or between different sources, as a simple DOM move. Do not replace a move forbidden by the ownership policy with an implicit clone or link.

## Focused Block View

- A focused block view changes navigation scope; it does not create a new page. It provides paths back to parent blocks and to the current page root.
- Hidden siblings and ancestors remain in the canonical document. Do not replace the editor input with a truncated partial document and then save it as the full page.
- Switching views does not add an entry to content history or reset existing history. Edits before and after the switch use Undo and Redo from the same owner's history.
- Shared sections use the same source runtime. Content and source history continue when opened from another occurrence, and the system does not create multiple independent active editing sessions for one source.
- If the focused block is deleted or moved so that the current path disappears, return to a valid parent scope or the page. This fallback must not delete hidden content.

## Grip Cut

- Cutting from the grip follows the existing block-selection, clipboard-namespace, and reference policies. It writes the custom MIME type and plain text before deleting content.
- If the clipboard write fails, do not delete the source. Copy never deletes content.
- When the asynchronous write completes, verify that the original model, epoch, content version, and active interaction context are still valid. It must not delete a later selection or content from another page or shared occurrence.
- If both an ancestor and descendant are selected, cut the canonical selection root only once. A successful deletion is one undoable change.
- Even in a focused block view, cut against the actual canonical document. Do not remove hidden siblings merely because only one block is visible. When cutting the actual final block, the editing schema must still retain a valid document.

## Validation Boundary

In addition to domain unit tests, exercise title editing, persistence, and reconnection; IME composition; nested pointer movement; focused view entry and return; and grip cut, paste, and Undo in a real browser. For shared sources, verify the result from other occurrences and pages as well. Distinguish CDP composition-input validation from validation with a real operating-system IME.
