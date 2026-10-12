# Contract Test Boundaries

Tests protect observable contracts, not the number of modules or the current event-handler arrangement. A requirement belongs to its owning layer; a browser narrative is not repeated as a unit test in every package.

## Layers

| Layer | Owns | Appropriate evidence |
|---|---|---|
| Interaction intent | Pure selection transitions, anchor/focus, hierarchy normalization | Reducer inputs and resulting canonical selection |
| Model/tree operations | Connected wrapping ranges, stable identity, declared reference mapping | Model equivalence and structural invariants |
| Engine adapter | Engine selection, history ownership, command routing, clipboard representation | Real engine state and production plugin composition |
| Surface | Pointer hit zones, focus, rail reachability, selection presentation | Physical browser input and visible outcomes |
| Source/host binding | Captured save baselines, acknowledgements, conflicts, access and persistence | Runtime tokens, real HTTP/CAS and independent clients |

## Selection And Clipboard

The adapter must prove that the active editing context routes copy according to its current selection. `blocks -> partial text -> copy` is one adapter integration example of that contract, not a prescribed implementation sequence.

- Assert copied MIME/content and unchanged document content.
- Exercise the production plugin factory rather than a hand-assembled fixture omitting selection/history plugins.
- Block selection and text selection must not compete to route a single clipboard event.
- Inactive bookmarks may remain stored, but must not execute commands or determine copied content.
- Pure reducer tests do not inspect DOM classes. Surface tests may inspect semantic state and computed presentation when those are part of the public accessibility/visual contract.

Synthetic pointer/mouse/click dispatch tests can verify a small event translator. They cannot establish browser hit-testing, native text selection, actual pointer travel, focus transfer, or clipboard default behavior. Those claims require a browser.

## Nested Pointer And Presentation Tests

Browser coverage must exercise transitions, not only isolated resting states:

- Parent to child, child to parent, sibling to sibling, and block to rail.
- Human-speed stepped pointer movement with dwell beyond the declared hover threshold.
- Outside-surface dismissal and permitted rail/menu/format-bar exceptions.
- Nested editing-context handoff, including native code-editor ownership.
- Selected container wash, explicit child selection, and combined selected/synchronized states.

An assertion that a background is merely nontransparent is insufficient to prove the selected-state visual contract. A successful leaf-first hover is insufficient to prove parent-to-child rail targeting.

## Shared Source Tests

Pure runtime tests cover submitted-token acknowledgements, dirty generations and conflict transitions. Adapter tests cover native engine/history retention across occurrence attachment. Host integration tests cover persisted CAS revisions. A few browser tests connect those boundaries.

Required transitions include saving A while editing B, receiving a remote winner while active, switching occurrences before Undo, and returning to a source after page navigation. Content equality must never substitute for acknowledgement identity. A stale draft must not be submitted against a baseline it did not observe.

## Replacing Existing Tests

Retain tests of public selection policies, model identity, serialization, tree operations and persistence boundaries. Rebuild adapter fixtures through production assembly. Replace tests that preserve duplicate state owners or private rendering details after equivalent contract coverage exists.

Do not remove a failing behavior test to obtain a green run. If a behavior contract intentionally changes, document the decision and replace the old assertion with coverage of the new contract and its boundary cases. Keep fewer representative browser narratives rather than treating large scenario counts as proof of completeness.
