# @slop-lab/blocks-containers

Engine-independent recursive block-tree operations. `planTreeWrap` determines whether a selection can be wrapped in a single container without modifying the document.

```ts
import { expandTreeWrapSelection, planTreeWrap } from "@slop-lab/blocks-containers"

const forest = [
  { id: "a", children: [] },
  { id: "b", children: [] },
  { id: "c", children: [] },
]

const plan = planTreeWrap(forest, ["a", "c"])
if (plan.kind === "expanded") {
  // Explicit preview selection without modifying the document: ["a", "b", "c"]
  const previewIds = expandTreeWrapSelection(plan)
  console.log(previewIds, plan.additionalIds)
}
```

The result is one of the following:

- `exact`: the selected semantic subtrees already form a contiguous range under the same parent.
- `expanded`: the selection must expand to a contiguous child range under the lowest common parent, and `additionalIds` identifies the added range. The caller must not wrap it without user confirmation.
- `invalid`: the entire operation is rejected because of an empty selection, missing IDs, duplicate IDs, cyclic references, a locked range, or different `boundary` values.

`parentPath` is the ID path to the parent that owns the range, and `range` is the half-open child-index range within that parent. `rootIds` are the blocks that will become direct children of the new container, while `coveredIds` contains every ID in those subtrees flattened in document order. If both a selected ancestor and its descendant are supplied, they normalize to the ancestor alone, so IDs are not duplicated.
