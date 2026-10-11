// @vitest-environment jsdom

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MarkdownWorkspace } from "../src/features/markdown/MarkdownWorkspace"
import type { MarkdownFile } from "../src/features/markdown/markdown-api"

const api = vi.hoisted(() => ({
  list: vi.fn(),
  load: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
}))

vi.mock("../src/features/markdown/markdown-api", () => ({
  listMarkdown: api.list,
  loadMarkdown: api.load,
  previewMarkdown: api.preview,
  saveMarkdown: api.save,
}))

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
})

const initialFile: MarkdownFile = {
  name: "notes.md",
  content: "# Heading\n\nParagraph\n",
  revision: "revision-1",
  mappings: [
    { id: "heading-1", type: "heading", startLine: 1, endLine: 1 },
    { id: "paragraph-1", type: "paragraph", startLine: 3, endLine: 3 },
  ],
}

let host: HTMLDivElement
let root: Root

const changeTextarea = async (textarea: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    setter?.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

const button = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  )

const sourceEditor = async () => {
  await act(async () => button("Markdown 원문")?.click())
  const source = host.querySelector<HTMLTextAreaElement>(".markdown-source textarea")
  if (source === null) throw new TypeError("Markdown source did not mount")
  return source
}

beforeEach(async () => {
  api.list.mockReset().mockResolvedValue({
    files: ["notes.md", "slow.md", "fast.md"],
    tree: ["notes.md", "slow.md", "fast.md"].map((name) => ({ kind: "file", name, path: name })),
  })
  api.load.mockReset().mockResolvedValue(initialFile)
  api.preview.mockReset().mockImplementation(async (_name: string, content: string) => {
    const headingLine = content.startsWith("Preface") ? 3 : 1
    return [
      { id: "heading-preview", type: "heading", startLine: headingLine, endLine: headingLine },
      {
        id: "paragraph-preview",
        type: "paragraph",
        startLine: headingLine + 2,
        endLine: headingLine + 2,
      },
    ]
  })
  api.save.mockReset().mockImplementation(async (file) => ({
    kind: "saved",
    file: { ...file, revision: "revision-next" },
  }))
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<MarkdownWorkspace />)
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await act(async () => root.unmount())
  host.remove()
})

describe("Markdown workspace draft integrity", () => {
  it("refreshes the mounted visual editor when the same file reloads", async () => {
    api.load.mockResolvedValueOnce({ ...initialFile, content: "# Reloaded\n" })
    await act(async () => button("다시 읽기")?.click())
    await act(async () => await Promise.resolve())
    expect(host.querySelector("[aria-label='Markdown 문서 편집기']")?.textContent).toContain(
      "Reloaded",
    )
  })

  it("keeps an unsaved draft when the active file is selected again", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    const source = await sourceEditor()
    await changeTextarea(source, "# Unsaved\n")
    const active = [...host.querySelectorAll<HTMLButtonElement>(".markdown-files button")].find(
      (item) => item.querySelector("strong")?.textContent === "notes.md",
    )
    await act(async () => active?.click())
    expect(source.value).toBe("# Unsaved\n")
    expect(api.load).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
  })
  it("ignores the discarded StrictMode bootstrap after the active view has edits", async () => {
    await act(async () => root.unmount())
    const inventory = {
      files: ["notes.md"],
      tree: [{ kind: "file" as const, name: "notes.md", path: "notes.md" }],
    }
    let finishOld: (value: typeof inventory) => void = () => {
      throw new Error("Bootstrap not started")
    }
    api.list
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise<typeof inventory>((resolve) => {
            finishOld = resolve
          }),
      )
      .mockResolvedValue(inventory)
    api.load.mockClear()
    root = createRoot(host)
    await act(async () => {
      root.render(
        <StrictMode>
          <MarkdownWorkspace />
        </StrictMode>,
      )
    })
    const source = await sourceEditor()
    await changeTextarea(source, "# New draft\n")
    await act(async () => {
      finishOld(inventory)
      await Promise.resolve()
    })
    expect(source.value).toBe("# New draft\n")
    expect(api.load).toHaveBeenCalledTimes(1)
  })
  it("preserves typing added while an earlier save is pending", async () => {
    let acknowledge: ((result: unknown) => void) | undefined
    api.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve
        }),
    )
    const textarea = await sourceEditor()
    const submitted = `${initialFile.content}Save A\n`
    const newerDraft = `${submitted}Typing B\n`
    await changeTextarea(textarea, submitted)
    await act(async () => button("저장")?.click())
    await changeTextarea(textarea, newerDraft)
    await act(async () => {
      acknowledge?.({
        kind: "saved",
        file: { ...initialFile, content: submitted, revision: "revision-2" },
      })
      await Promise.resolve()
    })

    expect(textarea.value).toBe(newerDraft)
    expect(host.textContent).toContain("저장 중 추가된 변경은 초안에 남아 있습니다.")
  })

  it("saves from Mod-S while the source editor is active", async () => {
    const textarea = await sourceEditor()
    await changeTextarea(textarea, "# Shortcut draft\n")

    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }),
      ),
    )
    await act(async () => await Promise.resolve())

    expect(api.save).toHaveBeenCalledTimes(1)
    expect(api.save.mock.calls[0]?.[0].content).toBe("# Shortcut draft\n")
  })

  it("opens in visual mode and carries source edits back into the document", async () => {
    expect(host.querySelector("[aria-label='Markdown 문서 편집기']")?.textContent).toContain(
      "Heading",
    )
    const source = await sourceEditor()
    const prepended = `Preface\n\n${initialFile.content}`
    await changeTextarea(source, prepended)
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 220)))
    await act(async () => button("문서")?.click())
    expect(host.querySelector("[aria-label='Markdown 문서 편집기']")?.textContent).toContain(
      "Preface",
    )
    expect(button("문서")?.getAttribute("aria-selected")).toBe("true")
  })

  it("ignores an older file response that settles after the latest selection", async () => {
    let resolveSlow: ((file: MarkdownFile) => void) | undefined
    let resolveFast: ((file: MarkdownFile) => void) | undefined
    api.load.mockImplementation((name: string) => {
      if (name === "slow.md")
        return new Promise((resolve) => {
          resolveSlow = resolve
        })
      if (name === "fast.md")
        return new Promise((resolve) => {
          resolveFast = resolve
        })
      return Promise.resolve(initialFile)
    })
    const fileButton = (name: string) =>
      Array.from(host.querySelectorAll<HTMLButtonElement>(".markdown-files button")).find(
        (candidate) => candidate.querySelector("strong")?.textContent === name,
      )
    await act(async () => {
      fileButton("slow.md")?.click()
      fileButton("fast.md")?.click()
    })
    await act(async () => {
      resolveFast?.({ ...initialFile, name: "fast.md", content: "# Fast\n" })
      await Promise.resolve()
    })
    await act(async () => {
      resolveSlow?.({ ...initialFile, name: "slow.md", content: "# Slow\n" })
      await Promise.resolve()
    })

    expect(host.querySelector(".markdown-header h1")?.textContent).toBe("fast.md")
    const source = await sourceEditor()
    expect(source.value).toBe("# Fast\n")
  })
})
