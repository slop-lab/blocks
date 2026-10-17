import {
  snapshotToPm as convertToProseMirror,
  pmToSnapshot as convertToSnapshot,
  type ProseMirrorProfile,
} from "@slop-lab/blocks-prosemirror"
import { defaultProfile } from "@slop-lab/blocks-prosemirror/preset"
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
