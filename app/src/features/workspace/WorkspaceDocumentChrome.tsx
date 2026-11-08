import type { PageDocument, Workspace } from "@slop-lab/blocks-workspace"
import { useState } from "react"

type ToolsProps = {
  readonly workspace: Workspace
  readonly document: PageDocument
  readonly pasteMode: "clone" | "reference"
  readonly onDocument: (document: PageDocument) => void
  readonly onPasteMode: (mode: "clone" | "reference") => void
}

export const WorkspaceDocumentTools = (props: ToolsProps) => {
  const [referencePageId, setReferencePageId] = useState(
    props.workspace.pages.find((page) => page.id !== props.document.pageId && !page.archived)?.id ??
      "",
  )
  return (
    <>
      <section className="structured-document__tools" aria-label="Document block tools">
        <label>
          Page to link
          <select
            aria-label="Page to link"
            value={referencePageId}
            onChange={(event) => setReferencePageId(event.currentTarget.value)}
          >
            {props.workspace.pages
              .filter((page) => page.id !== props.document.pageId && !page.archived)
              .map((page) => (
                <option value={page.id} key={page.id}>
                  {page.title}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          disabled={referencePageId.length === 0}
          onClick={() =>
            props.onDocument({
              ...props.document,
              version: props.document.version + 1,
              blocks: [
                ...props.document.blocks,
                {
                  id: `page-ref-${crypto.randomUUID()}`,
                  type: "page_ref",
                  pageId: referencePageId,
                },
              ],
            })
          }
        >
          Add page link
        </button>
      </section>
      <label className="structured-paste-policy">
        Paste behavior
        <select
          value={props.pasteMode}
          onChange={(event) =>
            props.onPasteMode(event.currentTarget.value === "reference" ? "reference" : "clone")
          }
        >
          <option value="clone">Independent copy</option>
          <option value="reference">Shared source reference</option>
        </select>
      </label>
    </>
  )
}

type BacklinksProps = {
  readonly backlinks: readonly {
    readonly blockId: string
    readonly pageId: string
    readonly title: string
  }[]
  readonly onOpenPage: (id: string, blockId?: string) => void
}

export const WorkspaceBacklinks = ({ backlinks, onOpenPage }: BacklinksProps) => (
  <nav className="structured-backlinks" aria-label="Backlinks">
    <h2>Documents linking to this page</h2>
    {backlinks.length === 0 ? (
      <p>No documents link to this page yet.</p>
    ) : (
      <ul>
        {backlinks.map((backlink) => (
          <li key={`${backlink.pageId}:${backlink.blockId}`}>
            <button
              className="structured-backlinks__link"
              type="button"
              onClick={() => onOpenPage(backlink.pageId, backlink.blockId)}
            >
              {backlink.title}
            </button>
          </li>
        ))}
      </ul>
    )}
  </nav>
)
