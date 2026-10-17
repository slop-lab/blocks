import { applyAuthoritativeCandidate } from "./authority.mjs"
import { AgentJournal } from "./journal.mjs"
import {
  AgentCommandConflictError,
  AgentRequestConflictError,
  createSerialGate,
  hashJson,
  receiptFor,
  requestKey,
  runEvent,
} from "./lifecycle.mjs"
import { startAgentOperation } from "./run-operation.mjs"

export { AgentCommandConflictError, AgentRequestConflictError }

const isActive = (run) => run.status === "pending" || run.status === "running"

export const createAgentRuntime = async ({
  root,
  model,
  applyCandidate = applyAuthoritativeCandidate,
  observeOperation = (handle, options) => handle.observe(options),
}) => {
  const journal = new AgentJournal(root)
  await journal.open()
  for (const run of journal.list()) {
    if (!isActive(run)) continue
    await journal.update(run.id, (current) => ({
      ...current,
      status: "interrupted",
      updatedAt: new Date().toISOString(),
      events: [
        ...current.events,
        runEvent(current, "run.interrupted", "server restarted; tools were not replayed"),
      ].slice(-100),
    }))
  }

  const active = new Map()
  const listeners = new Set()
  const runGate = createSerialGate()
  const requestGate = createSerialGate()
  let shuttingDown = false
  const notify = (run) => {
    for (const listener of listeners) {
      try {
        listener(structuredClone(run))
      } catch {}
    }
  }
  const update = async (id, change) => {
    const next = await journal.update(id, change)
    notify(next)
    return next
  }

  const start = async (raw, owner) => {
    const input = structuredClone(raw)
    const inputHash = hashJson(input)
    return requestGate(requestKey(owner, input), async () => {
      const prior = journal
        .list()
        .find(
          (run) =>
            run.owner.subject === owner.subject &&
            run.owner.authority === owner.authority &&
            run.input.sessionId === input.sessionId &&
            run.input.requestId === input.requestId,
        )
      if (prior !== undefined) {
        if ((prior.inputHash ?? hashJson(prior.input)) !== inputHash)
          throw new AgentRequestConflictError(
            `Request ${input.requestId} was reused with different input`,
          )
        return prior
      }
      return startAgentOperation({
        root,
        model,
        input,
        inputHash,
        owner,
        journal,
        update,
        notify,
        runGate,
        active,
        observeOperation,
        isShuttingDown: () => shuttingDown,
      })
    })
  }

  const cancel = (id, reason, commandId = crypto.randomUUID()) =>
    runGate(id, async () => {
      const current = journal.get(id)
      if (current === null) return null
      const inputHash = hashJson({ reason })
      const prior = receiptFor(current, commandId, "cancel", inputHash)
      if (prior !== null) return prior
      const running = active.get(id)
      const cancellation =
        running !== undefined && isActive(current) ? "requested" : current.cancellation
      const result = { status: current.status, cancellation }
      const next = await update(id, (run) => ({
        ...run,
        cancellation,
        updatedAt: new Date().toISOString(),
        events:
          running === undefined || !isActive(run)
            ? run.events
            : [...run.events, runEvent(run, "run.cancel-requested", reason)].slice(-100),
        commandReceipts: [
          ...run.commandReceipts,
          { commandId, action: "cancel", inputHash, result },
        ].slice(-100),
      }))
      if (running !== undefined && isActive(next)) {
        running.cancellation.abort(reason)
        await running.handle.requestCancel(reason)
      }
      return result
    })

  const apply = (id, actorId, commandId = crypto.randomUUID()) =>
    runGate(id, async () => {
      const current = journal.get(id)
      if (current === null) throw new RangeError(`Unknown agent run ${id}`)
      const inputHash = hashJson({ actorId })
      const prior = receiptFor(current, commandId, "apply", inputHash)
      if (prior !== null) return prior
      if (current.applicationResult !== null) {
        await update(id, (run) => ({
          ...run,
          commandReceipts: [
            ...run.commandReceipts,
            { commandId, action: "apply", inputHash, result: run.applicationResult },
          ].slice(-100),
        }))
        return current.applicationResult
      }
      if (current.application === "applying")
        return { kind: "conflict", actualRevision: "application-incomplete" }
      await update(id, (run) => ({ ...run, application: "applying" }))
      const result = await applyCandidate(root, current, actorId)
      await update(id, (run) => ({
        ...run,
        application: result.kind === "applied" ? "applied" : "conflict",
        applicationResult: result,
        updatedAt: new Date().toISOString(),
        events: [
          ...run.events,
          runEvent(
            run,
            result.kind === "applied" ? "candidate.applied" : "candidate.conflict",
            result.kind === "applied"
              ? `authoritative revision ${result.revision}`
              : `actual revision ${result.actualRevision}`,
          ),
        ].slice(-100),
        commandReceipts: [
          ...run.commandReceipts,
          { commandId, action: "apply", inputHash, result },
        ].slice(-100),
      }))
      return result
    })

  const interruptForShutdown = async () => {
    shuttingDown = true
    await Promise.all(
      [...active.entries()].map(([id, running]) =>
        runGate(id, async () => {
          running.observer.abort()
          running.cancellation.abort("server-shutdown")
          await update(id, (run) =>
            isActive(run)
              ? {
                  ...run,
                  status: "interrupted",
                  updatedAt: new Date().toISOString(),
                  events: [
                    ...run.events,
                    runEvent(run, "run.interrupted", "server shutdown"),
                  ].slice(-100),
                }
              : run,
          )
          await running.handle.requestCancel("server-shutdown")
          await running.handle.done
          await running.observation
          await running.disposeAgent()
          if (active.get(id) === running) active.delete(id)
        }),
      ),
    )
    listeners.clear()
  }

  return {
    start,
    get: async (id) => journal.get(id),
    list: async () => journal.list(),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async wait(id) {
      const running = active.get(id)
      if (running !== undefined) await running.terminal
      const record = journal.get(id)
      if (record === null) throw new RangeError(`Unknown agent run ${id}`)
      return record
    },
    async detach(id) {
      active.get(id)?.observer.abort()
    },
    cancel,
    apply,
    interruptForShutdown,
    dispose: interruptForShutdown,
  }
}
