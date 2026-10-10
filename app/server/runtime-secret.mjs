import { randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const validate = (secret) => {
  if (typeof secret !== "string" || secret.length < 24)
    throw new TypeError("DEMO_SESSION_SECRET must contain at least 24 characters")
  return secret
}

export const loadSessionSecret = (runtimeRoot, configuredSecret) => {
  if (configuredSecret !== undefined) return validate(configuredSecret)
  if (process.env.DEMO_SESSION_SECRET !== undefined) return validate(process.env.DEMO_SESSION_SECRET)
  mkdirSync(runtimeRoot, { recursive: true })
  const path = join(runtimeRoot, "demo-session.secret")
  try {
    return validate(readFileSync(path, "utf8"))
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  const secret = randomBytes(32).toString("base64url")
  writeFileSync(path, secret, { encoding: "utf8", mode: 0o600, flag: "wx" })
  return secret
}
