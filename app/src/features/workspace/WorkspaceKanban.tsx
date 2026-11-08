import { type Database, groupDatabaseRows, patchDatabaseRow } from "@slop-lab/blocks-workspace"

type Props = {
  readonly database: Database
  readonly statusPropertyId: string
  readonly onChange: (database: Database) => void
}

export const WorkspaceKanban = ({ database, statusPropertyId, onChange }: Props) => {
  const groups = groupDatabaseRows(database, statusPropertyId)
  return (
    <section className="structured-kanban" aria-label={`${database.name} board`}>
      {groups.map((group) => (
        <section className="structured-kanban__column" key={group.status}>
          <h3>
            {group.status} <span>{group.rows.length}</span>
          </h3>
          {group.rows.map((row) => (
            <article className="structured-kanban__card" key={row.id}>
              <strong>{String(row.values["name"] ?? row.id)}</strong>
              <select
                aria-label={`${row.id} status`}
                value={group.status}
                onChange={(event) =>
                  onChange(
                    patchDatabaseRow(database, row.id, statusPropertyId, event.currentTarget.value),
                  )
                }
              >
                {groups.map((target) => (
                  <option key={target.status}>{target.status}</option>
                ))}
              </select>
            </article>
          ))}
        </section>
      ))}
    </section>
  )
}
