// @ts-check
import { spawn } from "node:child_process"
import { createServer } from "vite"

const scenarios = [
  "browser",
  "advanced-browser",
  "block-interactions-browser",
  "workflow-browser",
  "ownership-browser",
  "agent-browser",
  "structured-workspace-browser",
  "structured-workspace-features-browser",
  "structured-workspace-nested-browser",
  "source-runtime-browser",
  "pages-editing-browser",
  "workspace-ime-browser",
  "block-level-drag-browser",
  "workspace-focus-browser",
  "git-documents-browser",
]

/** @param {string} name @param {NodeJS.ProcessEnv} env */
async function run(name, env) {
  console.log(`Browser scenario: ${name}`)
  const child = spawn(process.execPath, [`app/tests/${name}.mjs`], { env, stdio: "inherit" })
  await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(undefined)
      else reject(new Error(`${name} failed (${signal ?? code})`))
    })
  })
}

for (const scenario of scenarios) await run(scenario, process.env)

// The isolated composite harness is a Vite entry, not part of the production site.
const vite = await createServer({ server: { host: "127.0.0.1", port: 0 } })
try {
  await vite.listen()
  const address = vite.httpServer?.address()
  if (address === null || address === undefined || typeof address === "string")
    throw new TypeError("Missing composite harness server address")
  await run("composite-browser", {
    ...process.env,
    QA_BASE_URL: `http://127.0.0.1:${address.port}`,
  })
} finally {
  await vite.close()
}
