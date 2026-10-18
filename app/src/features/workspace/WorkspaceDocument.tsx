import type { Database, PageDocument, SyncedSource, Workspace } from "@slop-lab/blocks-workspace"
import { useCallback, useEffect, useMemo, useState } from "react"
import { WorkspaceDatabase } from "./WorkspaceDatabase"
import { WorkspaceBacklinks, WorkspaceDocumentTools } from "./WorkspaceDocumentChrome"
import { WorkspaceEditor } from "./WorkspaceEditor"
import { WorkspaceFocusBreadcrumbs } from "./WorkspaceFocusBreadcrumbs"
import type { EntityRecord } from "./workspace-api"
import { embeddedDatabaseIds } from "./workspace-editor-model"
import {
  focusedLocalBlocks,
  focusHash,
  parseFocusHash,
  resolveWorkspaceFocus,
  sameFocusTarget,
  type WorkspaceFocusTarget,
} from "./workspace-focus-navigation"
import type { WorkspaceFocusChange } from "./workspace-focus-selection"
import type { SourceEditRequest } from "./workspace-node-view-types"
import type { WorkspaceSourceRuntime } from "./workspace-source-runtime"

type Props = {
  readonly workspace: Workspace
  readonly document: PageDocument
  readonly depth: number
  readonly databases: readonly Database[]
  readonly sources: readonly EntityRecord<SyncedSource>[]
  readonly onDocument: (document: PageDocument) => void
  readonly onDatabase: (database: Database) => void
  readonly onSourceEdit: (request: SourceEditRequest) => void
  readonly onSourceCreate: (source: SyncedSource) => Promise<EntityRecord<SyncedSource> | null>
  readonly onSourceCompositionChange: (sourceId: string, composing: boolean) => void
  readonly onSourceConflictResolve: (
    sourceId: string,
    resolution: "accept-remote" | "keep-local",
  ) => void
  readonly backlinks: readonly {
    readonly blockId: string
    readonly pageId: string
    readonly title: string
  }[]
  readonly onOpenPage: (id: string, blockId?: string) => void
  readonly onCompositionChange?: (composing: boolean) => void
  readonly pasteMode: "clone" | "reference"
  readonly onPasteMode: (mode: "clone" | "reference") => void
  readonly sourceController: WorkspaceSourceRuntime
}

export const WorkspaceDocument = (props: Props) => {
  const [focusTarget, setFocusTarget] = useState<WorkspaceFocusTarget | null>(() =>
    parseFocusHash(window.location.hash),
  )
  const [previousAncestors, setPreviousAncestors] = useState<readonly string[]>([])
  const pageTitle =
    props.workspace.pages.find((page) => page.id === props.document.pageId)?.title ??
    props.document.pageId
  const focus = useMemo(
    () =>
      focusTarget === null
        ? null
        : resolveWorkspaceFocus({
            pageTitle,
            document: props.document,
            sources: props.sources.map((record) => record.content),
            target: focusTarget,
            previousAncestors,
          }),
    [focusTarget, pageTitle, previousAncestors, props.document, props.sources],
  )
  useEffect(() => {
    const syncFocus = () => setFocusTarget(parseFocusHash(window.location.hash))
    window.addEventListener("hashchange", syncFocus)
    window.addEventListener("popstate", syncFocus)
    return () => {
      window.removeEventListener("hashchange", syncFocus)
      window.removeEventListener("popstate", syncFocus)
    }
  }, [])
  useEffect(() => {
    if (focus !== null)
      setPreviousAncestors((current) =>
        current.length === focus.ancestorBlockIds.length &&
        current.every((blockId, index) => blockId === focus.ancestorBlockIds[index])
          ? current
          : focus.ancestorBlockIds,
      )
  }, [focus])
  const navigateFocus = useCallback(
    (target: WorkspaceFocusTarget | null, replace = false) => {
      const url = new URL(window.location.href)
      url.searchParams.set("page", props.document.pageId)
      url.hash = target === null ? "" : focusHash(target)
      window.history[replace ? "replaceState" : "pushState"](window.history.state, "", url)
      setFocusTarget(target)
    },
    [props.document.pageId],
  )
  const followFocus = useCallback(
    (change: WorkspaceFocusChange) => {
      setPreviousAncestors(change.ancestorBlockIds)
      navigateFocus(change.target, true)
    },
    [navigateFocus],
  )
  useEffect(() => {
    if (focusTarget === null) return
    const resolvedTarget = focus?.target ?? null
    if (sameFocusTarget(focusTarget, resolvedTarget)) return
    navigateFocus(resolvedTarget, true)
  }, [focus, focusTarget, navigateFocus])
  return (
    <article className="structured-document" aria-label="구조화 문서 편집기">
      {focus !== null && (
        <WorkspaceFocusBreadcrumbs focus={focus} onNavigate={(target) => navigateFocus(target)} />
      )}
      {focus === null && <WorkspaceDocumentTools {...props} />}
      <WorkspaceEditor
        workspace={props.workspace}
        document={props.document}
        depth={props.depth}
        databases={props.databases}
        sources={props.sources}
        onDocument={props.onDocument}
        onSourceEdit={props.onSourceEdit}
        onSourceCreate={props.onSourceCreate}
        onSourceCompositionChange={props.onSourceCompositionChange}
        onSourceConflictResolve={props.onSourceConflictResolve}
        onOpenPage={props.onOpenPage}
        onCompositionChange={props.onCompositionChange ?? (() => {})}
        pasteMode={props.pasteMode}
        sourceController={props.sourceController}
        focusTarget={focus?.target ?? null}
        onOpenBlock={(target) => navigateFocus(target)}
        onFocusChange={followFocus}
      />
      {embeddedDatabaseIds(focusedLocalBlocks(props.document, focus)).map((databaseId) => {
        const database = props.databases.find((candidate) => candidate.id === databaseId)
        return database === undefined ? (
          <p key={databaseId}>데이터베이스를 찾을 수 없습니다.</p>
        ) : (
          <WorkspaceDatabase key={databaseId} database={database} onChange={props.onDatabase} />
        )
      })}
      {focus === null && <WorkspaceBacklinks {...props} />}
    </article>
  )
}
