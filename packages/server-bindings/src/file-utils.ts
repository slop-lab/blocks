import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"

export class StoredValueError extends Error {
  readonly name = "StoredValueError"
  constructor(readonly path: string, options?: ErrorOptions) {
    super(`Invalid stored value at ${path}`, options)
  }
}

export const safeName = (value: string): string => {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new TypeError("Identifier contains unsupported characters")
  return value
}

export const readStored = async <T>(path: string, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    if (error instanceof SyntaxError || error instanceof z.ZodError)
      throw new StoredValueError(path, { cause: error })
    throw error
  }
}

export const writeStored = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${crypto.randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 })
  await rename(temporary, path)
}
