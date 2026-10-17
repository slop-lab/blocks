import { createHash } from "node:crypto"

export class AgentRequestConflictError extends Error {}
export class AgentCommandConflictError extends Error {}

const canonicalJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalJson(value[key])]),
  )
}

export const hashJson = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalJson(value)), "utf8")
    .digest("hex")

export const requestKey = (owner, input) =>
  `${owner.authority}\u0000${owner.subject}\u0000${input.sessionId}\u0000${input.requestId}`

export const runEvent = (run, type, detail) => ({
  id: (run.events.at(-1)?.id ?? 0) + 1,
  type,
  detail: detail.slice(0, 2_000),
  at: new Date().toISOString(),
})

export const createSerialGate = () => {
  const tails = new Map()
  return async (key, operation) => {
    const previous = tails.get(key) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    tails.set(key, current)
    try {
      return await current
    } finally {
      if (tails.get(key) === current) tails.delete(key)
    }
  }
}

export const receiptFor = (run, commandId, action, inputHash) => {
  const receipt = run.commandReceipts.find((item) => item.commandId === commandId)
  if (receipt === undefined) return null
  if (receipt.action !== action || receipt.inputHash !== inputHash)
    throw new AgentCommandConflictError(`Command ${commandId} was reused with different input`)
  return structuredClone(receipt.result)
}
