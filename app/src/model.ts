export type { ChangeBatch, DeliveryPolicy } from "./core/change-delivery"
export { ChangeDelivery } from "./core/change-delivery"
export { DocumentCodecError, decodeDocument, encodeDocument, parseDocumentText } from "./core/codec"
export { copyBlocks } from "./core/copy"
export { exportHtml, exportMarkdown, readBlocks, readOutline } from "./core/headless"
export type { HttpSuggestionOptions } from "./core/http-suggestions"
export { createHttpSuggestionProvider } from "./core/http-suggestions"
export type { ProposedChange, SuggestionProvider, SuggestionRequest } from "./core/proposals"
export { acceptChanges, compareDocuments, SuggestionStream } from "./core/proposals"
export { createRegistry } from "./core/registry"
export type {
  ActionTarget,
  HostActionRequest,
  HostActionResult,
  InteractionRoute,
} from "./core/routing"
export { ActionRequests, dispatchInput, PersistenceBaseline, resolveRoute } from "./core/routing"
export type {
  BlockDocument,
  BlockSnapshot,
  Capability,
  ChangeEvent,
  InlineSnapshot,
  OverlayState,
  SessionUIState,
  ViewData,
} from "./core/types"
