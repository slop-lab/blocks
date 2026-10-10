import {
  decodeDocument,
  DocumentCodecError,
  encodeDocument,
  type BlockDocument,
} from "@block-editor/model"

export { decodeDocument, DocumentCodecError, encodeDocument }

export const parseDocumentText = (text: string): BlockDocument => {
  if (new Blob([text]).size > 2_000_000) throw new DocumentCodecError("Document exceeds 2 MB")
  try {
    return decodeDocument(JSON.parse(text))
  } catch (error) {
    if (error instanceof DocumentCodecError || error instanceof SyntaxError)
      throw new DocumentCodecError(error.message)
    throw error
  }
}
