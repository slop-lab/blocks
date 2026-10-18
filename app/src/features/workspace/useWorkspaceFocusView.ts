import type { EditorView } from "prosemirror-view"
import { type RefObject, useEffect } from "react"
import type { WorkspaceFocusTarget } from "./workspace-focus-navigation"
import { workspaceFocusDecorations } from "./workspace-focus-view"
import type { WorkspaceNodeViewData } from "./workspace-node-view-types"

type WorkspaceFocusViewOptions = {
  readonly view: RefObject<EditorView | null>
  readonly data: RefObject<WorkspaceNodeViewData>
  readonly refreshNodeViews: RefObject<() => void>
  readonly target: WorkspaceFocusTarget | null
}

export const useWorkspaceFocusView = (options: WorkspaceFocusViewOptions): void => {
  useEffect(() => {
    const view = options.view.current
    if (view === null) return
    options.data.current = { ...options.data.current, focusTarget: options.target }
    view.setProps({
      decorations: (state) => workspaceFocusDecorations(state.doc, options.target),
    })
    options.refreshNodeViews.current()
  }, [options.data, options.refreshNodeViews, options.target, options.view])
}
