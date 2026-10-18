import { bearerAuth, createFetchTransport } from "@slop-lab/part/model/index.js"
import { createOpenAICompatibleAdapter } from "@slop-lab/part-plugins/providers/openai-compatible/index.js"
import { fakeModel } from "@slop-lab/part-plugins/testing/index.js"
import ky from "ky"
import { z } from "zod"

const STANDARD_KEYS = ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"]
const LEGACY_KEYS = ["PART_API_BASE", "PART_API_KEY", "PART_MODEL_ID"]
const FIXTURE_MODEL_ID = "fixture/deterministic"
const MAX_CATALOG_BYTES = 1024 * 1024
const CATALOG_TTL_MS = 30_000
const modelIdSchema = z.string().trim().min(1).max(200)
const catalogResponseSchema = z.object({
  data: z.array(z.object({ id: modelIdSchema })).max(1_000),
})

export class ProviderConfigurationError extends Error {
  name = "ProviderConfigurationError"
}

export class ModelCatalogError extends Error {
  name = "ModelCatalogError"
}

export class ModelSelectionError extends Error {
  name = "ModelSelectionError"
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
  const requiredKeys = keys.slice(0, 2)
  const missing = requiredKeys.filter(
    (key) => environment[key] === undefined || environment[key].trim() === "",
  )
  if (missing.length > 0)
    throw new ProviderConfigurationError(
      `Incomplete provider configuration; missing ${missing.join(", ")}`,
    )
  const [urlKey, apiKeyKey, modelKey] = keys
  const configuredUrl = parseUrl(environment[urlKey].trim(), urlKey)
  let modelsUrl
  if (keys === STANDARD_KEYS) {
    if (configuredUrl.pathname.replace(/\/+$/, "").endsWith("/chat/completions"))
      throw new ProviderConfigurationError(
        "OPENAI_BASE_URL must be a base URL, not a Chat Completions endpoint",
      )
    const basePath = configuredUrl.pathname.replace(/\/+$/, "")
    modelsUrl = new URL(configuredUrl)
    modelsUrl.pathname = `${basePath}/models`
    configuredUrl.pathname = `${basePath}/chat/completions`
  } else if (!configuredUrl.pathname.endsWith("/chat/completions")) {
    throw new ProviderConfigurationError(
      "PART_API_BASE must be the full OpenAI-compatible Chat Completions endpoint",
    )
  } else {
    modelsUrl = new URL(configuredUrl)
    modelsUrl.pathname = `${configuredUrl.pathname.slice(0, -"/chat/completions".length)}/models`
  }
  const rawModel = environment[modelKey]
  return {
    endpoint: configuredUrl.href,
    modelsEndpoint: modelsUrl.href,
    apiKey: environment[apiKeyKey].trim(),
    model: rawModel === undefined || rawModel.trim() === "" ? null : rawModel.trim(),
  }
}

const readCatalog = async (response) => {
  if (response.body === null) throw new ModelCatalogError("Model catalog response was empty")
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_CATALOG_BYTES)
        throw new ModelCatalogError("Model catalog response was too large")
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return catalogResponseSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError)
      throw new ModelCatalogError("Model catalog response was invalid")
    throw error
  }
}

export const createFixtureModel = (options = {}) => {
  const requests = []
  const catalog = {
    models: [
      {
        id: FIXTURE_MODEL_ID,
        providerLabel: "결정적 시나리오 / 모델미연결",
      },
    ],
    defaultModel: FIXTURE_MODEL_ID,
  }
  const model = {
    kind: "fixture",
    label: "결정적 시나리오 / 모델미연결",
    catalog: async () => catalog,
    resolve: async (input) => {
      const selected = input.inferenceModel ?? FIXTURE_MODEL_ID
      if (selected !== FIXTURE_MODEL_ID)
        throw new ModelSelectionError("The selected model is unavailable")
      return {
        id: FIXTURE_MODEL_ID,
        kind: "fixture",
        label: "결정적 시나리오 / 모델미연결",
        create: (resolvedInput) => model.create(resolvedInput),
      }
    },
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
  return model
}

export const createRemoteModel = (config) => {
  const endpoint = new URL(config.endpoint)
  let cached = null
  let pending = null
  const catalog = async ({ refresh = false } = {}) => {
    if (!refresh && cached !== null && Date.now() - cached.loadedAt < CATALOG_TTL_MS)
      return cached.value
    if (!refresh && pending !== null) return pending
    const load = async () => {
      try {
        const response = await ky.get(config.modelsEndpoint, {
          headers: { authorization: `Bearer ${config.apiKey}` },
          retry: 0,
          timeout: 5_000,
        })
        const parsed = await readCatalog(response)
        const ids = [...new Set(parsed.data.map((entry) => entry.id))]
        if (ids.length === 0) throw new ModelCatalogError("Model catalog was empty")
        if (config.model !== null && !ids.includes(config.model))
          throw new ModelCatalogError("Configured default model is unavailable")
        const value = {
          models: ids.map((id) => ({ id, providerLabel: id })),
          defaultModel: config.model ?? ids[0],
        }
        cached = { loadedAt: Date.now(), value }
        return value
      } catch (error) {
        if (error instanceof ModelCatalogError) throw error
        throw new ModelCatalogError("Model catalog could not be loaded")
      } finally {
        pending = null
      }
    }
    pending = load()
    return pending
  }
  const snapshot = (modelId) => ({
    id: modelId,
    kind: "remote",
    label: modelId,
    create() {
      return {
        profile: {
          id: "configured-remote",
          revision: "1",
          adapterId: "part/openai-compatible",
          transportId: "part/fetch",
          authStrategyId: "part/bearer",
          model: modelId,
          endpoint: endpoint.href,
          defaults: {},
          capabilities: { revision: "1", entries: [] },
        },
        adapter: createOpenAICompatibleAdapter(),
        transport: createFetchTransport({ allowedOrigins: [endpoint.origin] }),
        auth: bearerAuth(() => config.apiKey),
      }
    },
  })
  return {
    kind: "remote",
    label: config.model ?? "OpenAI-compatible",
    catalog,
    async resolve(input) {
      const available = await catalog()
      const modelId = input.inferenceModel ?? available.defaultModel
      if (!available.models.some((model) => model.id === modelId))
        throw new ModelSelectionError("The selected model is unavailable")
      return snapshot(modelId)
    },
    create(input = {}) {
      const modelId = input.inferenceModel ?? config.model
      if (modelId === null || modelId === undefined)
        throw new ModelSelectionError("A model selection is required")
      return snapshot(modelId).create()
    },
    requests: () => [],
  }
}

export const modelFromEnvironment = (environment) => {
  const configuration = configurationFromEnvironment(environment)
  return configuration === null ? createFixtureModel() : createRemoteModel(configuration)
}
