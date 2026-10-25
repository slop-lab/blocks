import type { BlockRegistration } from "@slop-lab/blocks-prosemirror"
import type { NodeType } from "prosemirror-model"
import type { EditorView } from "prosemirror-view"
import { profileForState } from "./profile-plugin"

export type InsertionChoice = {
  readonly label: string
  readonly description: string
  readonly keywords: readonly string[]
  readonly type: NodeType
  readonly attrs: Readonly<Record<string, unknown>>
  readonly container: BlockRegistration["container"]
  readonly wrapType?: NodeType
}

export const insertionChoices = (view: EditorView): readonly InsertionChoice[] => {
  const profile = profileForState(view.state)
  if (profile === null) {
    const nodes = view.state.schema.nodes
    const definitions = [
      {
        name: "paragraph",
        label: "Text",
        description: "Plain text",
        keywords: ["paragraph", "text"],
      },
      {
        name: "heading",
        label: "Heading 1",
        description: "Level 1 heading",
        keywords: ["heading", "h1"],
        attrs: { level: 1 },
      },
      {
        name: "heading",
        label: "Heading 2",
        description: "Level 2 heading",
        keywords: ["heading", "h2"],
        attrs: { level: 2 },
      },
      {
        name: "blockquote",
        label: "Quote",
        description: "Block quote",
        keywords: ["quote"],
        container: "body" as const,
      },
      {
        name: "bullet_list",
        label: "Bulleted list",
        description: "Unordered list",
        keywords: ["bullet", "list"],
        wrap: "list_item",
      },
      {
        name: "ordered_list",
        label: "Numbered list",
        description: "Ordered list",
        keywords: ["ordered", "list"],
        wrap: "list_item",
      },
      {
        name: "code_block",
        label: "Code block",
        description: "Unformatted code",
        keywords: ["code"],
      },
    ]
    return definitions.flatMap((definition): readonly InsertionChoice[] => {
      const type = nodes[definition.name]
      const wrapType = definition.wrap === undefined ? undefined : nodes[definition.wrap]
      if (type === undefined || (definition.wrap !== undefined && wrapType === undefined)) return []
      return [
        {
          label: definition.label,
          description: definition.description,
          keywords: definition.keywords,
          type,
          attrs: definition.attrs ?? {},
          container: definition.container,
          ...(wrapType === undefined ? {} : { wrapType }),
        },
      ]
    })
  }
  return [...profile.registrations.values()].flatMap((registration) => {
    const type = view.state.schema.nodes[registration.nodeName]
    if (type === undefined) return []
    return (registration.insertMenu ?? []).map((item) => ({
      label: item.label,
      description: item.description,
      keywords: item.keywords,
      type,
      attrs: item.attrs ?? {},
      container: registration.container,
    }))
  })
}
