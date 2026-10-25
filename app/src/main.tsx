import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./styles.css"
import "./agent-workbench.css"
import "./block-interactions.css"
import "prosemirror-view/style/prosemirror.css"

if (import.meta.env.DEV && import.meta.env["VITE_DISABLE_REACT_DEVTOOLS"] !== "1") {
  void import("react-grab")
  void import("react-scan")
}

const root = document.getElementById("root")
if (root === null) throw new TypeError("Missing #root mount element")
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
