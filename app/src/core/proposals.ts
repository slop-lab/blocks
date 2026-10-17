import type { BlockDocument, BlockSnapshot } from "./types"

export type ProposedChange = {
  readonly id: string
  readonly blockId: string
  readonly before: BlockSnapshot | null
  readonly after: BlockSnapshot | null
  readonly beforeIndex: number | null
  readonly afterIndex: number | null
  readonly dependsOn: readonly string[]
}
export const compareDocuments = (
  before: BlockDocument,
  after: BlockDocument,
): readonly ProposedChange[] => {
  const originals = new Map(before.blocks.map((block) => [block.id, block]))
  const candidates = new Map(after.blocks.map((block) => [block.id, block]))
  const changes = [...new Set([...originals.keys(), ...candidates.keys()])].flatMap((blockId) => {
    const oldBlock = originals.get(blockId) ?? null
    const newBlock = candidates.get(blockId) ?? null
    const beforeIndex =
      oldBlock === null ? null : before.blocks.findIndex((block) => block.id === blockId)
    const afterIndex =
      newBlock === null ? null : after.blocks.findIndex((block) => block.id === blockId)
    return JSON.stringify(oldBlock) === JSON.stringify(newBlock) && beforeIndex === afterIndex
      ? []
      : [
          {
            id: crypto.randomUUID(),
            blockId,
            before: oldBlock,
            after: newBlock,
            beforeIndex,
            afterIndex,
            dependsOn: [],
          },
        ]
  })
  return changes.map((change) => {
    const reference =
      change.after?.type === "caption" ? change.after.attrs["refBlockId"] : undefined
    const dependency = changes.find((other) => other.blockId === reference && other.before === null)
    const structural =
      change.beforeIndex !== change.afterIndex
        ? changes
            .filter((other) => other.id !== change.id && other.beforeIndex !== other.afterIndex)
            .map((other) => other.id)
        : []
    return {
      ...change,
      dependsOn: [
        ...new Set([...structural, ...(dependency === undefined ? [] : [dependency.id])]),
      ],
    }
  })
}

export const acceptChanges = (
  current: BlockDocument,
  proposal: {
    readonly baseVersion: number
    readonly currentVersion: number
    readonly changes: readonly ProposedChange[]
    readonly selected: ReadonlySet<string>
  },
) => {
  if (proposal.baseVersion !== proposal.currentVersion) return { kind: "conflict" as const }
  const selected = proposal.changes.filter((change) => proposal.selected.has(change.id))
  if (selected.some((change) => change.dependsOn.some((id) => !proposal.selected.has(id))))
    return { kind: "dependency" as const }
  const replacements = new Map(selected.map((change) => [change.blockId, change]))
  const blocks = current.blocks.flatMap((block) => {
    const change = replacements.get(block.id)
    if (change === undefined) return [block]
    if (change.beforeIndex !== change.afterIndex) return []
    return change.after === null ? [] : [change.after]
  })
  for (const change of [...selected].sort((a, b) => (a.afterIndex ?? 0) - (b.afterIndex ?? 0))) {
    if (
      change.beforeIndex !== change.afterIndex &&
      change.after !== null &&
      change.afterIndex !== null
    )
      blocks.splice(change.afterIndex, 0, change.after)
  }
  return { kind: "accepted" as const, document: { ...current, blocks } }
}

export type SuggestionRequest = {
  readonly document: BlockDocument
  readonly instruction: string
  readonly signal: AbortSignal
}
export type SuggestionProvider = (request: SuggestionRequest) => AsyncIterable<BlockDocument>

export class SuggestionStream {
  private generation = 0
  private controller: AbortController | null = null
  cancel(reason = "execution-cancel") {
    this.generation += 1
    this.controller?.abort(reason)
    this.controller = null
  }
  async start(
    provider: SuggestionProvider,
    request: Omit<SuggestionRequest, "signal">,
    onCandidate: (candidate: BlockDocument) => void,
  ) {
    this.cancel("execution-cancel")
    const generation = this.generation
    const controller = new AbortController()
    this.controller = controller
    try {
      for await (const candidate of provider({ ...request, signal: controller.signal })) {
        if (controller.signal.aborted || generation !== this.generation) return "cancelled"
        onCandidate(candidate)
      }
      return controller.signal.aborted || generation !== this.generation ? "cancelled" : "completed"
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) return "cancelled"
      throw error
    } finally {
      if (generation === this.generation) this.controller = null
    }
  }
}
