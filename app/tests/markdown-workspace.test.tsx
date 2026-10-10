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
  it("keeps an unsaved draft when the active file is selected again", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    const source = host.querySelector<HTMLTextAreaElement>(".markdown-source textarea")
    if (source === null) throw new TypeError("Source missing")
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
    const source = host.querySelector<HTMLTextAreaElement>(".markdown-source textarea")
    if (source === null) throw new TypeError("Active source did not mount")
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
    const textarea = host.querySelector<HTMLTextAreaElement>(".markdown-source textarea")
    if (textarea === null) throw new TypeError("Markdown source did not mount")
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

  it("refreshes line mappings before block editing a prepended source", async () => {
    const source = host.querySelector<HTMLTextAreaElement>(".markdown-source textarea")
    if (source === null) throw new TypeError("Markdown source did not mount")
    const prepended = `Preface\n\n${initialFile.content}`
    await changeTextarea(source, prepended)
    expect(button("블록")?.disabled).toBe(true)
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 220)))
    expect(button("블록")?.disabled).toBe(false)
    await act(async () => button("블록")?.click())
    const heading = host.querySelector<HTMLTextAreaElement>("[aria-label='제목 3행부터 3행']")
    if (heading === null) throw new TypeError("Fresh heading mapping did not render")
    await changeTextarea(heading, "# Changed")
    await act(async () => button("원문")?.click())
    const updated = host.querySelector<HTMLTextAreaElement>(".markdown-source textarea")

    expect(updated?.value).toBe("Preface\n\n# Changed\n\nParagraph\n")
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
    expect(host.querySelector<HTMLTextAreaElement>(".markdown-source textarea")?.value).toBe(
      "# Fast\n",
    )
  })
})
