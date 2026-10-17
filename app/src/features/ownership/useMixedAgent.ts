import type { BlockDocument } from "@block-editor/model"
import { useEffect, useRef, useState } from "react"
import { createAgentSuggestionProvider } from "../../core/agent-suggestions"
import { SuggestionStream } from "../../core/proposals"
import { changeTaskStatus, type LowerDraft, type MixedState, type MixedTask } from "./mixed-api"

type MixedAgentOptions = {
  readonly state: MixedState | null
  readonly task: MixedTask | undefined
  readonly onState: (state: MixedState) => void
  readonly onDraft: (draft: LowerDraft) => void
  readonly onMessage: (message: string) => void
}

export const useMixedAgent = ({ state, task, onState, onDraft, onMessage }: MixedAgentOptions) => {
  const [running, setRunning] = useState(false)
  const stream = useRef(new SuggestionStream())
  useEffect(() => () => stream.current.cancel("observer-detach"), [])

  const run = async () => {
    if (running || state === null || task === undefined) return
    setRunning(true)
    onMessage("에이전트 작업을 시작합니다.")
    try {
      const runningState = task.status === "running" ? state : await changeTaskStatus(state, task)
      onState(runningState)
      const runningTask = runningState.tasks.find((item) => item.id === task.id)
      const presentation = runningState.presentations[task.id]
      if (runningTask === undefined || presentation === undefined)
        throw new TypeError("에이전트 작업 대상을 찾지 못했습니다.")
      const proposal = runningState.proposals.find((item) => item.taskId === runningTask.id)
      const source =
        proposal?.dependencyVersion === runningTask.version ? proposal.document : presentation
      let candidate: BlockDocument = source
      const outcome = await stream.current.start(
        createAgentSuggestionProvider(
          {
            modelId: "mixed-backlog",
            epoch: runningState.revision,
            baseVersion: runningState.revision,
            taskId: runningTask.id,
            dependencyVersion: runningTask.version,
          },
          "task",
        ),
        { document: source, instruction: runningTask.title },
        (document) => {
          candidate = document
        },
      )
      if (outcome === "cancelled") {
        onMessage("에이전트 실행을 취소했습니다.")
        return
      }
      onDraft({
        target: {
          taskId: runningTask.id,
          layer: "proposal",
          proposalId: proposal?.id ?? `agent-${runningTask.id}`,
          expectedRevision: runningState.revision,
          dependencyVersion: runningTask.version,
        },
        document: candidate,
        editVersion: 1,
      })
      onMessage("에이전트 후보를 만들었습니다. 검토한 뒤 하위 문서 저장을 선택하세요.")
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "에이전트 작업이 중단되었습니다.")
    } finally {
      setRunning(false)
    }
  }

  return {
    running,
    run,
    cancel: () => stream.current.cancel("execution-cancel"),
  }
}
