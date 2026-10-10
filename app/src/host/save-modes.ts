import { z } from "zod"
import type { ContentRoute } from "./documents"

const modeSchema = z.enum(["manual", "debounce", "throttle", "blur"])
const modesSchema = z.object({ note: modeSchema, presentation: modeSchema, readonly: modeSchema })
export type SaveMode = z.infer<typeof modeSchema>
export type SaveModes = Readonly<Record<ContentRoute, SaveMode>>
export const saveModesKey = "slate-foundation-save-modes"
export const loadSaveModes = (storage: Storage): SaveModes => {
  const fallback: SaveModes = { note: "debounce", presentation: "manual", readonly: "manual" }
  const raw = storage.getItem(saveModesKey)
  if (raw === null) return fallback
  try {
    const result = modesSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : fallback
  } catch (error) {
    if (error instanceof SyntaxError) return fallback
    throw error
  }
}
