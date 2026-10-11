import {
  type Database,
  headingLevelAtDepth,
  type PageDocument,
  type SyncedSource,
  type Workspace,
} from "@block-editor/workspace"
import { createElement } from "react"
import { WorkspaceDatabase } from "./WorkspaceDatabase"

type Props = {
  readonly workspace: Workspace
  readonly document: PageDocument
  readonly depth: number
  readonly databases: readonly Database[]
  readonly sources: readonly SyncedSource[]
  readonly onDocument: (document: PageDocument) => void
  readonly onDatabase: (database: Database) => void
  readonly onSourceEdit: (source: SyncedSource) => void
  readonly onOpenPage: (id: string) => void
}

export const WorkspaceDocument = (props: Props) => (
  <article className="structured-document" aria-label="구조화 문서 편집기">
    {props.document.blocks.map((block, index) => {
      if (block.type === "heading") {
        const level = headingLevelAtDepth(block.level, props.depth)
        return createElement(
          `h${level}`,
          { key: block.id, "data-authored-level": block.level },
          <input
            aria-label={`제목 ${index + 1}`}
            value={block.text}
            onChange={(event) =>
              props.onDocument({
                ...props.document,
                blocks: props.document.blocks.map((candidate) =>
                  candidate.id === block.id ? { ...block, text: event.target.value } : candidate,
                ),
              })
            }
          />,
        )
      }
      if (block.type === "paragraph" || block.type === "quote" || block.type === "code")
        return (
          <textarea
            key={block.id}
            className={`structured-block structured-block--${block.type}`}
            aria-label={`블록 ${index + 1}`}
            value={block.text}
            onChange={(event) =>
              props.onDocument({
                ...props.document,
                blocks: props.document.blocks.map((candidate) =>
                  candidate.id === block.id ? { ...block, text: event.target.value } : candidate,
                ),
              })
            }
          />
        )
      if (block.type === "page_ref") {
        const page = props.workspace.pages.find((candidate) => candidate.id === block.pageId)
        return (
          <button
            className="structured-page-ref"
            type="button"
            key={block.id}
            onClick={() => props.onOpenPage(block.pageId)}
          >
            연결된 페이지 · {page?.title ?? block.pageId}
          </button>
        )
      }
      if (block.type === "synced_ref") {
        const source = props.sources.find((candidate) => candidate.id === block.sourceId)
        return (
          <section
            className="structured-sync"
            key={block.id}
            data-occurrence-id={block.occurrenceId}
          >
            <header>
              <span>공유 블록 · v{source?.version ?? 0}</span>
              {source !== undefined && (
                <button type="button" onClick={() => props.onSourceEdit(source)}>
                  공유 원본 편집
                </button>
              )}
            </header>
            {source?.blocks.map((item) =>
              item.type === "heading" ? (
                createElement(
                  `h${headingLevelAtDepth(item.level, props.depth)}`,
                  { key: item.id },
                  item.text,
                )
              ) : (
                <p key={item.id}>{item.text}</p>
              ),
            )}
          </section>
        )
      }
      const database = props.databases.find((candidate) => candidate.id === block.databaseId)
      return database === undefined ? (
        <p key={block.id}>데이터베이스를 찾을 수 없습니다.</p>
      ) : (
        <WorkspaceDatabase key={block.id} database={database} onChange={props.onDatabase} />
      )
    })}
  </article>
)
