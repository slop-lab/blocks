import {
  addDatabaseRow,
  type Database,
  filterAndSortRows,
  patchDatabaseRow,
} from "@block-editor/workspace"
import { PlusIcon } from "@radix-ui/react-icons"
import { useMemo, useState } from "react"
import { WorkspaceKanban } from "./WorkspaceKanban"

type Props = { readonly database: Database; readonly onChange: (database: Database) => void }

export const WorkspaceDatabase = ({ database, onChange }: Props) => {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [descending, setDescending] = useState(false)
  const [layout, setLayout] = useState<"table" | "kanban">("table")
  const statusProperty = database.properties.find((property) => property.type === "status")
  const rows = useMemo(
    () =>
      filterAndSortRows(database, {
        query,
        ...(status === "" ? {} : { filter: { propertyId: "status", equals: status } }),
        sort: { propertyId: "name", direction: descending ? "desc" : "asc" },
      }),
    [database, descending, query, status],
  )
  return (
    <section className="structured-database" aria-label={database.name}>
      <header>
        <div>
          <span className="eyebrow">데이터베이스</span>
          <h2>{database.name}</h2>
        </div>
        <div className="structured-database__tools">
          <input
            aria-label="행 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="작업 검색"
          />
          <select
            aria-label="상태 필터"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">모든 상태</option>
            <option>대기</option>
            <option>진행</option>
            <option>완료</option>
          </select>
          <button type="button" onClick={() => setDescending((value) => !value)}>
            이름 {descending ? "내림차순" : "오름차순"}
          </button>
          <button type="button" onClick={() => setLayout(layout === "table" ? "kanban" : "table")}>
            {layout === "table" ? "보드 보기" : "표 보기"}
          </button>
          <button
            type="button"
            onClick={() =>
              onChange(
                addDatabaseRow(database, {
                  id: `row-${crypto.randomUUID()}`,
                  values: { name: "새 작업" },
                }),
              )
            }
          >
            <PlusIcon /> 행 추가
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
            표를 좌우로 스크롤해 모든 속성을 확인하세요.
          </p>
          <section
            className="structured-table-wrap"
            aria-label={`${database.name} 표`}
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
