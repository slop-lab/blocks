import type { BlockDocument } from "@slop-lab/blocks"
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
    onMessage("Starting the agent task.")
    try {
      const runningState = task.status === "running" ? state : await changeTaskStatus(state, task)
      onState(runningState)
      const runningTask = runningState.tasks.find((item) => item.id === task.id)
      const presentation = runningState.presentations[task.id]
      if (runningTask === undefined || presentation === undefined)
        throw new TypeError("Could not find the agent task target.")
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
        onMessage("Canceled the agent run.")
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
      onMessage("Created an agent candidate. Review it, then choose Save child document.")
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "The agent task was interrupted.")
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
