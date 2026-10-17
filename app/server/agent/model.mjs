import { bearerAuth, createFetchTransport } from "@slop-lab/part/model/index.js"
import { createOpenAICompatibleAdapter } from "@slop-lab/part-plugins/providers/openai-compatible/index.js"
import { fakeModel } from "@slop-lab/part-plugins/testing/index.js"

const STANDARD_KEYS = ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"]
const LEGACY_KEYS = ["PART_API_BASE", "PART_API_KEY", "PART_MODEL_ID"]

export class ProviderConfigurationError extends Error {
  name = "ProviderConfigurationError"
}

const selectedGroup = (environment) => {
  if (STANDARD_KEYS.some((key) => environment[key] !== undefined)) return STANDARD_KEYS
  if (LEGACY_KEYS.some((key) => environment[key] !== undefined)) return LEGACY_KEYS
  return null
}

const parseUrl = (raw, kind) => {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new ProviderConfigurationError(`${kind} must be an absolute URL`)
  }
  if (url.username !== "" || url.password !== "")
    throw new ProviderConfigurationError(`${kind} must not contain credentials`)
  if (url.search !== "") throw new ProviderConfigurationError(`${kind} must not contain a query`)
  if (url.hash !== "") throw new ProviderConfigurationError(`${kind} must not contain a fragment`)
  const loopback = new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new ProviderConfigurationError(`${kind} must use HTTPS except for localhost loopback`)
  return url
}

const configurationFromEnvironment = (environment) => {
  const keys = selectedGroup(environment)
  if (keys === null) return null
  const missing = keys.filter(
    (key) => environment[key] === undefined || environment[key].trim() === "",
  )
  if (missing.length > 0)
    throw new ProviderConfigurationError(
      `Incomplete provider configuration; missing ${missing.join(", ")}`,
    )
  const [urlKey, apiKeyKey, modelKey] = keys
  const configuredUrl = parseUrl(environment[urlKey].trim(), urlKey)
  if (keys === STANDARD_KEYS) {
    if (configuredUrl.pathname.replace(/\/+$/, "").endsWith("/chat/completions"))
      throw new ProviderConfigurationError(
        "OPENAI_BASE_URL must be a base URL, not a Chat Completions endpoint",
      )
    configuredUrl.pathname = `${configuredUrl.pathname.replace(/\/+$/, "")}/chat/completions`
  } else if (!configuredUrl.pathname.endsWith("/chat/completions")) {
    throw new ProviderConfigurationError(
      "PART_API_BASE must be the full OpenAI-compatible Chat Completions endpoint",
    )
  }
  return {
    endpoint: configuredUrl.href,
    apiKey: environment[apiKeyKey].trim(),
    model: environment[modelKey].trim(),
  }
}

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
  const configuration = configurationFromEnvironment(environment)
  return configuration === null ? createFixtureModel() : createRemoteModel(configuration)
}
