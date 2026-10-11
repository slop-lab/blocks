const queues = new Map<string, Promise<void>>()

export const mutateWorktree = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
  const previous = queues.get(key) ?? Promise.resolve()
  let release = (): void => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  queues.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (queues.get(key) === current) queues.delete(key)
  }
}
