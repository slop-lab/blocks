import { createHttpPort } from "@slop-lab/part/client/http.js"
import { localContext, ok } from "@slop-lab/part/contracts/index.js"
import { startHttpHost } from "@slop-lab/part-node/host/http.js"

export const startAgentHttpHost = (endpoint, authorize) =>
  startHttpHost(endpoint, {
    context(request) {
      const identity = authorize(request)
      return identity === null
        ? {
            ok: false,
            error: {
              code: "block-editor.agent.unauthorized",
              category: "permission",
              message: "Agent session unavailable",
              retry: "never",
            },
          }
        : ok(
            localContext({
              principal: identity.principal,
              scope: { kind: "session", id: identity.sessionId },
            }),
          )
    },
    host: "127.0.0.1",
    port: 0,
    maxBodyBytes: 256 * 1024,
  })

export const createAgentHttpPort = (baseUrl) =>
  createHttpPort(baseUrl, { maxFrameBytes: 256 * 1024 })
