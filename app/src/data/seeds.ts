import type { BlockDocument } from "../core/types"

const text = (value: string) => [{ kind: "text" as const, text: value, marks: [] }]

export const noteSeed: BlockDocument = {
  format: "block-editor/v0.3",
  blocks: [
    {
      id: "note-title",
      type: "heading",
      attrs: { level: 1 },
      content: text("토요일의 독서 모임"),
    },
    {
      id: "note-lead",
      type: "paragraph",
      attrs: {},
      content: text(
        "각자 마음에 남은 문장을 한 편씩 가져옵니다. 책을 끝까지 읽지 못했더라도 함께 이야기할 수 있어요.",
      ),
    },
    { id: "note-h2", type: "heading", attrs: { level: 2 }, content: text("이야기 나눌 질문") },
    {
      id: "note-body",
      type: "paragraph",
      attrs: {},
      content: text(
        "최근에 다른 시선으로 보게 된 일은 무엇인가요? 문장 하나가 일상의 선택을 바꿨던 경험도 함께 나눠 봅시다.",
      ),
    },
    {
      id: "note-quote",
      type: "quote",
      attrs: {},
      content: text("좋은 질문은 익숙한 풍경을 새롭게 보여줍니다."),
    },
    {
      id: "note-code",
      type: "code",
      attrs: {},
      content: text("14:00 안부 나누기\n14:20 문장 읽기\n15:00 자유로운 대화"),
    },
    {
      id: "note-locked",
      type: "paragraph",
      attrs: {},
      content: text("모임 안내: 서로의 이야기는 동의 없이 밖으로 옮기지 않습니다."),
      locked: true,
    },
  ],
}

export const presentationSeed: BlockDocument = {
  format: "block-editor/v0.3",
  blocks: [
    {
      id: "deck-title",
      type: "heading",
      attrs: { level: 1 },
      content: text("봄 워크숍 진행안"),
    },
    {
      id: "deck-intro",
      type: "paragraph",
      attrs: {},
      content: text(
        "동네 창작자들과 함께하는 작은 워크숍입니다. 준비할 일을 확인하고 필요한 메모를 카드 아래에 남겨 주세요.",
      ),
    },
    {
      id: "task-card-a",
      type: "task_card",
      attrs: { taskId: "TASK-142" },
      content: [],
    },
    {
      id: "caption-a",
      type: "caption",
      attrs: { refBlockId: "task-card-a" },
      content: text("채광이 좋은 공간으로 예약하고 휠체어 출입 동선을 확인합니다."),
    },
    {
      id: "task-card-b",
      type: "task_card",
      attrs: { taskId: "TASK-153" },
      content: [],
    },
    {
      id: "caption-b",
      type: "caption",
      attrs: { refBlockId: "task-card-b" },
      content: text("참가자에게 준비물과 찾아오는 길을 함께 안내합니다."),
    },
  ],
}

export const readonlySeed: BlockDocument = {
  format: "block-editor/v0.3",
  blocks: [
    { id: "read-title", type: "heading", attrs: { level: 1 }, content: text("워크숍 안내") },
    {
      id: "read-body",
      type: "paragraph",
      attrs: {},
      content: text(
        "확정된 안내문입니다. 토요일 오후 두 시, 마을 작업실에서 만나요. 아래 준비 항목의 상태는 담당자가 변경할 수 있습니다.",
      ),
    },
    {
      id: "read-task",
      type: "task_card",
      attrs: { taskId: "TASK-201" },
      content: [],
    },
    {
      id: "read-caption",
      type: "caption",
      attrs: { refBlockId: "read-task" },
      content: text("일정이 바뀌면 담당자가 안내를 갱신합니다."),
      locked: true,
    },
  ],
}
