export const sampleWorkspace = {
  id: "structured-workspace",
  version: 1,
  pages: [
    { id: "home", parentId: null, title: "Team Home", icon: "note", archived: false },
    { id: "project", parentId: "home", title: "Product Launch", icon: "file", archived: false },
    { id: "research", parentId: "project", title: "User Research", icon: "file", archived: false },
  ],
}

export const sampleDocuments = [
  {
    pageId: "home",
    version: 1,
    blocks: [
      { id: "home-h", type: "heading", level: 1, text: "Team Knowledge Workspace" },
      {
        id: "home-p",
        type: "paragraph",
        text: "Manage documents, databases, and synced blocks in one place.",
      },
      { id: "home-link", type: "page_ref", pageId: "project" },
    ],
  },
  {
    pageId: "project",
    version: 1,
    blocks: [
      { id: "project-h", type: "heading", level: 1, text: "Product Launch" },
      {
        id: "project-shared-a",
        type: "synced_ref",
        occurrenceId: "occ-a",
        sourceId: "launch-note",
      },
      { id: "project-db", type: "database_embed", databaseId: "tasks", layout: "table" },
      {
        id: "project-shared-b",
        type: "synced_ref",
        occurrenceId: "occ-b",
        sourceId: "launch-note",
      },
    ],
  },
  {
    pageId: "research",
    version: 1,
    blocks: [
      { id: "research-h", type: "heading", level: 2, text: "Research Notes" },
      {
        id: "research-q",
        type: "quote",
        text: "Moving content preserves the heading's relative level.",
      },
    ],
  },
]

export const sampleDatabases = [
  {
    id: "tasks",
    version: 1,
    name: "Launch Tasks",
    properties: [
      { id: "name", name: "Task", type: "text" },
      { id: "status", name: "Status", type: "status", options: ["To do", "In progress", "Done"] },
      { id: "owner", name: "Owner", type: "text" },
      { id: "done", name: "Done", type: "checkbox" },
    ],
    rows: [
      {
        id: "task-1",
        values: { name: "Release notes", status: "In progress", owner: "Mina", done: false },
      },
      {
        id: "task-2",
        values: { name: "Quality review", status: "To do", owner: "Daniel", done: false },
      },
      {
        id: "task-3",
        values: { name: "Interview summary", status: "Done", owner: "Sarah", done: true },
      },
    ],
  },
]

export const sampleSources = [
  {
    id: "launch-note",
    version: 1,
    blocks: [
      {
        id: "shared-p",
        type: "paragraph",
        text: "This is a synced launch note. Edit it once to update every location.",
      },
    ],
  },
]
