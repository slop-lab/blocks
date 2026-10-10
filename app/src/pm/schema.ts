import { defaultProfile } from "@block-editor/prosemirror/preset"
import type { Schema } from "prosemirror-model"

export const editorProfile = defaultProfile
export const editorSchema: Schema<
  | "doc"
  | "text"
  | "paragraph"
  | "heading"
  | "blockquote"
  | "code_block"
  | "caption"
  | "task_card"
  | "opaque",
  "strong" | "em" | "code" | "link"
> = defaultProfile.schema
