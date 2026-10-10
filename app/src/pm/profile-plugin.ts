import type { ProseMirrorProfile } from "@block-editor/prosemirror"
import type { EditorState } from "prosemirror-state"
import { Plugin, PluginKey } from "prosemirror-state"

const profileKey = new PluginKey<ProseMirrorProfile>("block-editor-profile")

export const createProfilePlugin = (profile: ProseMirrorProfile): Plugin<ProseMirrorProfile> =>
  new Plugin({
    key: profileKey,
    state: { init: () => profile, apply: (_transaction, value) => value },
  })

export const profileForState = (state: EditorState): ProseMirrorProfile | null =>
  profileKey.getState(state) ?? null

export const defaultNodeForState = (state: EditorState) => {
  const profile = profileForState(state)
  const registration = profile?.registrations.get(profile.defaultTextType)
  return registration === undefined
    ? state.schema.nodes["paragraph"]
    : state.schema.nodes[registration.nodeName]
}
