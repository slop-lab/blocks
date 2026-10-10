export const lineEndingOf = (source: string) => source.match(/\r\n|\n/)?.[0] ?? "\n"

export const preserveLineEndings = (
  previous: string,
  input: string,
  ending = lineEndingOf(previous),
) => {
  const before = previous.replace(/\r\n/g, "\n")
  const next = input.replace(/\r\n/g, "\n")
  if (before === next) return previous
  let prefix = 0
  while (prefix < before.length && prefix < next.length && before[prefix] === next[prefix])
    prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < next.length - prefix &&
    before[before.length - suffix - 1] === next[next.length - suffix - 1]
  )
    suffix += 1
  const rawOffset = (offset: number) => {
    let raw = 0
    for (let normalized = 0; normalized < offset; normalized += 1)
      raw += previous[raw] === "\r" && previous[raw + 1] === "\n" ? 2 : 1
    return raw
  }
  return (
    previous.slice(0, rawOffset(prefix)) +
    next.slice(prefix, next.length - suffix).replace(/\n/g, ending) +
    previous.slice(rawOffset(before.length - suffix))
  )
}
