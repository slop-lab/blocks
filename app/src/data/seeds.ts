import type { BlockDocument } from "../core/types"

const text = (value: string) => [{ kind: "text" as const, text: value, marks: [] }]

export const noteSeed: BlockDocument = {
  format: "block-editor/v0.3",
  blocks: [
    {
      id: "note-title",
      type: "heading",
      attrs: { level: 1 },
      content: text("Saturday Book Club"),
    },
    {
      id: "note-lead",
      type: "paragraph",
      attrs: {},
      content: text(
        "Bring one passage that stayed with you. You can still join the conversation even if you did not finish the book.",
      ),
    },
    { id: "note-h2", type: "heading", attrs: { level: 2 }, content: text("Questions to discuss") },
    {
      id: "note-body",
      type: "paragraph",
      attrs: {},
      content: text(
        "What have you seen from a different perspective lately? Share a time when a single sentence changed an everyday choice.",
      ),
    },
    {
      id: "note-quote",
      type: "quote",
      attrs: {},
      content: text("A good question makes a familiar landscape feel new."),
    },
    {
      id: "note-code",
      type: "code",
      attrs: {},
      content: text("14:00 Check-in\n14:20 Read passages\n15:00 Open discussion"),
    },
    {
      id: "note-locked",
      type: "paragraph",
      attrs: {},
      content: text(
        "Meeting note: Do not share anyone's story outside the group without their consent.",
      ),
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
      content: text("Spring Workshop Plan"),
    },
    {
      id: "deck-intro",
      type: "paragraph",
      attrs: {},
      content: text(
        "This is a small workshop for local makers. Review the preparation tasks and leave any needed notes beneath each card.",
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
      content: text("Reserve a well-lit space and confirm wheelchair access."),
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
      content: text("Send participants the materials list and directions to the venue."),
    },
  ],
}

export const readonlySeed: BlockDocument = {
  format: "block-editor/v0.3",
  blocks: [
    { id: "read-title", type: "heading", attrs: { level: 1 }, content: text("Workshop Guide") },
    {
      id: "read-body",
      type: "paragraph",
      attrs: {},
      content: text(
        "This guide is final. We will meet at the community workshop at 2:00 PM on Saturday. The coordinator can update the preparation status below.",
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
      content: text("The coordinator will update this guide if the schedule changes."),
      locked: true,
    },
  ],
}
