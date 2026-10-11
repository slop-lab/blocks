import { lazy, Suspense, useState } from "react"
import { DocumentPanel } from "./components/DocumentPanel"
import { EditorSurface } from "./components/EditorSurface"
import { ExportDialog } from "./components/ExportDialog"
import { HostFormDialog } from "./components/HostFormDialog"
import { ReviewDialog } from "./components/ReviewDialog"
import type { RouteId } from "./components/Sidebar"
import { Sidebar } from "./components/Sidebar"
import { StaticViewer } from "./components/StaticViewer"
import { Toolbar } from "./components/Toolbar"
import { WorkspaceHeader } from "./components/WorkspaceHeader"
import { isContentRoute } from "./host/documents"
import { useWorkspace } from "./host/useWorkspace"

const MarkdownWorkspace = lazy(() =>
  import("./features/markdown/MarkdownWorkspace").then((module) => ({
    default: module.MarkdownWorkspace,
  })),
)
const GitDocumentsWorkspace = lazy(() =>
  import("./features/git-documents/GitDocumentsWorkspace").then((module) => ({
    default: module.GitDocumentsWorkspace,
  })),
)
const CollaborationWorkspace = lazy(() =>
  import("./features/collaboration/CollaborationWorkspace").then((module) => ({
    default: module.CollaborationWorkspace,
  })),
)
const CompositeWorkspace = lazy(() =>
  import("./features/composite/CompositeWorkspace").then((module) => ({
    default: module.CompositeWorkspace,
  })),
)
const LargeContentWorkspace = lazy(() =>
  import("./features/large-content/LargeContentWorkspace").then((module) => ({
    default: module.LargeContentWorkspace,
  })),
)
const WorkflowWorkspace = lazy(() =>
  import("./features/workflow/WorkflowWorkspace").then((module) => ({
    default: module.WorkflowWorkspace,
  })),
)
const OwnershipExamplesWorkspace = lazy(() =>
  import("./features/ownership/OwnershipExamplesWorkspace").then((module) => ({
    default: module.OwnershipExamplesWorkspace,
  })),
)
const StructuredWorkspace = lazy(() =>
  import("./features/workspace/StructuredWorkspace").then((module) => ({
    default: module.StructuredWorkspace,
  })),
)

export const App = () => {
  const workspace = useWorkspace()
  const [visited, setVisited] = useState<ReadonlySet<RouteId>>(() => new Set([workspace.route]))
  const navigate = (route: RouteId) => {
    if (workspace.navigate(route) && !isContentRoute(route))
      setVisited((current) => new Set([...current, route]))
  }
  const local = isContentRoute(workspace.route)
  const shellClass = local
    ? "app-shell"
    : workspace.route === "git-documents"
      ? "app-shell app-shell--feature app-shell--git-documents"
      : workspace.route === "structured-workspace"
        ? "app-shell app-shell--feature app-shell--structured"
        : "app-shell app-shell--feature"
  const sessionKey = `${workspace.contentRoute}-${workspace.session.epoch}-${workspace.session.surfaceRevision}`
  return (
    <div className={shellClass}>
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      {workspace.route !== "git-documents" && workspace.route !== "structured-workspace" && (
        <Sidebar route={workspace.route} onNavigate={navigate} />
      )}
      {local ? (
        <>
          <section className="workspace">
            <WorkspaceHeader
              route={workspace.contentRoute}
              dirty={workspace.contentDirty}
              preview={workspace.preview}
              onSave={workspace.save}
              onTogglePreview={workspace.togglePreview}
              onCreateReview={workspace.createReview}
              onOpenExport={workspace.openExport}
              onReset={workspace.reset}
            />
            <Toolbar
              view={workspace.view}
              readOnly={workspace.route === "readonly" || workspace.preview}
            />
            <main className="canvas" id="main-content">
              {workspace.preview ? (
                <StaticViewer
                  document={workspace.session.document}
                  tasks={workspace.hostState.tasks}
                  onHostAction={workspace.toggleHostTask}
                />
              ) : (
                <EditorSurface
                  key={sessionKey}
                  document={workspace.session.document}
                  readOnly={workspace.route === "readonly"}
                  epoch={workspace.session.epoch}
                  version={workspace.session.version}
                  tasks={workspace.hostState.tasks}
                  onReady={workspace.onReady}
                  onHostAction={workspace.toggleHostTask}
                  onSelectionChange={workspace.selectBlock}
                  onCompositionChange={workspace.onCompositionChange}
                  getSession={workspace.getSession}
                  onUnavailable={workspace.notifyUnavailable}
                  onBlur={workspace.onBlur}
                />
              )}
            </main>
            {workspace.toast && (
              <div className="toast" role="status" aria-live="polite">
                {workspace.toast}
              </div>
            )}
          </section>
          <DocumentPanel
            saveMode={workspace.saveMode}
            onSaveMode={workspace.setSaveMode}
            dirty={workspace.contentDirty}
            hostDirty={workspace.hostDirty}
            onSave={workspace.save}
            onForm={workspace.openHostForm}
            onReview={workspace.createReview}
            onRefresh={workspace.applyExternal}
          />
        </>
      ) : null}
      <main className="feature-workspace" hidden={local} id={local ? undefined : "main-content"}>
        <Suspense fallback={<p role="status">문서를 여는 중…</p>}>
          <div hidden={workspace.route !== "markdown"}>
            {visited.has("markdown") && <MarkdownWorkspace />}
          </div>
          <div hidden={workspace.route !== "git-documents"}>
            {visited.has("git-documents") && <GitDocumentsWorkspace />}
          </div>
          <div hidden={workspace.route !== "collaboration"}>
            {visited.has("collaboration") && <CollaborationWorkspace />}
          </div>
          <div hidden={workspace.route !== "composite"}>
            {visited.has("composite") && <CompositeWorkspace />}
          </div>
          <div hidden={workspace.route !== "large-content"}>
            {visited.has("large-content") && <LargeContentWorkspace />}
          </div>
          <div hidden={workspace.route !== "workflow"}>
            {visited.has("workflow") && <WorkflowWorkspace />}
          </div>
          <div hidden={workspace.route !== "ownership"}>
            {visited.has("ownership") && <OwnershipExamplesWorkspace />}
          </div>
          <div hidden={workspace.route !== "structured-workspace"}>
            {visited.has("structured-workspace") && <StructuredWorkspace />}
          </div>
        </Suspense>
      </main>
      {workspace.exportOpen && (
        <ExportDialog
          document={workspace.session.document}
          onClose={workspace.closeExport}
          onImport={workspace.importDocument}
        />
      )}
      {workspace.hostFormOpen && (
        <HostFormDialog
          form={workspace.hostState.releaseForm}
          onClose={workspace.closeHostForm}
          onSave={workspace.saveHostDraft}
        />
      )}
      {workspace.review !== null && (
        <ReviewDialog
          before={workspace.review.before}
          candidate={workspace.review.candidate}
          onClose={workspace.rejectReview}
          onAccept={workspace.acceptCandidate}
        />
      )}
    </div>
  )
}
