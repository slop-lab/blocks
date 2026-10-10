const icon = (ownerDocument: Document, kind: "plus" | "grip"): SVGSVGElement => {
  const svg = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 16 16")
  svg.setAttribute("aria-hidden", "true")
  if (kind === "plus") {
    const path = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", "M8 3v10M3 8h10")
    path.setAttribute("stroke", "currentColor")
    path.setAttribute("stroke-width", "1.6")
    path.setAttribute("stroke-linecap", "round")
    svg.append(path)
  } else {
    for (const x of [5, 11]) {
      for (const y of [3, 8, 13]) {
        const circle = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "circle")
        circle.setAttribute("cx", String(x))
        circle.setAttribute("cy", String(y))
        circle.setAttribute("r", "1.25")
        circle.setAttribute("fill", "currentColor")
        svg.append(circle)
      }
    }
  }
  return svg
}

const button = (ownerDocument: Document, label: string, kind: "plus" | "grip") => {
  const control = ownerDocument.createElement("button")
  control.type = "button"
  control.className = `block-control block-control--${kind}`
  control.ariaLabel = label
  control.title = label
  control.append(icon(ownerDocument, kind))
  return control
}

export const createBlockControls = (ownerDocument: Document) => {
  const rail = ownerDocument.createElement("div")
  rail.className = "block-controls"
  rail.hidden = true
  const add = button(ownerDocument, "이 블록 뒤에 문단 추가", "plus")
  const grip = button(ownerDocument, "블록 메뉴 및 드래그", "grip")
  grip.setAttribute("aria-haspopup", "menu")
  rail.append(add, grip)
  ownerDocument.body.append(rail)
  return { rail, add, grip }
}
