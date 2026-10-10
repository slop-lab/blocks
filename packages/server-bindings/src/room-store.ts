import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { safeName } from "./file-utils.js"

type RoomStoreOptions = { readonly root: string }

export class FileRoomStore {
  constructor(private readonly options: RoomStoreOptions) {}

  private path(room: string): string {
    return join(this.options.root, `${safeName(room)}.yjs`)
  }

  async load(room: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(room)))
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
      throw error
    }
  }

  async save(room: string, update: Uint8Array): Promise<void> {
    await mkdir(this.options.root, { recursive: true })
    const path = this.path(room)
    const temporary = join(this.options.root, `.${crypto.randomUUID()}.tmp`)
    await writeFile(temporary, update, { mode: 0o600 })
    await rename(temporary, path)
  }
}

export type RoomPersistence = {
  readonly load: (room: string) => Promise<Uint8Array | null>
  readonly save: (room: string, update: Uint8Array) => Promise<void>
}
