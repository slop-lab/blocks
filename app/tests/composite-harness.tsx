import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { CompositeWorkspace } from "../src/features/composite/CompositeWorkspace"
import "../src/styles.css"
import "prosemirror-view/style/prosemirror.css"

const root = document.getElementById("root")
if (root === null) throw new TypeError("Missing composite harness root")
createRoot(root).render(
  <StrictMode>
    <CompositeWorkspace />
  </StrictMode>,
)
