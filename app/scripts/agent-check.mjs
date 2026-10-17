import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { modelFromEnvironment } from "../server/agent/model.mjs"
import { createAgentRuntime } from "../server/agent/runtime.mjs"

const HELP = `Usage: corepack pnpm agent:check [--timeout-ms <milliseconds>]

Runs one OpenAI-compatible Chat Completions tool turn through the Part agent runtime.
Provider responses and credentials are never printed. The request may consume provider quota.
`

class AgentCheckError extends Error {
  name = "AgentCheckError"
}

const timeoutFromArguments = (arguments_) => {
  if (arguments_.length === 0) return 45_000
  if (arguments_.length !== 2 || arguments_[0] !== "--timeout-ms")
    throw new AgentCheckError("Invalid arguments. Run agent:check --help for usage.")
  const timeout = Number(arguments_[1])
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000)
    throw new AgentCheckError("--timeout-ms must be an integer from 1 to 60000")
  return timeout
}

const redact = (message, environment) => {
  let redacted = message
  for (const secret of [environment.OPENAI_API_KEY, environment.PART_API_KEY]) {
    if (secret !== undefined && secret !== "") redacted = redacted.replaceAll(secret, "[redacted]")
  }
  return redacted
}

const runCheck = async (environment, timeoutMs) => {
  const model = modelFromEnvironment(environment)
  if (model.kind !== "remote")
    throw new AgentCheckError(
      "No provider configured. Set OPENAI_BASE_URL, OPENAI_API_KEY, and OPENAI_MODEL.",
    )
  const root = await mkdtemp(join(tmpdir(), "blocks-agent-check-"))
  const runtime = await createAgentRuntime({ root, model })
  try {
    const started = await runtime.start(
      {
        kind: "proposal",
        requestId: crypto.randomUUID(),
        sessionId: "agent-connectivity-check",
        instruction:
          'Call candidate_patch exactly once with {"text":"OpenAI-compatible connectivity verified"}, then finish.',
        target: { modelId: "connectivity-check", epoch: 1, baseVersion: 0 },
        document: { format: "block-editor/v0.3", blocks: [] },
      },
      { subject: "local-developer", authority: "agent-check" },
    )
    let timer
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
    })
    const result = await Promise.race([
      runtime.wait(started.id).then((run) => ({ kind: "completed", run })),
      timeout,
    ])
    clearTimeout(timer)
    if (result.kind === "timeout") {
      await runtime.cancel(started.id, "connectivity check timeout")
      await runtime.wait(started.id)
      throw new AgentCheckError(`Provider check timed out after ${timeoutMs} ms`)
    }
    if (result.run.status !== "completed")
      throw new AgentCheckError(result.run.error ?? `Provider check ended as ${result.run.status}`)
    const toolTurns = result.run.events.filter((event) => event.type === "tool.proposal").length
    if (toolTurns !== 1 || result.run.candidate?.blocks.length !== 1)
      throw new AgentCheckError("Provider completed without the required candidate_patch tool turn")
    return { model: model.label, toolTurns }
  } finally {
    await runtime.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

const main = async () => {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(HELP)
    return
  }
  const result = await runCheck(process.env, timeoutFromArguments(process.argv.slice(2)))
  process.stdout.write(
    `status: passed\nmodel: ${result.model}\ntransport: OpenAI-compatible Chat Completions SSE\ntool turns: ${result.toolTurns}\ncanonical apply: not requested\n`,
  )
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown agent check failure"
  process.stderr.write(`agent:check failed: ${redact(message, process.env)}\n`)
  process.exitCode = 1
})
