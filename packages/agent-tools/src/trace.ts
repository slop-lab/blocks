const sensitive = /^(api[-_]?key|authorization|credential|prompt|model[-_]?trace)$/iu

export const redactTraceValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactTraceValue)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitive.test(key) ? "[REDACTED]" : redactTraceValue(entry),
    ]),
  )
}
