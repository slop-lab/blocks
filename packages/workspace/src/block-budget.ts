import type { WorkspaceBlock } from "./blocks.js"
import { isOpaqueWorkspaceBlock } from "./opaque.js"

export const withinWorkspaceBlockBudget = (blocks: readonly WorkspaceBlock[]): boolean => {
  const stack = blocks.map((block) => ({ block, depth: 1 }))
  let count = 0
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    count += 1
    if (count > 10_000 || current.depth > 64) return false
    if (isOpaqueWorkspaceBlock(current.block)) continue
    switch (current.block.type) {
      case "section":
      case "callout":
      case "quote":
        for (const child of current.block.children)
          stack.push({ block: child, depth: current.depth + 1 })
    }
  }
  return true
}

export const withinRawWorkspaceBlockBudget = (blocks: unknown): boolean => {
  if (!Array.isArray(blocks)) return true
  const stack = blocks.map((block) => ({ block, depth: 1 }))
  let count = 0
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    count += 1
    if (count > 10_000 || current.depth > 64) return false
    if (
      typeof current.block !== "object" ||
      current.block === null ||
      !("children" in current.block)
    )
      continue
    if (Array.isArray(current.block.children))
      for (const child of current.block.children)
        stack.push({ block: child, depth: current.depth + 1 })
  }
  return true
}
