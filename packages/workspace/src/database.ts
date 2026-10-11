import type { Database, DatabaseProperty, DatabaseRow } from "./schemas.js"

export class DatabaseValueError extends Error {
  readonly name = "DatabaseValueError"
}

type Filter = { readonly propertyId: string; readonly equals: unknown }
type Sort = { readonly propertyId: string; readonly direction: "asc" | "desc" }
type ViewQuery = { readonly query: string; readonly filter?: Filter; readonly sort?: Sort }

const accepts = (property: DatabaseProperty, value: unknown): boolean => {
  if (value === null) return true
  switch (property.type) {
    case "text":
    case "date":
      return typeof value === "string"
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "checkbox":
      return typeof value === "boolean"
    case "select":
    case "status":
      return typeof value === "string" && property.options.includes(value)
    case "relation":
      return typeof value === "string"
    default:
      return property satisfies never
  }
}

export const patchDatabaseRow = (
  database: Database,
  rowId: string,
  propertyId: string,
  value: unknown,
): Database => {
  const property = database.properties.find((candidate) => candidate.id === propertyId)
  if (property === undefined || !accepts(property, value))
    throw new DatabaseValueError(`Invalid property value for ${propertyId}`)
  if (!database.rows.some((row) => row.id === rowId))
    throw new DatabaseValueError(`Unknown row ${rowId}`)
  return {
    ...database,
    rows: database.rows.map((row) =>
      row.id === rowId ? { ...row, values: { ...row.values, [propertyId]: value } } : row,
    ),
  }
}

export const addDatabaseProperty = (database: Database, property: DatabaseProperty): Database => {
  if (database.properties.some((candidate) => candidate.id === property.id))
    throw new DatabaseValueError(`Duplicate property ${property.id}`)
  return { ...database, properties: [...database.properties, property] }
}

export const removeDatabaseProperty = (database: Database, propertyId: string): Database => {
  if (!database.properties.some((property) => property.id === propertyId))
    throw new DatabaseValueError(`Unknown property ${propertyId}`)
  if (database.properties.length === 1)
    throw new DatabaseValueError("A database requires one property")
  return {
    ...database,
    properties: database.properties.filter((property) => property.id !== propertyId),
    rows: database.rows.map((row) => ({
      ...row,
      values: Object.fromEntries(Object.entries(row.values).filter(([key]) => key !== propertyId)),
    })),
  }
}

export const addDatabaseRow = (database: Database, row: DatabaseRow): Database => {
  if (database.rows.some((candidate) => candidate.id === row.id))
    throw new DatabaseValueError(`Duplicate row ${row.id}`)
  for (const [propertyId, value] of Object.entries(row.values)) {
    const property = database.properties.find((candidate) => candidate.id === propertyId)
    if (property === undefined || !accepts(property, value))
      throw new DatabaseValueError(`Invalid property value for ${propertyId}`)
  }
  return { ...database, rows: [...database.rows, row] }
}

const searchable = (row: DatabaseRow): string =>
  Object.values(row.values).join(" ").toLocaleLowerCase()
const compare = (left: unknown, right: unknown): number =>
  String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true })

export const filterAndSortRows = (database: Database, view: ViewQuery): readonly DatabaseRow[] => {
  const query = view.query.trim().toLocaleLowerCase()
  const rows = database.rows.filter(
    (row) =>
      (query.length === 0 || searchable(row).includes(query)) &&
      (view.filter === undefined || row.values[view.filter.propertyId] === view.filter.equals),
  )
  if (view.sort === undefined) return rows
  const direction = view.sort.direction === "asc" ? 1 : -1
  return [...rows].sort((left, right) => {
    const result = compare(
      left.values[view.sort?.propertyId ?? ""],
      right.values[view.sort?.propertyId ?? ""],
    )
    return result === 0 ? left.id.localeCompare(right.id) : result * direction
  })
}
