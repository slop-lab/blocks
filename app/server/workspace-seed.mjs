export const sampleWorkspace = {
  id: "structured-workspace",
  version: 1,
  pages: [
    { id: "home", parentId: null, title: "팀 홈", icon: "note", archived: false },
    { id: "project", parentId: "home", title: "제품 출시", icon: "file", archived: false },
    { id: "research", parentId: "project", title: "사용자 조사", icon: "file", archived: false },
  ],
}

export const sampleDocuments = [
  {
    pageId: "home",
    version: 1,
    blocks: [
      { id: "home-h", type: "heading", level: 1, text: "팀 지식 작업실" },
      {
        id: "home-p",
        type: "paragraph",
        text: "문서, 데이터베이스, 공유 블록을 한곳에서 관리합니다.",
      },
      { id: "home-link", type: "page_ref", pageId: "project" },
    ],
  },
  {
    pageId: "project",
    version: 1,
    blocks: [
      { id: "project-h", type: "heading", level: 1, text: "제품 출시" },
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
      { id: "research-h", type: "heading", level: 2, text: "조사 메모" },
      { id: "research-q", type: "quote", text: "문맥은 이동해도 제목의 상대 수준은 보존됩니다." },
    ],
  },
]

export const sampleDatabases = [
  {
    id: "tasks",
    version: 1,
    name: "출시 작업",
    properties: [
      { id: "name", name: "작업", type: "text" },
      { id: "status", name: "상태", type: "status", options: ["대기", "진행", "완료"] },
      { id: "owner", name: "담당", type: "text" },
      { id: "done", name: "완료", type: "checkbox" },
    ],
    rows: [
      { id: "task-1", values: { name: "출시 노트", status: "진행", owner: "민서", done: false } },
      { id: "task-2", values: { name: "품질 확인", status: "대기", owner: "도윤", done: false } },
      { id: "task-3", values: { name: "인터뷰 정리", status: "완료", owner: "서연", done: true } },
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
        text: "공유 출시 메모입니다. 한 번 수정하면 모든 위치에 반영됩니다.",
      },
    ],
  },
]
