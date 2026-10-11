const identity = (kind, content) => {
  switch (kind) {
    case "trees":
      return content.id
    case "pages":
      return content.pageId
    case "databases":
    case "sources":
      return content.id
    default:
      throw new TypeError(`Unsupported workspace entity kind: ${kind}`)
  }
}

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

const validateTree = (tree, documentIds) => {
  const pages = new Map(tree.pages.map((page) => [page.id, page]))
  if (pages.size !== tree.pages.length) throw new TypeError("Duplicate workspace page")
  for (const page of tree.pages) {
    if (!documentIds.has(page.id)) throw new TypeError(`Missing page document ${page.id}`)
    if (page.parentId !== null && !pages.has(page.parentId))
      throw new TypeError(`Unknown parent page ${page.parentId}`)
    const visited = new Set([page.id])
    let parentId = page.parentId
    while (parentId !== null) {
      if (visited.has(parentId)) throw new TypeError("Page hierarchy contains a cycle")
      visited.add(parentId)
      parentId = pages.get(parentId)?.parentId ?? null
    }
  }
}

const validatePage = (page, pageIds, databaseIds, sourceIds) => {
  if (!pageIds.has(page.pageId)) throw new TypeError(`Unknown page ${page.pageId}`)
  for (const block of page.blocks) {
    if (block.type === "page_ref" && !pageIds.has(block.pageId))
      throw new TypeError(`Unknown page reference ${block.pageId}`)
    if (block.type === "database_embed" && !databaseIds.has(block.databaseId))
      throw new TypeError(`Unknown database reference ${block.databaseId}`)
    if (block.type === "synced_ref" && !sourceIds.has(block.sourceId))
      throw new TypeError(`Unknown synced source ${block.sourceId}`)
  }
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

export const validateWorkspaceEntity = async ({ kind, id, content, repositories }) => {
  if (identity(kind, content) !== id) throw new TypeError("Route and content identities differ")
  const [treeRecord, documents, databases, sources] = await Promise.all([
    repositories.trees.read("structured-workspace"),
    repositories.pages.list(),
    repositories.databases.list(),
    repositories.sources.list(),
  ])
  if (treeRecord === null) throw new TypeError("Workspace tree is missing")
  const tree = kind === "trees" ? content : treeRecord.content
  const pageIds = new Set(tree.pages.map((page) => page.id))
  const documentIds = new Set(documents.map((record) => record.documentId))
  const databaseIds = new Set(databases.map((record) => record.documentId))
  const sourceIds = new Set(sources.map((record) => record.documentId))
  if (kind === "trees") validateTree(content, documentIds)
  if (kind === "pages") validatePage(content, pageIds, databaseIds, sourceIds)
  if (kind === "databases") validateDatabase(content, pageIds)
}
