import {
  databaseSchema,
  isOpaqueWorkspaceBlock,
  pageDocumentSchema,
  syncedSourceSchema,
  workspaceSchema,
} from "@slop-lab/blocks-workspace"

const MAX_BLOCKS = 10_000
const MAX_DEPTH = 64

const identity = (kind, content) => (kind === "pages" ? content.pageId : content.id)

const validValue = (property, value, pageIds) => {
  if (value === null) return true
  switch (property.type) {
    case "text":
      return typeof value === "string"
    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value))
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "checkbox":
      return typeof value === "boolean"
    case "select":
    case "status":
      return typeof value === "string" && property.options.includes(value)
    case "relation":
      return typeof value === "string" && pageIds.has(value)
    default:
      throw new TypeError(`Unsupported database property type: ${property.type}`)
  }
}

const walkBlocks = (blocks, visit) => {
  const stack = blocks.map((block) => ({ block, depth: 1 }))
  let count = 0
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    count += 1
    if (count > MAX_BLOCKS || current.depth > MAX_DEPTH)
      throw new TypeError("Workspace block budget exceeded")
    visit(current.block)
    if (isOpaqueWorkspaceBlock(current.block)) continue
    if (["section", "callout", "quote"].includes(current.block.type))
      for (const child of current.block.children)
        stack.push({ block: child, depth: current.depth + 1 })
  }
}

const validateTree = (tree, documentIds) => {
  const pages = new Map(tree.pages.map((page) => [page.id, page]))
  if (pages.size !== tree.pages.length) throw new TypeError("Duplicate workspace page")
  for (const page of tree.pages) {
    if (!documentIds.has(page.id)) throw new TypeError(`Missing page document ${page.id}`)
    const visited = new Set([page.id])
    let parentId = page.parentId
    while (parentId !== null) {
      if (!pages.has(parentId)) throw new TypeError(`Unknown parent page ${parentId}`)
      if (visited.has(parentId)) throw new TypeError("Page hierarchy contains a cycle")
      visited.add(parentId)
      parentId = pages.get(parentId).parentId
    }
  }
}

const validatePage = (page, ids) => {
  const blockIds = new Set()
  if (!ids.pages.has(page.pageId)) throw new TypeError(`Unknown page ${page.pageId}`)
  walkBlocks(page.blocks, (block) => {
    if (blockIds.has(block.id)) throw new TypeError(`Duplicate workspace block ${block.id}`)
    blockIds.add(block.id)
    if (isOpaqueWorkspaceBlock(block)) return
    if (block.type === "page_ref" && !ids.pages.has(block.pageId))
      throw new TypeError(`Unknown page reference ${block.pageId}`)
    if (block.type === "database_embed" && !ids.databases.has(block.databaseId))
      throw new TypeError(`Unknown database reference ${block.databaseId}`)
    if (block.type === "section" && block.ref !== undefined && !ids.sources.has(block.ref.sourceId))
      throw new TypeError(`Unknown synced source ${block.ref.sourceId}`)
  })
}

const validateDatabase = (database, pageIds) => {
  const properties = new Map(database.properties.map((property) => [property.id, property]))
  if (properties.size !== database.properties.length)
    throw new TypeError("Duplicate database property")
  const rowIds = new Set()
  for (const row of database.rows) {
    if (rowIds.has(row.id)) throw new TypeError(`Duplicate database row ${row.id}`)
    rowIds.add(row.id)
    if (row.pageId !== undefined && !pageIds.has(row.pageId))
      throw new TypeError(`Unknown database row page ${row.pageId}`)
    for (const [propertyId, value] of Object.entries(row.values)) {
      const property = properties.get(propertyId)
      if (property === undefined || !validValue(property, value, pageIds))
        throw new TypeError(`Invalid property value for ${propertyId}`)
    }
  }
}

const validateSources = (sources, ids) => {
  const edges = new Map()
  for (const source of sources) {
    const blockIds = new Set()
    const targets = new Set()
    walkBlocks([source.section], (block) => {
      if (blockIds.has(block.id)) throw new TypeError(`Duplicate workspace block ${block.id}`)
      blockIds.add(block.id)
      if (isOpaqueWorkspaceBlock(block)) return
      if (block.type === "page_ref" && !ids.pages.has(block.pageId))
        throw new TypeError(`Unknown page reference ${block.pageId}`)
      if (block.type === "database_embed" && !ids.databases.has(block.databaseId))
        throw new TypeError(`Unknown database reference ${block.databaseId}`)
      if (block.type === "section" && block.ref !== undefined) {
        if (!ids.sources.has(block.ref.sourceId))
          throw new TypeError(`Unknown synced source ${block.ref.sourceId}`)
        targets.add(block.ref.sourceId)
      }
    })
    edges.set(source.id, targets)
  }
  const visiting = new Set()
  const visited = new Set()
  const visit = (sourceId) => {
    if (visiting.has(sourceId)) throw new TypeError("Synced source graph contains a cycle")
    if (visited.has(sourceId)) return
    visiting.add(sourceId)
    for (const target of edges.get(sourceId) ?? []) visit(target)
    visiting.delete(sourceId)
    visited.add(sourceId)
  }
  for (const sourceId of ids.sources) visit(sourceId)
}

const replaceCandidates = (records, kind, candidates) => {
  const values = new Map(records.map((record) => [record.documentId, record.content]))
  for (const candidate of candidates)
    if (candidate.kind === kind) values.set(candidate.id, candidate.content)
  return [...values.values()]
}

export const validateWorkspaceCandidates = async ({ candidates, repositories }) => {
  for (const candidate of candidates)
    if (identity(candidate.kind, candidate.content) !== candidate.id)
      throw new TypeError("Route and content identities differ")
  const [treeRecord, pageRecords, databaseRecords, sourceRecords] = await Promise.all([
    repositories.trees.read("structured-workspace"),
    repositories.pages.list(),
    repositories.databases.list(),
    repositories.sources.list(),
  ])
  if (treeRecord === null) throw new TypeError("Workspace tree is missing")
  const trees = replaceCandidates([treeRecord], "trees", candidates).map((value) =>
    workspaceSchema.parse(value),
  )
  const pages = replaceCandidates(pageRecords, "pages", candidates).map((value) =>
    pageDocumentSchema.parse(value),
  )
  const databases = replaceCandidates(databaseRecords, "databases", candidates).map((value) =>
    databaseSchema.parse(value),
  )
  const sources = replaceCandidates(sourceRecords, "sources", candidates).map((value) =>
    syncedSourceSchema.parse(value),
  )
  const tree = trees[0]
  if (tree === undefined) throw new TypeError("Workspace tree is missing")
  const ids = {
    pages: new Set(tree.pages.map((page) => page.id)),
    databases: new Set(databases.map((database) => database.id)),
    sources: new Set(sources.map((source) => source.id)),
  }
  validateTree(tree, new Set(pages.map((page) => page.pageId)))
  for (const page of pages) validatePage(page, ids)
  for (const database of databases) validateDatabase(database, ids.pages)
  validateSources(sources, ids)
}

export const validateWorkspaceEntity = ({ kind, id, content, repositories }) =>
  validateWorkspaceCandidates({ candidates: [{ kind, id, content }], repositories })
