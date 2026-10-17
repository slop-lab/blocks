import { expect, it } from "vitest"
import { ProviderConfigurationError, modelFromEnvironment } from "../server/agent/model.mjs"

const standard = {
  OPENAI_BASE_URL: "https://api.example.com/v1/",
  OPENAI_API_KEY: "standard-secret",
  OPENAI_MODEL: "example-model",
}

it("uses the fixture only when no provider variables are configured", () => {
  const model = modelFromEnvironment({})

  expect(model.kind).toBe("fixture")
})

it("normalizes the standard base URL to the Chat Completions endpoint", () => {
  const model = modelFromEnvironment(standard)
  const configured = model.create()

  expect(model).toMatchObject({ kind: "remote", label: "example-model" })
  expect(configured.profile).toMatchObject({
    model: "example-model",
    endpoint: "https://api.example.com/v1/chat/completions",
  })
})

it("gives the standard group precedence over a complete legacy group", () => {
  const model = modelFromEnvironment({
    ...standard,
    PART_API_BASE: "https://legacy.example.com/v1/chat/completions",
    PART_API_KEY: "legacy-secret",
    PART_MODEL_ID: "legacy-model",
  })

  expect(model.create().profile).toMatchObject({
    model: "example-model",
    endpoint: "https://api.example.com/v1/chat/completions",
  })
})

it("preserves the legacy full-endpoint configuration", () => {
  const model = modelFromEnvironment({
    PART_API_BASE: "https://legacy.example.com/v1/chat/completions",
    PART_API_KEY: "legacy-secret",
    PART_MODEL_ID: "legacy-model",
  })

  expect(model.create().profile).toMatchObject({
    model: "legacy-model",
    endpoint: "https://legacy.example.com/v1/chat/completions",
  })
})

it.each([
  [{ OPENAI_BASE_URL: standard.OPENAI_BASE_URL }, "OPENAI_API_KEY, OPENAI_MODEL"],
  [{ PART_API_BASE: "https://api.example.com/v1/chat/completions" }, "PART_API_KEY, PART_MODEL_ID"],
])("rejects incomplete provider groups instead of falling back", (environment, missing) => {
  expect(() => modelFromEnvironment(environment)).toThrowError(
    new ProviderConfigurationError(`Incomplete provider configuration; missing ${missing}`),
  )
})

it.each([
  ["http://api.example.com/v1", "HTTPS"],
  ["https://user:password@api.example.com/v1", "credentials"],
  ["https://api.example.com/v1?token=value", "query"],
  ["https://api.example.com/v1#fragment", "fragment"],
  ["https://api.example.com/v1/chat/completions", "base URL"],
])("rejects an unsafe or ambiguous standard base URL", (baseUrl, reason) => {
  expect(() => modelFromEnvironment({ ...standard, OPENAI_BASE_URL: baseUrl })).toThrowError(
    new RegExp(reason, "i"),
  )
})

it("allows plain HTTP only for a loopback provider", () => {
  const model = modelFromEnvironment({ ...standard, OPENAI_BASE_URL: "http://127.0.0.1:8080/v1" })

  expect(model.create().profile.endpoint).toBe("http://127.0.0.1:8080/v1/chat/completions")
})
