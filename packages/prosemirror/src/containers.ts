import { blockAttrs } from "./schema.js"
import type { BlockRegistration } from "./types.js"

export const sectionTitle: BlockRegistration = {
  type: "__section_title",
  nodeName: "section_title",
  text: true,
  nodeSpec: {
    content: "inline*",
    marks: "_",
    toDOM: () => ["div", { "data-section-title": "true" }, 0],
  },
}

export const sectionBlock: BlockRegistration = {
  type: "section",
  nodeName: "section",
  text: false,
  container: "titled",
  titleNodeName: "section_title",
  nodeSpec: {
    group: "block",
    content: "section_title? block*",
    attrs: blockAttrs,
    toDOM: (node) => [
      "section",
      { "data-block-id": node.attrs["id"], "data-container": "section" },
      0,
    ],
  },
}

export const calloutBlock: BlockRegistration = {
  type: "callout",
  nodeName: "callout",
  text: false,
  container: "body",
  nodeSpec: {
    group: "block",
    content: "block*",
    attrs: blockAttrs,
    toDOM: (node) => [
      "aside",
      { "data-block-id": node.attrs["id"], "data-container": "callout" },
      0,
    ],
  },
}

export const containerQuoteBlock: BlockRegistration = {
  type: "quote",
  nodeName: "container_quote",
  text: false,
  container: "body",
  nodeSpec: {
    group: "block",
    content: "block*",
    attrs: blockAttrs,
    toDOM: (node) => [
      "blockquote",
      { "data-block-id": node.attrs["id"], "data-container": "quote" },
      0,
    ],
  },
}
