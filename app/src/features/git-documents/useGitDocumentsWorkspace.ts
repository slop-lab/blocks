import { HTTPError } from "ky"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  type GitBranch,
  type GitDocumentDiff,
  type GitDocumentFile,
  type GitDocumentsState,
  type GitHistoryEntry,
  type GitSearchResult,
  gitDocumentsApi,
} from "./git-documents-api"

const message = (error: unknown) => {
  if (error instanceof HTTPError && error.response.status === 404)
    return "Git 문서 서버가 연결되지 않았습니다. block-docs start로 저장소를 여세요."
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다."
}

export const useGitDocumentsWorkspace = () => {
  const [state, setState] = useState<GitDocumentsState | null>(null)
  const [file, setFile] = useState<GitDocumentFile | null>(null)
  const [draft, setDraft] = useState("")
  const [status, setStatus] = useState("Git 문서 저장소를 여는 중입니다.")
  const [diff, setDiff] = useState<GitDocumentDiff | null>(null)
  const [history, setHistory] = useState<readonly GitHistoryEntry[]>([])
  const [branches, setBranches] = useState<readonly GitBranch[]>([])
  const [results, setResults] = useState<readonly GitSearchResult[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const draftRef = useRef(draft)
  const fileRef = useRef(file)
  const openRequest = useRef(0)
  const draftQueue = useRef<Promise<void>>(Promise.resolve())
  draftRef.current = draft
  fileRef.current = file

  const refresh = useCallback(async () => {
    const next = await gitDocumentsApi.state()
    setState(next)
    setSelected(
      (current) =>
        new Set([...current].filter((path) => next.changes.some((item) => item.path === path))),
    )
    return next
  }, [])

  const open = useCallback(async (path: string) => {
    const request = openRequest.current + 1
    openRequest.current = request
    setBusy(true)
    try {
      const next = await gitDocumentsApi.file(path)
      if (openRequest.current !== request) return
      setFile(next)
      setDraft(next.draft?.content ?? next.content)
      setStatus(
        next.draft === null ? "작업 트리 버전을 열었습니다." : "자동 저장된 초안을 복구했습니다.",
      )
      const [nextDiff, nextHistory] = await Promise.all([
        gitDocumentsApi.diff(path),
        gitDocumentsApi.history(path),
      ])
      if (openRequest.current !== request) return
      setDiff(nextDiff)
      setHistory(nextHistory)
    } catch (error) {
      setStatus(message(error))
    } finally {
      if (openRequest.current === request) setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
      .then(async (next) => {
        setBranches(await gitDocumentsApi.branches())
        const first = flatten(next.tree)[0]
        if (first !== undefined) await open(first)
        else setStatus("첫 Markdown 문서를 만들어 보세요.")
      })
      .catch((error: unknown) => setStatus(message(error)))
  }, [open, refresh])

  useEffect(() => {
    if (file === null || draft === file.content) return
    const timer = window.setTimeout(() => {
      const content = draftRef.current
      draftQueue.current = draftQueue.current
        .then(() => gitDocumentsApi.draft(file, content))
        .then(() => setStatus("복구 초안을 자동 저장했습니다."))
        .catch((error: unknown) => setStatus(`초안을 저장하지 못했습니다: ${message(error)}`))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [draft, file])

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true)
    try {
      await operation()
    } catch (error) {
      setStatus(message(error))
    } finally {
      setBusy(false)
    }
  }

  const reloadCurrent = async () => {
    await refresh()
    if (file !== null) await open(file.path)
  }

  return {
    state,
    file,
    draft,
    status,
    diff,
    history,
    branches,
    results,
    selected,
    busy,
    dirty: file !== null && draft !== file.content,
    setDraft,
    open,
    toggleSelected: (path: string) =>
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      }),
    save: () =>
      perform(async () => {
        if (file === null) return
        const source = draftRef.current
        const saved = await gitDocumentsApi.write(file, source)
        await gitDocumentsApi.clearDraft(saved.path)
        if (fileRef.current?.path !== saved.path || draftRef.current !== source) return
        setFile({ ...saved, draft: null })
        setDraft(saved.content)
        await reloadCurrent()
        setStatus("작업 트리에 저장했습니다. 커밋은 검토 탭에서 별도로 만드세요.")
      }),
    discardDraft: () =>
      perform(async () => {
        if (file === null) return
        await gitDocumentsApi.clearDraft(file.path)
        setDraft(file.content)
        setFile({ ...file, draft: null })
        setStatus("복구 초안을 버렸습니다.")
      }),
    create: (path: string) =>
      perform(async () => {
        const created = await gitDocumentsApi.create(path)
        await refresh()
        await open(created.path)
      }),
    rename: (to: string) =>
      perform(async () => {
        if (file === null) return
        const renamed = await gitDocumentsApi.rename(file, to)
        await refresh()
        await open(renamed.path)
      }),
    remove: () =>
      perform(async () => {
        if (file === null) return
        await gitDocumentsApi.remove(file)
        setFile(null)
        setDraft("")
        const next = await refresh()
        const first = flatten(next.tree)[0]
        if (first !== undefined) await open(first)
      }),
    commit: (commitMessage: string) =>
      perform(async () => {
        if (state === null) return
        const paths = [...selected]
        const expectedRevisions = Object.fromEntries(
          await Promise.all(
            paths.map(async (path) => {
              const change = state.changes.find((item) => item.path === path)
              if (change?.working === "deleted") return [path, null] as const
              return [path, (await gitDocumentsApi.file(path)).revision] as const
            }),
          ),
        )
        await gitDocumentsApi.commit(paths, commitMessage, expectedRevisions)
        setSelected(new Set())
        await reloadCurrent()
        setStatus("선택한 문서 변경을 커밋했습니다.")
      }),
    restore: (commit: string) =>
      perform(async () => {
        if (file === null) return
        await gitDocumentsApi.restore(file.path, commit)
        await reloadCurrent()
        setStatus("선택한 기록을 작업 트리에 복원했습니다. 검토 후 커밋하세요.")
      }),
    search: (query: string) => perform(async () => setResults(await gitDocumentsApi.search(query))),
    backlinks: () =>
      perform(async () => {
        if (file !== null) setResults(await gitDocumentsApi.backlinks(file.path))
      }),
    createBranch: (branch: string) =>
      perform(async () => {
        await draftQueue.current
        await gitDocumentsApi.createBranch(branch)
        window.location.reload()
      }),
    switchBranch: (branch: string) =>
      perform(async () => {
        await draftQueue.current
        await gitDocumentsApi.switchBranch(branch)
        window.location.reload()
      }),
    remote: (action: "fetch" | "fast-forward" | "push" | "merge" | "abort") =>
      perform(async () => {
        await gitDocumentsApi.remote(action)
        await reloadCurrent()
        setStatus(`원격 ${action} 작업을 완료했습니다.`)
      }),
    resolve: () =>
      perform(async () => {
        if (file === null) return
        await gitDocumentsApi.resolve(file, draftRef.current)
        await reloadCurrent()
        setStatus("충돌 해결 내용을 스테이징했습니다.")
      }),
    completeMerge: (commitMessage: string) =>
      perform(async () => {
        await gitDocumentsApi.completeMerge(commitMessage)
        await reloadCurrent()
        setStatus("병합 커밋을 만들었습니다.")
      }),
  }
}

export const flatten = (
  nodes: readonly import("./git-documents-api").GitDocumentTreeNode[],
): string[] =>
  nodes.flatMap((node) => (node.kind === "file" ? [node.path] : flatten(node.children)))
