import type { Database, PageDocument, SyncedSource, Workspace } from "@block-editor/workspace"
import { WorkspaceDatabase } from "./WorkspaceDatabase"
import { WorkspaceEditor } from "./WorkspaceEditor"

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
  readonly onCompositionChange?: (composing: boolean) => void
}

export const WorkspaceDocument = (props: Props) => (
  <article className="structured-document" aria-label="구조화 문서 편집기">
    <WorkspaceEditor
      workspace={props.workspace}
      document={props.document}
      depth={props.depth}
      databases={props.databases}
      sources={props.sources}
      onDocument={props.onDocument}
      onSourceEdit={props.onSourceEdit}
      onOpenPage={props.onOpenPage}
      onCompositionChange={props.onCompositionChange ?? (() => {})}
    />
    {props.document.blocks.flatMap((block) => {
      if (block.type !== "database_embed") return []
      const database = props.databases.find((candidate) => candidate.id === block.databaseId)
      return database === undefined
        ? [<p key={block.id}>데이터베이스를 찾을 수 없습니다.</p>]
        : [<WorkspaceDatabase key={block.id} database={database} onChange={props.onDatabase} />]
    })}
  </article>
)
