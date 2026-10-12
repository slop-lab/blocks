import type { Database, PageDocument, SyncedSource, Workspace } from "@block-editor/workspace"
import { useState } from "react"
import { WorkspaceDatabase } from "./WorkspaceDatabase"
import { WorkspaceEditor } from "./WorkspaceEditor"
import { embeddedDatabaseIds } from "./workspace-editor-model"

type Props = {
  readonly workspace: Workspace
  readonly document: PageDocument
  readonly depth: number
  readonly databases: readonly Database[]
  readonly sources: readonly SyncedSource[]
  readonly onDocument: (document: PageDocument) => void
  readonly onDatabase: (database: Database) => void
  readonly onSourceEdit: (source: SyncedSource) => void
  readonly onSourceCreate: (source: SyncedSource) => Promise<boolean>
  readonly backlinks: readonly {
    readonly blockId: string
    readonly pageId: string
    readonly title: string
  }[]
  readonly onOpenPage: (id: string, blockId?: string) => void
  readonly onCompositionChange?: (composing: boolean) => void
  readonly pasteMode: "clone" | "reference"
  readonly onPasteMode: (mode: "clone" | "reference") => void
}

export const WorkspaceDocument = (props: Props) => {
  const [referencePageId, setReferencePageId] = useState(
    props.workspace.pages.find((page) => page.id !== props.document.pageId && !page.archived)?.id ??
      "",
  )
  return (
    <article className="structured-document" aria-label="구조화 문서 편집기">
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
      <WorkspaceEditor
        workspace={props.workspace}
        document={props.document}
        depth={props.depth}
        databases={props.databases}
        sources={props.sources}
        onDocument={props.onDocument}
        onSourceEdit={props.onSourceEdit}
        onSourceCreate={props.onSourceCreate}
        onOpenPage={props.onOpenPage}
        onCompositionChange={props.onCompositionChange ?? (() => {})}
        pasteMode={props.pasteMode}
      />
      {embeddedDatabaseIds(props.document.blocks).map((databaseId) => {
        const database = props.databases.find((candidate) => candidate.id === databaseId)
        return database === undefined ? (
          <p key={databaseId}>데이터베이스를 찾을 수 없습니다.</p>
        ) : (
          <WorkspaceDatabase key={databaseId} database={database} onChange={props.onDatabase} />
        )
      })}
      <nav className="structured-backlinks" aria-label="백링크">
        <h2>이 페이지를 연결한 문서</h2>
        {props.backlinks.length === 0 ? (
          <p>아직 연결한 문서가 없습니다.</p>
        ) : (
          <ul>
            {props.backlinks.map((backlink) => (
              <li key={`${backlink.pageId}:${backlink.blockId}`}>
                <button
                  className="structured-backlinks__link"
                  type="button"
                  onClick={() => props.onOpenPage(backlink.pageId, backlink.blockId)}
                >
                  {backlink.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </article>
  )
}
