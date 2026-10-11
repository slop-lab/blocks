import { useCallback, useEffect, useRef, useState } from "react"
import { mappingRange } from "./MarkdownBlockEditor"
import {
  listMarkdown,
  loadMarkdown,
  type MarkdownFile,
  type MarkdownMapping,
  type MarkdownTreeNode,
  previewMarkdown,
  saveMarkdown,
} from "./markdown-api"
import { lineEndingOf, preserveLineEndings } from "./source-edit"

export type MarkdownMode = "source" | "visual"
export type MarkdownSaveMode = "manual" | "auto"

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Markdown 작업 공간을 불러오지 못했습니다."

export const useMarkdownWorkspace = (initialFile: string | null = null) => {
  const [files, setFiles] = useState<readonly string[]>([])
  const [tree, setTree] = useState<readonly MarkdownTreeNode[]>([])
  const [disk, setDisk] = useState<MarkdownFile | null>(null)
  const [draft, setDraft] = useState("")
  const [mappings, setMappings] = useState<readonly MarkdownMapping[]>([])
  const [mappedContent, setMappedContent] = useState("")
  const [mode, setMode] = useState<MarkdownMode>("visual")
  const [saveMode, setSaveMode] = useState<MarkdownSaveMode>("manual")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<MarkdownFile | null>(null)
  const [status, setStatus] = useState("파일 목록을 불러오는 중입니다.")
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [composing, setComposing] = useState(false)
  const draftRef = useRef(draft)
  const diskRef = useRef(disk)
  diskRef.current = disk
  const composingRef = useRef(false)
  const fileGenerationRef = useRef(0)
  const mappingRequestRef = useRef(0)
  const dirty = disk !== null && draft !== disk.content
  const mappingFresh = disk !== null && mappedContent === draft
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (diskRef.current !== null && draftRef.current !== diskRef.current.content)
        event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  const changeDraft = useCallback((content: string) => {
    draftRef.current = content
    setDraft(content)
  }, [])

  const openFile = useCallback(
    async (name: string, reload = false) => {
      if (name === diskRef.current?.name && !reload) return
      if (composingRef.current) {
        setStatus("조합 중인 입력을 먼저 확정해 주세요.")
        return
      }
      const generation = ++fileGenerationRef.current
      mappingRequestRef.current += 1
      setSaving(false)
      setLoading(true)
      setStatus(`${name} 불러오는 중`)
      try {
        const loaded = await loadMarkdown(name)
        if (generation !== fileGenerationRef.current) return
        setDisk(loaded)
        changeDraft(loaded.content)
        setMappings(loaded.mappings)
        setMappedContent(loaded.content)
        setConflict(null)
        setSelectedId(null)
        setMode("visual")
        setStatus("디스크 버전과 초안이 같습니다.")
      } catch (error) {
        if (generation === fileGenerationRef.current) setStatus(errorMessage(error))
      } finally {
        if (generation === fileGenerationRef.current) setLoading(false)
      }
    },
    [changeDraft],
  )

  useEffect(() => {
    let active = true
    void listMarkdown()
      .then((inventory) => {
        if (!active) return
        setFiles(inventory.files)
        setTree(inventory.tree)
        const first =
          initialFile !== null && inventory.files.includes(initialFile)
            ? initialFile
            : inventory.files[0]
        if (first === undefined) setStatus("편집할 Markdown 파일이 없습니다.")
        else void openFile(first)
      })
      .catch((error: unknown) => {
        if (active) setStatus(errorMessage(error))
      })
    return () => {
      active = false
      fileGenerationRef.current += 1
      mappingRequestRef.current += 1
    }
  }, [initialFile, openFile])

  const persist = useCallback(async () => {
    if (disk === null || !dirty || saving || composingRef.current) return
    const generation = fileGenerationRef.current
    const submittedContent = draftRef.current
    setSaving(true)
    setStatus("디스크에 저장하는 중입니다.")
    try {
      const result = await saveMarkdown({ ...disk, content: submittedContent })
      if (generation !== fileGenerationRef.current) return
      if (result.kind === "conflict") {
        setConflict(result.disk)
        setStatus("디스크 파일이 바뀌어 초안을 저장하지 않았습니다.")
      } else {
        setDisk(result.file)
        setConflict(null)
        setStatus(
          draftRef.current === submittedContent
            ? "디스크에 저장했습니다."
            : "저장 중 추가된 변경은 초안에 남아 있습니다.",
        )
      }
    } catch (error) {
      if (generation === fileGenerationRef.current) setStatus(errorMessage(error))
    } finally {
      if (generation === fileGenerationRef.current) setSaving(false)
    }
  }, [dirty, disk, saving])

  useEffect(() => {
    if (saveMode !== "auto" || !dirty || conflict !== null || composing) return
    const timer = window.setTimeout(() => void persist(), 800)
    return () => window.clearTimeout(timer)
  }, [composing, conflict, dirty, persist, saveMode])

  useEffect(() => {
    if (disk === null || composing || mappedContent === draft) return
    const generation = fileGenerationRef.current
    const request = ++mappingRequestRef.current
    const name = disk.name
    const content = draft
    const timer = window.setTimeout(() => {
      void previewMarkdown(name, content)
        .then((nextMappings) => {
          if (
            generation === fileGenerationRef.current &&
            request === mappingRequestRef.current &&
            draftRef.current === content &&
            !composingRef.current
          ) {
            setMappings(nextMappings)
            setMappedContent(content)
          }
        })
        .catch((error: unknown) => {
          if (generation === fileGenerationRef.current && request === mappingRequestRef.current)
            setStatus(errorMessage(error))
        })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [composing, disk, draft, mappedContent])

  const changeBlock = (mapping: MarkdownMapping, value: string) => {
    const currentDraft = draftRef.current
    const range = mappingRange(currentDraft, mapping)
    const previous = currentDraft.slice(range.start, range.end)
    const edited = preserveLineEndings(previous, value, lineEndingOf(currentDraft))
    const replacement =
      previous.endsWith("\n") && !edited.endsWith("\n")
        ? edited + lineEndingOf(currentDraft)
        : edited
    const lineDelta = replacement.split("\n").length - previous.split("\n").length
    const nextDraft = `${currentDraft.slice(0, range.start)}${replacement}${currentDraft.slice(range.end)}`
    changeDraft(nextDraft)
    setMappedContent(nextDraft)
    setMappings((current) =>
      current.map((item) => {
        if (item.id === mapping.id)
          return { ...item, endLine: Math.max(item.startLine, item.endLine + lineDelta) }
        if (item.startLine > mapping.endLine)
          return {
            ...item,
            startLine: item.startLine + lineDelta,
            endLine: item.endLine + lineDelta,
          }
        return item
      }),
    )
  }

  const onCompositionChange = (active: boolean) => {
    composingRef.current = active
    setComposing(active)
  }

  const reloadConflict = (latest: MarkdownFile) => {
    void openFile(latest.name, true)
  }

  return {
    files,
    tree,
    disk,
    draft,
    mappings,
    mode,
    saveMode,
    selectedId,
    conflict,
    status,
    saving,
    loading,
    dirty,
    composing,
    mappingFresh,
    openFile,
    persist,
    changeDraft,
    editSource: (value: string) => changeDraft(preserveLineEndings(draftRef.current, value)),
    changeBlock,
    onCompositionChange,
    reloadConflict,
    setMode: (next: MarkdownMode) => {
      setMode(next)
      if (next === "source") setMappedContent("")
    },
    setSaveMode,
    setSelectedId,
  }
}
