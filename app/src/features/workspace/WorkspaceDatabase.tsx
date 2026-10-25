import { PlusIcon } from "@radix-ui/react-icons"
import {
  addDatabaseRow,
  type Database,
  filterAndSortRows,
  patchDatabaseRow,
} from "@slop-lab/blocks-workspace"
import { useMemo, useState } from "react"
import { WorkspaceKanban } from "./WorkspaceKanban"

type Props = { readonly database: Database; readonly onChange: (database: Database) => void }

export const WorkspaceDatabase = ({ database, onChange }: Props) => {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [descending, setDescending] = useState(false)
  const [layout, setLayout] = useState<"table" | "kanban">("table")
  const statusProperty = database.properties.find((property) => property.type === "status")
  const selectedStatus = statusProperty?.options.includes(status) === true ? status : ""
  const rows = useMemo(
    () =>
      filterAndSortRows(database, {
        query,
        ...(statusProperty === undefined || selectedStatus === ""
          ? {}
          : { filter: { propertyId: statusProperty.id, equals: selectedStatus } }),
        sort: { propertyId: "name", direction: descending ? "desc" : "asc" },
      }),
    [database, descending, query, selectedStatus, statusProperty],
  )
  return (
    <section className="structured-database" aria-label={database.name}>
      <header>
        <div>
          <span className="eyebrow">Database</span>
          <h2>{database.name}</h2>
        </div>
        <div className="structured-database__tools">
          <input
            aria-label="Search rows"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
          />
          {statusProperty !== undefined && (
            <select
              aria-label={`Filter by ${statusProperty.name}`}
              value={selectedStatus}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All {statusProperty.name} values</option>
              {statusProperty.options.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          )}
          <button type="button" onClick={() => setDescending((value) => !value)}>
            Name {descending ? "descending" : "ascending"}
          </button>
          <button type="button" onClick={() => setLayout(layout === "table" ? "kanban" : "table")}>
            {layout === "table" ? "Board view" : "Table view"}
          </button>
          <button
            type="button"
            onClick={() =>
              onChange(
                addDatabaseRow(database, {
                  id: `row-${crypto.randomUUID()}`,
                  values: { name: "New task" },
                }),
              )
            }
          >
            <PlusIcon /> Add row
          </button>
        </div>
      </header>
      {layout === "kanban" && statusProperty !== undefined ? (
        <WorkspaceKanban
          database={{ ...database, rows: [...rows] }}
          statusPropertyId={statusProperty.id}
          onChange={onChange}
        />
      ) : (
        <>
          <p className="structured-table-hint" id={`${database.id}-scroll-hint`}>
            Scroll the table horizontally to view all properties.
          </p>
          <section
            className="structured-table-wrap"
            aria-label={`${database.name} table`}
            aria-describedby={`${database.id}-scroll-hint`}
          >
            <table>
              <thead>
                <tr>
                  {database.properties.map((property) => (
                    <th key={property.id}>{property.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {database.properties.map((property) => {
                      const value = row.values[property.id]
                      if (property.type === "checkbox")
                        return (
                          <td key={property.id}>
                            <input
                              aria-label={`${row.id} ${property.name}`}
                              type="checkbox"
                              checked={value === true}
                              onChange={(event) =>
                                onChange(
                                  patchDatabaseRow(
                                    database,
                                    row.id,
                                    property.id,
                                    event.target.checked,
                                  ),
                                )
                              }
                            />
                          </td>
                        )
                      if (property.type === "status" || property.type === "select")
                        return (
                          <td key={property.id}>
                            <select
                              aria-label={`${row.id} ${property.name}`}
                              value={typeof value === "string" ? value : ""}
                              onChange={(event) =>
                                onChange(
                                  patchDatabaseRow(
                                    database,
                                    row.id,
                                    property.id,
                                    event.target.value,
                                  ),
                                )
                              }
                            >
                              {property.options.map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
                          </td>
                        )
                      return (
                        <td key={property.id}>
                          <input
                            aria-label={`${row.id} ${property.name}`}
                            value={
                              typeof value === "string" || typeof value === "number"
                                ? String(value)
                                : ""
                            }
                            onChange={(event) =>
                              onChange(
                                patchDatabaseRow(
                                  database,
                                  row.id,
                                  property.id,
                                  property.type === "number"
                                    ? Number(event.target.value)
                                    : event.target.value,
                                ),
                              )
                            }
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </section>
  )
}
