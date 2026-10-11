import { expect, it } from "vitest"
import {
  createWorkspaceProfile,
  pageDocumentToSnapshot,
  snapshotToPageDocument,
} from "../src/features/workspace/workspace-editor-model"
import { ModelSession } from "../src/pm/session"

it("round-trips workspace blocks through a contextual ProseMirror ModelSession", () => {
  const document = {
    pageId: "nested",
    version: 1,
    blocks: [
      { id: "h", type: "heading" as const, level: 2, text: "Context" },
      { id: "p", type: "paragraph" as const, text: "Body" },
      { id: "r", type: "page_ref" as const, pageId: "home" },
      { id: "s", type: "synced_ref" as const, occurrenceId: "o1", sourceId: "shared" },
      { id: "d", type: "database_embed" as const, databaseId: "tasks", layout: "table" as const },
    ],
  }
  const profile = createWorkspaceProfile(2)
  const session = new ModelSession({
    modelId: document.pageId,
    document: pageDocumentToSnapshot(document),
    epoch: 1,
    version: document.version,
    readOnly: false,
    profile,
  })

  expect(session.state.doc.child(0).type.name).toBe("heading")
  expect(session.state.doc.child(0).attrs["level"]).toBe(2)
  expect(snapshotToPageDocument(session.snapshot, document)).toEqual({ ...document, version: 2 })
})
