import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"

export class StoredValueError extends Error {
  readonly name = "StoredValueError"
  constructor(
    readonly path: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid stored value at ${path}`, options)
  }
}

export const safeName = (value: string): string => {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value))
    throw new TypeError("Identifier contains unsupported characters")
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
  try {
    await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

const fileQueues = new Map<string, Promise<void>>()

export const withFileQueue = async <T>(path: string, operation: () => Promise<T>): Promise<T> => {
  const key = resolve(path)
  const previous = fileQueues.get(key) ?? Promise.resolve()
  let release = (): void => undefined
  const current = new Promise<void>((resolveQueue) => {
    release = resolveQueue
  })
  const queued = previous.then(() => current)
  fileQueues.set(key, queued)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (fileQueues.get(key) === queued) fileQueues.delete(key)
  }
}
