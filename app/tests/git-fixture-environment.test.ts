import { afterEach, expect, it, vi } from "vitest"
import { gitFixtureEnvironment } from "./git-fixture-environment"

afterEach(() => vi.unstubAllEnvs())

it("removes enclosing Git repository selectors while retaining ordinary identity settings", () => {
  const selectors = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_CONFIG_PARAMETERS",
  ]
  for (const name of selectors) vi.stubEnv(name, "enclosing-repository")
  vi.stubEnv("GIT_AUTHOR_NAME", "Fixture Author")
  vi.stubEnv("FIXTURE_MARKER", "retained")

  const environment = gitFixtureEnvironment()

  for (const name of selectors) expect(environment[name]).toBeUndefined()
  expect(environment["GIT_AUTHOR_NAME"]).toBe("Fixture Author")
  expect(environment["FIXTURE_MARKER"]).toBe("retained")
  expect(process.env["GIT_DIR"]).toBe("enclosing-repository")
})
