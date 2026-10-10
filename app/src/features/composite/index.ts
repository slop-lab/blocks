export type { Attachment, AttachmentFactory } from "./attachments"
export { createAttachmentFactory } from "./attachments"
export type { CompositeWorkspaceProps } from "./CompositeWorkspace"
export { CompositeWorkspace } from "./CompositeWorkspace"
export { codeAttachmentFactory } from "./NestedCodeEditor"
export { proseMirrorAttachmentFactory } from "./ProseMirrorSurface"
export type { PersistedCompositeWorkspace } from "./persistence"
export {
  COMPOSITE_STORAGE_KEY,
  initializeCompositeWorkspace,
  loadCompositeWorkspace,
  saveCompositeDraft,
  saveCompositeWorkspace,
} from "./persistence"
export type {
  CompositeCommand,
  CompositeMigration,
  CompositeSnapshot,
  CompositeSnapshotV1,
} from "./profile"
export {
  compositeSchema,
  createCompositeEditorState,
  createCompositeSnapshot,
  migrateCompositeSnapshot,
  tableCommands,
} from "./profile"
