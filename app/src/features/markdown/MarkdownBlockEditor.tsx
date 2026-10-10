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
  heading: "제목",
  paragraph: "문단",
  code: "코드",
  raw: "원문 보존",
}

export const MarkdownBlockEditor = ({
  content,
  mappings,
  selectedId,
  onSelect,
  onChange,
  onCompositionChange,
}: BlockEditorProps) => (
  <section className="markdown-blocks" aria-label="Markdown 블록 편집">
    <p className="muted">
      블록 사이의 줄 경계는 유지됩니다. 블록을 합치거나 구조를 바꾸려면 원문 모드를 사용하세요.
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
            aria-label={`${label[mapping.type]} ${mapping.startLine}행부터 ${mapping.endLine}행`}
            readOnly={!editable}
            value={value}
            rows={Math.max(2, mapping.endLine - mapping.startLine + 1)}
            onFocus={() => onSelect(mapping)}
            onChange={(event) => onChange(mapping, event.target.value)}
            onCompositionStart={() => onCompositionChange(true)}
            onCompositionEnd={() => onCompositionChange(false)}
          />
          {!editable && <small>알 수 없는 구문은 원문 모드에서만 수정할 수 있습니다.</small>}
        </article>
      )
    })}
  </section>
)
