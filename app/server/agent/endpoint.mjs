import { createWatchHub } from "@slop-lab/part/client/index.js"
import { fail, isJson, ok } from "@slop-lab/part/contracts/index.js"
import { agentRunInputSchema } from "./contracts.mjs"
import { AgentCommandConflictError, AgentRequestConflictError } from "./runtime.mjs"

const capabilities = {
  revision: "1",
  entries: [
    {
      id: "block-editor/app-agent-lifecycle",
      contractVersion: 1,
      status: "supported",
      implementedBy: "app/server/agent",
      constraints: { persistence: "app-journal", replayToolsAfterRestart: false },
    },
  ],
}

const wire = (value) => {
  if (!isJson(value)) throw new TypeError("Agent response is not wire-safe")
  return value
}

const operationRef = (run) => ({
  owner: "block-editor-app",
  kind: "block-editor/agent-run",
  id: run.id,
})

const itemFor = (run) => ({
  id: run.id,
  type: "block-editor/agent-run",
  schemaVersion: 1,
  revision: String(run.events.at(-1)?.id ?? 0),
  source: operationRef(run),
  payload: wire(run),
  fallback: {
    label: run.input.kind === "proposal" ? "Agent proposal" : "Agent task",
    text: run.status,
  },
  actions:
    run.status === "pending" || run.status === "running"
      ? [
          {
            id: "block-editor.agent/cancel",
            version: 1,
            input: { id: "part/string", version: 1 },
            output: { id: "part/json", version: 1 },
            targetKind: "block-editor/agent-run",
            execution: "immediate",
            availability: { state: "available", checkedAt: String(run.events.length) },
          },
        ]
      : [],
  artifacts: [],
})

const samePrincipal = (run, context) =>
  run.owner.subject === context.principal.subject &&
  run.owner.authority === context.principal.authority &&
  run.input.sessionId === context.scope.id

export const createAgentEndpoint = (runtime) => {
  const hubs = new Map()
  const ownerKey = (owner) => `${owner.authority}\u0000${owner.subject}`
  const hubFor = (owner) => {
    const key = ownerKey(owner)
    const existing = hubs.get(key)
    if (existing !== undefined) return existing
    const created = createWatchHub(capabilities)
    hubs.set(key, created)
    return created
  }
  const unsubscribe = runtime.subscribe((run) => hubFor(run.owner).upsert(itemFor(run)))
  void runtime.list().then((runs) => {
    for (const run of runs) hubFor(run.owner).upsert(itemFor(run))
  })
  return {
    async command(request, context) {
      if (request.protocolVersion !== 1 || request.actionVersion !== 1)
        return {
          kind: "rejected",
          commandId: request.commandId,
          error: fail("agent.protocol", "Unsupported command version", "unsupported").error,
        }
      if (request.actionId === "block-editor.agent/start") {
        const parsed = agentRunInputSchema.safeParse(request.input)
        if (!parsed.success)
          return {
            kind: "rejected",
            commandId: request.commandId,
            error: fail("agent.input", "Invalid agent run input").error,
          }
        if (parsed.data.sessionId !== context.scope.id)
          return {
            kind: "rejected",
            commandId: request.commandId,
            error: fail("agent.session", "Session scope mismatch", "permission").error,
          }
        let run
        try {
          run = await runtime.start(parsed.data, context.principal)
        } catch (error) {
          if (error instanceof AgentRequestConflictError)
            return {
              kind: "rejected",
              commandId: request.commandId,
              error: fail("agent.request-reused", error.message, "conflict").error,
            }
          throw error
        }
        return {
          kind: "accepted",
          commandId: request.commandId,
          operation: operationRef(run),
          commit: [
            {
              owner: "block-editor-app-agent-journal",
              revision: String(run.events.length),
              durability: "durable",
            },
          ],
        }
      }
      if (request.actionId === "block-editor.agent/cancel" && request.target !== undefined) {
        const run = await runtime.get(request.target.id)
        if (
          run === null ||
          request.target.kind !== "block-editor/agent-run" ||
          !samePrincipal(run, context)
        )
          return {
            kind: "rejected",
            commandId: request.commandId,
            error: fail("agent.target", "Agent run unavailable", "permission").error,
          }
        const reason = typeof request.input === "string" ? request.input : "client-request"
        let cancelled
        try {
          cancelled = await runtime.cancel(run.id, reason, request.commandId)
        } catch (error) {
          if (error instanceof AgentCommandConflictError)
            return {
              kind: "rejected",
              commandId: request.commandId,
              error: fail("agent.command-reused", error.message, "conflict").error,
            }
          throw error
        }
        return {
          kind: "completed",
          commandId: request.commandId,
          result: wire(cancelled),
          effect: "applied",
          commit: [],
        }
      }
      if (request.actionId === "block-editor.agent/apply" && request.target !== undefined) {
        const run = await runtime.get(request.target.id)
        if (
          run === null ||
          run.status !== "completed" ||
          request.target.kind !== "block-editor/agent-run" ||
          !samePrincipal(run, context)
        )
          return {
            kind: "rejected",
            commandId: request.commandId,
            error: fail("agent.target", "Completed agent proposal unavailable", "permission").error,
          }
        let applied
        try {
          applied = await runtime.apply(run.id, context.principal.subject, request.commandId)
        } catch (error) {
          if (error instanceof AgentCommandConflictError)
            return {
              kind: "rejected",
              commandId: request.commandId,
              error: fail("agent.command-reused", error.message, "conflict").error,
            }
          throw error
        }
        return {
          kind: "completed",
          commandId: request.commandId,
          result: wire(applied),
          effect: applied.kind === "applied" ? "applied" : "not-applied",
          commit: [],
        }
      }
      return {
        kind: "rejected",
        commandId: request.commandId,
        error: fail("agent.action", "Unsupported agent action", "unsupported").error,
      }
    },
    async query(request, context) {
      if (request.version !== 1)
        return fail("agent.query-version", "Unsupported query version", "unsupported")
      if (request.queryId === "part/capabilities") return ok(capabilities)
      if (request.queryId === "block-editor.agent/session")
        return ok({ sessionId: context.scope.id })
      if (request.queryId === "block-editor.agent/list") {
        const runs = (await runtime.list()).filter((run) => samePrincipal(run, context))
        return ok(wire(runs))
      }
      if (request.queryId === "block-editor.agent/get" && request.target !== undefined) {
        const run = await runtime.get(request.target.id)
        return run !== null && samePrincipal(run, context)
          ? ok(wire(run))
          : fail("agent.target", "Agent run unavailable", "permission")
      }
      return fail("agent.query", "Unsupported agent query", "unsupported")
    },
    async watch(_request, context) {
      return hubFor(context.principal).watch(context)
    },
    async close() {
      unsubscribe()
      for (const hub of hubs.values()) hub.close()
      hubs.clear()
      await runtime.dispose()
    },
  }
}
