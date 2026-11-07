import { pmToSnapshot } from "@slop-lab/blocks-prosemirror"
import { convertSectionToSyncedSource, isOpaqueWorkspaceBlock } from "@slop-lab/blocks-workspace"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { EditorView, NodeView } from "prosemirror-view"
import { snapshotToPageDocument } from "./workspace-editor-model"
import { nodeViewButton, type WorkspaceNodeViewData } from "./workspace-node-view-types"

type LocalSectionOptions = {
  readonly node: ProseMirrorNode
  readonly view: EditorView
  readonly getPos: () => number | undefined
  readonly data: { current: WorkspaceNodeViewData }
}

export const createLocalSectionView = ({
  node,
  view,
  getPos,
  data,
}: LocalSectionOptions): NodeView => {
  const dom = view.dom.ownerDocument.createElement("section")
  dom.className = "structured-section"
  dom.dataset["blockId"] = String(node.attrs["id"])
  const controls = view.dom.ownerDocument.createElement("header")
  controls.className = "structured-section__controls"
  const contentDOM = view.dom.ownerDocument.createElement("div")
  contentDOM.className = "structured-section__body"
  let currentNode = node
  const title = nodeViewButton(view.dom.ownerDocument, "Add title", () => {
    const position = getPos()
    if (position === undefined) return
    const first = currentNode.firstChild
    if (first?.type.name === "section_title")
      view.dispatch(view.state.tr.delete(position + 1, position + 1 + first.nodeSize))
    else {
      const titleType = view.state.schema.nodes["section_title"]
      if (titleType !== undefined)
        view.dispatch(view.state.tr.insert(position + 1, titleType.create()))
    }
  })
  const share = nodeViewButton(view.dom.ownerDocument, "Convert to shared section", () => {
    if (getPos() === undefined) return
    const document = currentNode.type.schema.topNodeType.create(null, [currentNode])
    const converted = snapshotToPageDocument(pmToSnapshot(document, data.current.profile), {
      pageId: "shared-conversion",
      version: 1,
      blocks: [],
    }).blocks[0]
    if (converted?.type !== "section" || isOpaqueWorkspaceBlock(converted)) return
    const result = convertSectionToSyncedSource(converted, () => crypto.randomUUID())
    void data.current.onSourceCreate(result.source).then((created) => {
      if (created === null) return
      if (!data.current.sources.some((record) => record.content.id === created.content.id))
        data.current = { ...data.current, sources: [...data.current.sources, created] }
      const position = getPos()
      if (position === undefined) return
      view.dispatch(
        view.state.tr.replaceWith(
          position,
          position + currentNode.nodeSize,
          currentNode.type.create({
            ...currentNode.attrs,
            occurrenceId: result.occurrence.occurrenceId,
            sourceId: created.content.id,
          }),
        ),
      )
    })
  })
  const renderControls = () => {
    title.textContent =
      currentNode.firstChild?.type.name === "section_title" ? "Remove title" : "Add title"
  }
  renderControls()
  controls.append(title, share)
  dom.append(controls, contentDOM)
  return {
    dom,
    contentDOM,
    update: (next) => {
      if (next.type !== currentNode.type || String(next.attrs["sourceId"] ?? "") !== "")
        return false
      currentNode = next
      renderControls()
      return true
    },
  }
}
