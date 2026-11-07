import type { MarkdownMapping } from "./markdown-api"

type BlockEditorProps = {
  readonly content: string
  readonly mappings: readonly MarkdownMapping[]
  readonly selectedId: string | null
  readonly onSelect: (mapping: MarkdownMapping) => void
  readonly onChange: (mapping: MarkdownMapping, value: string) => void
  readonly onCompositionChange: (active: boolean) => void
}

const lineOffsets = (content: string) => {
  const offsets = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") offsets.push(index + 1)
  }
  return offsets
}

export const mappingRange = (content: string, mapping: MarkdownMapping) => {
  const offsets = lineOffsets(content)
  const start = offsets[mapping.startLine - 1] ?? content.length
  const end = offsets[mapping.endLine] ?? content.length
  return { start, end }
}

const label: Readonly<Record<MarkdownMapping["type"], string>> = {
  heading: "Heading",
  paragraph: "Paragraph",
  code: "Code",
  raw: "Preserved source",
}

export const MarkdownBlockEditor = ({
  content,
  mappings,
  selectedId,
  onSelect,
  onChange,
  onCompositionChange,
}: BlockEditorProps) => (
  <section className="markdown-blocks" aria-label="Markdown block editor">
    <p className="muted">
      Line boundaries between blocks are preserved. Use source mode to merge blocks or change their
      structure.
    </p>
    {mappings.map((mapping) => {
      const range = mappingRange(content, mapping)
      const value = content.slice(range.start, range.end)
      const editable = mapping.type !== "raw"
      return (
        <article
          className={
            selectedId === mapping.id ? "markdown-block markdown-block--selected" : "markdown-block"
          }
          key={mapping.id}
        >
          <button className="markdown-block__meta" type="button" onClick={() => onSelect(mapping)}>
            <span>{label[mapping.type]}</span>
            <code>
              {mapping.startLine}-{mapping.endLine}
            </code>
          </button>
          <textarea
            aria-label={`${label[mapping.type]}, lines ${mapping.startLine} through ${mapping.endLine}`}
            readOnly={!editable}
            value={value}
            rows={Math.max(2, mapping.endLine - mapping.startLine + 1)}
            onFocus={() => onSelect(mapping)}
            onChange={(event) => onChange(mapping, event.target.value)}
            onCompositionStart={() => onCompositionChange(true)}
            onCompositionEnd={() => onCompositionChange(false)}
          />
          {!editable && <small>Unknown syntax can only be edited in source mode.</small>}
        </article>
      )
    })}
  </section>
)
