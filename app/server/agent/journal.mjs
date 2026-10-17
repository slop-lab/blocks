import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { agentJournalSchema, agentRunRecordSchema } from "./contracts.mjs"

export class AgentJournal {
  #path
  #runs = new Map()
  #write = Promise.resolve()

  constructor(root) {
    this.#path = join(root, "agent", "runs.json")
  }

  async open() {
    await mkdir(dirname(this.#path), { recursive: true })
    try {
      const parsed = agentJournalSchema.parse(JSON.parse(await readFile(this.#path, "utf8")))
      for (const run of parsed.runs) this.#runs.set(run.id, run)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
  }

  list() {
    return [...this.#runs.values()].map((run) => structuredClone(run))
  }

  get(id) {
    const run = this.#runs.get(id)
    return run === undefined ? null : structuredClone(run)
  }

  async put(run) {
    const parsed = agentRunRecordSchema.parse(run)
    this.#runs.set(parsed.id, parsed)
    const payload = JSON.stringify({ schemaVersion: 1, runs: [...this.#runs.values()] })
    this.#write = this.#write.then(async () => {
      const temporary = `${this.#path}.${crypto.randomUUID()}.tmp`
      await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 })
      await rename(temporary, this.#path)
    })
    await this.#write
  }
}
