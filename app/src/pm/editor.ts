import { baseKeymap } from "prosemirror-commands"
import { history, redo, undo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { Command, Transaction } from "prosemirror-state"
import { EditorState, Plugin } from "prosemirror-state"
import type { ChangeEvent, ChangeOrigin } from "../core/types"
import type { ProseMirrorProfile } from "@block-editor/prosemirror"
import { defaultProfile } from "@block-editor/prosemirror/preset"
import { createClipboardPlugin } from "./clipboard"
import { deleteBlock, duplicateBlock, moveBlock, toggleFormat } from "./commands"
import { createProfilePlugin } from "./profile-plugin"

type LockedNode = { readonly position: number; readonly json: string }

const lockedNodes = (document: ProseMirrorNode): readonly LockedNode[] => {
  const result: LockedNode[] = []
  document.forEach((node, position) => {
    const id = node.attrs["id"]
    if (node.attrs["locked"] === true && typeof id === "string")
      result.push({ position, json: JSON.stringify(node.toJSON()) })
  })
  return result
}

const respectsLockedBlocks = (transaction: Transaction, state: EditorState): boolean => {
  if (!transaction.docChanged) return true
  for (const locked of lockedNodes(state.doc)) {
    const mapped = transaction.mapping.mapResult(locked.position, 1)
    if (mapped.deleted) return false
    const after = transaction.doc.nodeAt(mapped.pos)
    if (after === null || JSON.stringify(after.toJSON()) !== locked.json) return false
  }
  return true
}

export const createLockedBlockPlugin = (
  acceptsExternalTransaction: (transaction: Transaction) => boolean = () => false,
) =>
  new Plugin({
    filterTransaction: (transaction, state) =>
      acceptsExternalTransaction(transaction) || respectsLockedBlocks(transaction, state),
  })

export const lockedBlockPlugin = createLockedBlockPlugin()

export const createIdentityPlugin = (
  shouldRepair: (transactions: readonly Transaction[]) => boolean = () => true,
) =>
  new Plugin({
    appendTransaction: (transactions, _oldState, newState) => {
      if (
        !transactions.some((transaction) => transaction.docChanged) ||
        !shouldRepair(transactions)
      )
        return null
      const ids = new Set<string>()
      let repair = newState.tr
      newState.doc.forEach((node, position) => {
        const current = node.attrs["id"]
        const valid = typeof current === "string" && current.length > 0 && !ids.has(current)
        if (valid) {
          ids.add(current)
          return
        }
        const id = crypto.randomUUID()
        ids.add(id)
        repair = repair.setNodeMarkup(position, undefined, { ...node.attrs, id })
      })
      return repair.docChanged ? repair.setMeta("origin", "local") : null
    },
  })

export const identityPlugin = createIdentityPlugin()

const historyCommand =
  (command: Command): Command =>
  (state, dispatch, view) =>
    command(
      state,
      dispatch === undefined
        ? undefined
        : (transaction) => dispatch(transaction.setMeta("origin", "history")),
      view,
    )

export type EditorSessionOptions = {
  readonly document: ProseMirrorNode
  readonly readonly: boolean
  readonly profile?: ProseMirrorProfile
}

export const createEditorState = (options: EditorSessionOptions): EditorState =>
  EditorState.create({
    schema: options.profile?.schema ?? defaultProfile.schema,
    doc: options.document,
    plugins: [
      history(),
      createProfilePlugin(options.profile ?? defaultProfile),
      new Plugin({
        filterTransaction: (transaction) => !options.readonly || !transaction.docChanged,
      }),
      lockedBlockPlugin,
      identityPlugin,
      createClipboardPlugin(options.profile ?? defaultProfile),
      keymap({
        "Mod-b": toggleFormat("strong"),
        "Mod-i": toggleFormat("em"),
        "Mod-z": historyCommand(undo),
        "Mod-Shift-z": historyCommand(redo),
        "Mod-y": historyCommand(redo),
        "Mod-Shift-d": duplicateBlock,
        "Alt-ArrowUp": moveBlock(-1),
        "Alt-ArrowDown": moveBlock(1),
        "Mod-Backspace": deleteBlock,
      }),
      keymap(baseKeymap),
    ],
  })

const transactionOrigin = (transaction: Transaction): ChangeOrigin => {
  const origin = transaction.getMeta("origin")
  switch (origin) {
    case "local":
    case "remote":
    case "host":
    case "review":
    case "reset":
    case "history":
      return origin
    default:
      return transaction.getMeta("history$") === undefined ? "local" : "history"
  }
}

const blockRevisions = (document: ProseMirrorNode): ReadonlyMap<string, ProseMirrorNode> => {
  const revisions = new Map<string, ProseMirrorNode>()
  document.forEach((node) => {
    const id = node.attrs["id"]
    if (typeof id === "string") revisions.set(id, node)
  })
  return revisions
}

const changedBlockIds = (transaction: Transaction): readonly string[] => {
  if (!transaction.docChanged) return []
  const before = blockRevisions(transaction.before)
  const after = blockRevisions(transaction.doc)
  return [...before.keys(), ...[...after.keys()].filter((id) => !before.has(id))].filter((id) => {
    const previous = before.get(id)
    const current = after.get(id)
    return previous === undefined || current === undefined || !previous.eq(current)
  })
}

export const changeEventFrom = (
  transaction: Transaction,
  previousVersion: number,
  epoch: number,
): ChangeEvent => {
  const modelId = transaction.getMeta("modelId")
  const causeId = transaction.getMeta("causeId")
  const patch = transaction.getMeta("patch")
  return {
    origin: transactionOrigin(transaction),
    version: previousVersion + (transaction.docChanged ? 1 : 0),
    beforeVersion: previousVersion,
    epoch,
    changeId: crypto.randomUUID(),
    historyGroup:
      typeof transaction.getMeta("historyGroup") === "string"
        ? transaction.getMeta("historyGroup")
        : null,
    changedBlockIds: changedBlockIds(transaction),
    ...(typeof modelId === "string" ? { modelId } : {}),
    ...(typeof causeId === "string" ? { causeId } : {}),
    ...(patch === undefined ? {} : { patch }),
  }
}
