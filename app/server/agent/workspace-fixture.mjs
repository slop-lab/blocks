// The deterministic demo selects the first status-bearing row and the final
// configured status option. It does not interpret or translate user data.
export const workspaceFixtureCalls = (database) => {
  const property = database.properties.find((item) => item.type === "status")
  if (property === undefined) throw new RangeError("Status property is unavailable")
  const row = database.rows.find((item) => typeof item.values[property.id] === "string")
  const after = property.options.at(-1)
  if (row === undefined || after === undefined)
    throw new RangeError("A status cell and option are required for the fixture")
  return [
    { name: "query_database_rows", arguments: {} },
    {
      name: "propose_row_status_patch",
      arguments: { rowId: row.id, propertyId: property.id, after },
    },
  ]
}
