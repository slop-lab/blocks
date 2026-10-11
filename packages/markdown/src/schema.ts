import { type MarkSpec, type NodeSpec, Schema } from "prosemirror-model"

export const sourceAttrs = {
  id: { default: "" },
  originalRaw: { default: "" },
  originalFingerprint: { default: "" },
  prefixRaw: { default: "" },
  locked: { default: false },
} as const

const safeHref = (href: unknown): string => {
  if (typeof href !== "string") return ""
  if (href.startsWith("//")) return ""
  if (
    href.startsWith("#") ||
    href.startsWith("/") ||
    href.startsWith("./") ||
    href.startsWith("../")
  )
    return href
  try {
    const protocol = new URL(href).protocol
    return ["http:", "https:", "mailto:"].includes(protocol) ? href : ""
  } catch {
    return ""
  }
}

const nodes: Readonly<Record<string, NodeSpec>> = {
  doc: { content: "block+", attrs: { suffixRaw: { default: "" }, lineEnding: { default: "\n" } } },
  paragraph: {
    content: "inline*",
    group: "block",
    attrs: sourceAttrs,
    toDOM: (node) => ["p", { "data-block-id": node.attrs["id"] }, 0],
  },
  blockquote: {
    content: "block+",
    group: "block",
    attrs: sourceAttrs,
    toDOM: (node) => ["blockquote", { "data-block-id": node.attrs["id"] }, 0],
  },
  horizontal_rule: {
    group: "block",
    attrs: { ...sourceAttrs, markup: { default: "---" } },
    toDOM: (node) => ["hr", { "data-block-id": node.attrs["id"] }],
  },
  heading: {
    content: "inline*",
    group: "block",
    defining: true,
    attrs: { ...sourceAttrs, level: { default: 1 } },
    toDOM: (node) => [`h${String(node.attrs["level"])}`, { "data-block-id": node.attrs["id"] }, 0],
  },
  code_block: {
    content: "text*",
    group: "block",
    code: true,
    defining: true,
    marks: "",
    attrs: { ...sourceAttrs, params: { default: "" } },
    toDOM: (node) => [
      "pre",
      { "data-block-id": node.attrs["id"] },
      ["code", { "data-language": node.attrs["params"] }, 0],
    ],
  },
  ordered_list: {
    content: "list_item+",
    group: "block",
    attrs: { ...sourceAttrs, order: { default: 1 }, tight: { default: false } },
    toDOM: (node) => [
      "ol",
      {
        "data-block-id": node.attrs["id"],
        start: node.attrs["order"] === 1 ? null : node.attrs["order"],
      },
      0,
    ],
  },
  bullet_list: {
    content: "list_item+",
    group: "block",
    attrs: { ...sourceAttrs, tight: { default: false }, bullet: { default: "-" } },
    toDOM: (node) => ["ul", { "data-block-id": node.attrs["id"] }, 0],
  },
  list_item: { content: "block+", defining: true, toDOM: () => ["li", 0] },
  text: { group: "inline" },
  image: {
    inline: true,
    attrs: { src: {}, alt: { default: null }, title: { default: null } },
    group: "inline",
    draggable: true,
    toDOM: (node) => ["img", { src: safeHref(node.attrs["src"]), alt: node.attrs["alt"] ?? "" }],
  },
  hard_break: { inline: true, group: "inline", selectable: false, toDOM: () => ["br"] },
  opaque: {
    group: "block",
    atom: true,
    selectable: true,
    attrs: { ...sourceAttrs, raw: { default: "" }, label: { default: "지원하지 않는 Markdown" } },
    toDOM: (node) => [
      "section",
      { "data-block-id": node.attrs["id"], "data-opaque": "true", contenteditable: "false" },
      ["strong", String(node.attrs["label"])],
      ["small", "원문 보기에서 안전하게 편집할 수 있습니다."],
    ],
  },
}

const marks: Readonly<Record<string, MarkSpec>> = {
  em: { toDOM: () => ["em", 0] },
  strong: { toDOM: () => ["strong", 0] },
  link: {
    attrs: { href: {}, title: { default: null } },
    inclusive: false,
    toDOM: (mark) => ["a", { href: safeHref(mark.attrs["href"]), rel: "noreferrer" }, 0],
  },
  code: { code: true, toDOM: () => ["code", 0] },
}

export const markdownSchema = new Schema({ nodes, marks })
