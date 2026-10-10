import {
  snapshotToPm as convertToProseMirror,
  pmToSnapshot as convertToSnapshot,
  type ProseMirrorProfile,
} from "@block-editor/prosemirror"
import { defaultProfile } from "@block-editor/prosemirror/preset"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import type { BlockDocument } from "../core/types"

export const snapshotToPm = (
  document: BlockDocument,
  profile: ProseMirrorProfile = defaultProfile,
): ProseMirrorNode => convertToProseMirror(document, profile)

export const pmToSnapshot = (
  document: ProseMirrorNode,
  profile: ProseMirrorProfile = defaultProfile,
): BlockDocument => convertToSnapshot(document, profile)
