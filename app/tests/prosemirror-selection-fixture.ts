import {
  attachBlockSelection,
  type BlockSelectionOptions,
} from "@block-editor/interactions/prosemirror"
import { EditorView } from "prosemirror-view"
import { createEditorState } from "../src/pm/editor"
import { editorSchema } from "../src/pm/schema"

const views: EditorView[] = []
const detachments: Array<() => void> = []

export const cleanupSelectionViews = (): void => {
  for (const detach of detachments.splice(0)) detach()
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
}

export const trackSelectionView = (view: EditorView): void => {
  views.push(view)
}

export const createSelectionView = (overrides: Partial<BlockSelectionOptions> = {}) => {
  const paragraph = editorSchema.nodes.paragraph
  const documentNode = editorSchema.nodes.doc.create(undefined, [
    paragraph.create({ id: "first", locked: false }, editorSchema.text("First")),
    paragraph.create({ id: "second", locked: false }, editorSchema.text("Second")),
    paragraph.create({ id: "third", locked: false }, editorSchema.text("Third")),
    paragraph.create({ id: "fourth", locked: false }, editorSchema.text("Fourth")),
  ])
  const view = new EditorView(document.body, {
    state: createEditorState({ document: documentNode, readonly: false }),
  })
  views.push(view)
  const controller = attachBlockSelection(view, {
    clipboard: {
      namespace: "selection-test",
      cut: "remove-after-write",
      paste: () => "clone",
    },
    ...overrides,
  })
  detachments.push(controller.destroy)
  return { view, controller }
}

export const clipboardEvent = (
  type: "copy" | "cut" | "paste",
  initial: Readonly<Record<string, string>> = {},
) => {
  const data = new Map(Object.entries(initial))
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (mime: string) => data.get(mime) ?? "",
      setData: (mime: string, value: string) => data.set(mime, value),
      clearData: () => data.clear(),
    },
  })
  return { data, event }
}
