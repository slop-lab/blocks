import { Schema } from "prosemirror-model"

const blockAttrs = {
  id: { default: "" },
  locked: { default: false },
  snapshotAttrs: { default: {} },
  blockExtras: { default: {} },
  snapshotType: { default: "" },
}

const markAttrs = { snapshot: { default: null } }

export const editorSchema = new Schema({
  nodes: {
    doc: { content: "block+", attrs: { documentExtras: { default: {} } } },
    text: { group: "inline" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: blockAttrs,
      toDOM: (node) => [
        "p",
        { "data-block-id": node.attrs["id"], "data-locked": node.attrs["locked"] },
        0,
      ],
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { ...blockAttrs, level: { default: 2 } },
      toDOM: (node) => [
        `h${String(node.attrs["level"])}`,
        { "data-block-id": node.attrs["id"] },
        0,
      ],
    },
    blockquote: {
      group: "block",
      content: "inline*",
      attrs: blockAttrs,
      toDOM: (node) => ["blockquote", { "data-block-id": node.attrs["id"] }, 0],
    },
    code_block: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      attrs: blockAttrs,
      toDOM: (node) => ["pre", { "data-block-id": node.attrs["id"] }, ["code", 0]],
    },
    caption: {
      group: "block",
      content: "inline*",
      attrs: { ...blockAttrs, refBlockId: { default: "" } },
      toDOM: (node) => ["figcaption", { "data-block-id": node.attrs["id"] }, 0],
    },
    task_card: {
      group: "block",
      atom: true,
      selectable: true,
      attrs: {
        ...blockAttrs,
        taskId: { default: "" },
        title: { default: "" },
        status: { default: "open" },
      },
      toDOM: (node) => ["div", { "data-block-id": node.attrs["id"], "data-task-card": "true" }],
    },
    opaque: {
      group: "block",
      atom: true,
      selectable: true,
      attrs: { ...blockAttrs, raw: { default: "{}" }, originalType: { default: "unknown" } },
      toDOM: (node) => [
        "section",
        { "data-block-id": node.attrs["id"], "data-opaque": "true" },
        ["strong", "읽기 전용 확장 블록"],
        ["span", ` ${String(node.attrs["originalType"])}`],
      ],
    },
  },
  marks: {
    strong: { attrs: markAttrs, toDOM: () => ["strong", 0] },
    em: { attrs: markAttrs, toDOM: () => ["em", 0] },
    code: { attrs: markAttrs, toDOM: () => ["code", 0] },
    link: {
      attrs: { ...markAttrs, href: { default: "" } },
      inclusive: false,
      toDOM: (mark) => ["a", { href: mark.attrs["href"], rel: "noreferrer", target: "_blank" }, 0],
    },
  },
})
