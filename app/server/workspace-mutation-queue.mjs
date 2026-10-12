import { resolve } from "node:path"

const queues = new Map()

export const withWorkspaceMutation = async (root, mutation) => {
  const key = resolve(root)
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.then(mutation, mutation)
  const settled = current.then(
    () => undefined,
    () => undefined,
  )
  queues.set(key, settled)
  try {
    return await current
  } finally {
    if (queues.get(key) === settled) queues.delete(key)
  }
}
