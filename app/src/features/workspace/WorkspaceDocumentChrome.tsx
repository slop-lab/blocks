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
      <section className="structured-document__tools" aria-label="문서 블록 도구">
        <label>
          연결할 페이지
          <select
            aria-label="연결할 페이지"
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
          페이지 연결 추가
        </button>
      </section>
      <label className="structured-paste-policy">
        붙여넣기 방식
        <select
          value={props.pasteMode}
          onChange={(event) =>
            props.onPasteMode(event.currentTarget.value === "reference" ? "reference" : "clone")
          }
        >
          <option value="clone">독립 복제</option>
          <option value="reference">공유 원본 참조</option>
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
  <nav className="structured-backlinks" aria-label="백링크">
    <h2>이 페이지를 연결한 문서</h2>
    {backlinks.length === 0 ? (
      <p>아직 연결한 문서가 없습니다.</p>
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
