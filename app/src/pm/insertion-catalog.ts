import type { BlockRegistration } from "@block-editor/prosemirror"
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
      { name: "paragraph", label: "본문", description: "일반 텍스트", keywords: ["문단", "text"] },
      {
        name: "heading",
        label: "제목 1",
        description: "1단계 제목",
        keywords: ["제목", "h1"],
        attrs: { level: 1 },
      },
      {
        name: "heading",
        label: "제목 2",
        description: "2단계 제목",
        keywords: ["제목", "h2"],
        attrs: { level: 2 },
      },
      {
        name: "blockquote",
        label: "인용",
        description: "인용문",
        keywords: ["quote"],
        container: "body" as const,
      },
      {
        name: "bullet_list",
        label: "글머리 목록",
        description: "순서 없는 목록",
        keywords: ["bullet", "list"],
        wrap: "list_item",
      },
      {
        name: "ordered_list",
        label: "번호 목록",
        description: "순서 있는 목록",
        keywords: ["ordered", "list"],
        wrap: "list_item",
      },
      { name: "code_block", label: "코드 블록", description: "서식 없는 코드", keywords: ["code"] },
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
