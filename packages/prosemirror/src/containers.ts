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
  insertMenu: [{ label: "Section", description: "Group of nested blocks", keywords: ["section"] }],
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
  insertMenu: [
    {
      label: "Callout",
      description: "Group of highlighted blocks",
      keywords: ["callout", "highlight"],
    },
  ],
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
  insertMenu: [{ label: "Quote", description: "Group of quoted blocks", keywords: ["quote"] }],
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
