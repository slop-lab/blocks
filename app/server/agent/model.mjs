import { bearerAuth, createFetchTransport } from "@slop-lab/part/model/index.js"
import { createOpenAICompatibleAdapter } from "@slop-lab/part-plugins/providers/openai-compatible/index.js"
import { fakeModel } from "@slop-lab/part-plugins/testing/index.js"

export const createFixtureModel = (options = {}) => {
  const requests = []
  return {
    kind: "fixture",
    label: "결정적 시나리오 / 모델미연결",
    create(input) {
      const scenarios = {
        "markdown-git": [
          { name: "search_documents", arguments: { query: input.instruction } },
          {
            name: "read_markdown_range",
            arguments: { file: input.target.resourceId, startLine: 1, endLine: 10_000 },
          },
          {
            name: "propose_markdown_replacement",
            arguments: { append: input.instruction },
          },
        ],
        "structured-workspace": [
          { name: "query_database_rows", arguments: {} },
          {
            name: "propose_row_status_patch",
            arguments: { rowId: "task-1", propertyId: "status", after: "완료" },
          },
        ],
        "mixed-backlog": [
          { name: "list_running_tasks", arguments: {} },
          { name: "read_task_context", arguments: {} },
          { name: "read_linked_evidence", arguments: {} },
          { name: "propose_task_plan", arguments: { text: input.instruction } },
        ],
        default: [{ name: "candidate_patch", arguments: { text: input.instruction } }],
      }
      const calls = scenarios[input.target.modelId] ?? scenarios.default
      const configured = fakeModel([
        ...calls.map((call) => ({ toolCalls: [call] })),
        { text: "review artifact ready" },
      ])
      if (!options.pause) {
        return {
          ...configured,
          transport: {
            ...configured.transport,
            async send(request, profile, auth, context) {
              const result = await configured.transport.send(request, profile, auth, context)
              requests.push(...configured.requests.slice(requests.length))
              return result
            },
          },
        }
      }
      return {
        ...configured,
        transport: {
          id: "part/paused-fixture",
          async send(request, _profile, _auth, context) {
            requests.push(request)
            return {
              ok: true,
              value: {
                status: 200,
                headers: {},
                body: {
                  async *[Symbol.asyncIterator]() {
                    await new Promise((resolve) => {
                      context.signal.addEventListener("abort", resolve, { once: true })
                    })
                  },
                },
              },
            }
          },
        },
        profile: { ...configured.profile, transportId: "part/paused-fixture" },
      }
    },
    requests: () => requests,
  }
}

export const createRemoteModel = (config) => {
  const endpoint = new URL(config.endpoint)
  return {
    kind: "remote",
    label: config.model,
    create() {
      return {
        profile: {
          id: "configured-remote",
          revision: "1",
          adapterId: "part/openai-compatible",
          transportId: "part/fetch",
          authStrategyId: "part/bearer",
          model: config.model,
          endpoint: endpoint.href,
          defaults: {},
          capabilities: { revision: "1", entries: [] },
        },
        adapter: createOpenAICompatibleAdapter(),
        transport: createFetchTransport({ allowedOrigins: [endpoint.origin] }),
        auth: bearerAuth(() => config.apiKey),
      }
    },
    requests: () => [],
  }
}

export const modelFromEnvironment = (environment) => {
  const endpoint = environment.PART_API_BASE
  const model = environment.PART_MODEL_ID
  const apiKey = environment.PART_API_KEY
  return endpoint && model && apiKey
    ? createRemoteModel({ endpoint, model, apiKey })
    : createFixtureModel()
}
