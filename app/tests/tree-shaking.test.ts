import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { build } from "esbuild"
import { afterEach, expect, it } from "vitest"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const bundle = async (source: string) => {
  const root = await mkdtemp(join(tmpdir(), "block-editor-shaking-"))
  roots.push(root)
  const entry = join(root, "consumer.tsx")
  await writeFile(entry, source, "utf8")
  return build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    metafile: true,
    write: false,
    jsx: "automatic",
    nodePaths: [join(process.cwd(), "node_modules")],
  })
}

it("keeps built-in block leaves out of a custom text consumer", async () => {
  const result = await bundle(`
    import { createProseMirrorProfile, blockAttrs } from "@block-editor/prosemirror";
    const notesText = { type: "notes.text", nodeName: "notes_text", text: true, nodeSpec: { group: "block", content: "inline*", attrs: blockAttrs } };
    console.log(createProseMirrorProfile([notesText], "notes.text").defaultTextType);
  `)
  const inputs = Object.keys(result.metafile.inputs)

  expect(inputs.some((path) => path.endsWith("/paragraph.js"))).toBe(false)
  expect(inputs.some((path) => path.endsWith("/task-card.js"))).toBe(false)
  expect(inputs.some((path) => path.endsWith("/heading.js"))).toBe(false)
  expect(inputs.some((path) => path.endsWith("/quote.js"))).toBe(false)
  expect(inputs.some((path) => path.endsWith("/code.js"))).toBe(false)
  expect(inputs.some((path) => path.endsWith("/caption.js"))).toBe(false)
})

it("keeps ProseMirror and unused leaves out of a paragraph renderer consumer", async () => {
  const result = await bundle(`
    import { paragraphRenderer } from "@block-editor/prosemirror/paragraph-renderer";
    console.log(paragraphRenderer({ id: "p", type: "paragraph", attrs: {}, content: [] }, undefined));
  `)
  const inputs = Object.keys(result.metafile.inputs)
  expect(inputs.some((path) => path.includes("prosemirror-model"))).toBe(false)
  expect(inputs.some((path) => /\/(heading|task-card|quote|code|caption)\.js$/.test(path))).toBe(
    false,
  )
})

it("keeps ProseMirror out of a view-only consumer", async () => {
  const result = await bundle(`
    import React from "react";
    import { BlockViewer } from "@block-editor/model/viewer";
    console.log(React.createElement(BlockViewer, { content: [], renderers: new Map() }));
  `)
  const inputs = Object.keys(result.metafile.inputs)

  expect(inputs.some((path) => path.includes("prosemirror-"))).toBe(false)
  expect(inputs.some((path) => path.includes("@block-editor/prosemirror"))).toBe(false)
})

it("emits runnable ESM for the custom text consumer", async () => {
  const result = await bundle(`
    import { createProseMirrorProfile, blockAttrs } from "@block-editor/prosemirror";
    const custom = { type: "notes.text", nodeName: "notes_text", text: true, nodeSpec: { group: "block", content: "inline*", attrs: blockAttrs } };
    globalThis.__profile = createProseMirrorProfile([custom], "notes.text").defaultTextType;
  `)
  const output = result.outputFiles[0]
  if (output === undefined) throw new TypeError("Missing bundled output")
  const root = await mkdtemp(join(tmpdir(), "block-editor-driver-"))
  roots.push(root)
  const driver = join(root, "driver.mjs")
  await writeFile(driver, output.text, "utf8")

  expect((await readFile(driver, "utf8")).length).toBeGreaterThan(0)
  await import(`${driver}?run=${crypto.randomUUID()}`)
  expect(Reflect.get(globalThis, "__profile")).toBe("notes.text")
})

it("keeps the standalone interaction and container consumer engine-free", async () => {
  const result = await bundle(`
    import { canonicalSelection } from "@block-editor/containers";
    import { BlockSelection } from "@block-editor/interactions";
    const tree = [{ id: "parent", children: [{ id: "child", children: [] }] }];
    const selection = new BlockSelection();
    selection.apply({ kind: "replace", id: "parent" }, ["parent", "child"]);
    globalThis.__standalone = [canonicalSelection(tree, ["parent", "child"]), selection.value];
  `)
  const inputs = Object.keys(result.metafile.inputs)
  expect(inputs.some((path) => path.includes("prosemirror-"))).toBe(false)
  expect(inputs.some((path) => path.includes("react"))).toBe(false)
  const output = result.outputFiles[0]
  if (output === undefined) throw new TypeError("Missing standalone output")
  const root = await mkdtemp(join(tmpdir(), "block-editor-interactions-driver-"))
  roots.push(root)
  const driver = join(root, "driver.mjs")
  await writeFile(driver, output.text, "utf8")
  await import(`${driver}?run=${crypto.randomUUID()}`)
  expect(Reflect.get(globalThis, "__standalone")).toEqual([["parent"], ["parent"]])
})

it("exposes ProseMirror interactions only through the opt-in adapter", async () => {
  const result = await bundle(`
    import { blockSelectionReconcilePlugin } from "@block-editor/interactions/prosemirror";
    globalThis.__adapter = blockSelectionReconcilePlugin.spec;
  `)
  const inputs = Object.keys(result.metafile.inputs)

  expect(inputs.some((path) => path.includes("prosemirror-state"))).toBe(true)
  expect(inputs.some((path) => path.endsWith("/interactions/dist/index.js"))).toBe(true)
})
