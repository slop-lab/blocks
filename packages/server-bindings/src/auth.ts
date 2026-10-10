import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"

const sessionSchema = z
  .object({
    subject: z.string().min(1),
    role: z.enum(["owner", "editor", "viewer"]),
    rooms: z.array(z.string().min(1)).max(100),
    issuer: z.string().min(1),
    expiresAt: z.number().int().positive(),
  })
  .strict()

export type DemoSession = z.infer<typeof sessionSchema>
export type AccessOperation = "read" | "write" | "approve"

export class InvalidSessionError extends Error {
  readonly name = "InvalidSessionError"
}

export class AccessDeniedError extends Error {
  readonly name = "AccessDeniedError"
  constructor(
    readonly room: string,
    readonly operation: AccessOperation,
  ) {
    super(`Session cannot ${operation} ${room}`)
  }
}

type AuthorityOptions = {
  readonly secret: string
  readonly issuer: string
  readonly lifetimeSeconds?: number
}

export class DemoSessionAuthority {
  constructor(private readonly options: AuthorityOptions) {
    if (options.secret.length < 24)
      throw new TypeError("Demo session secret must contain at least 24 characters")
  }

  private signature(payload: string): Buffer {
    return createHmac("sha256", this.options.secret).update(payload).digest()
  }

  issue(input: Pick<DemoSession, "subject" | "role" | "rooms">): string {
    const session = sessionSchema.parse({
      ...input,
      issuer: this.options.issuer,
      expiresAt: Math.floor(Date.now() / 1000) + (this.options.lifetimeSeconds ?? 3_600),
    })
    const payload = Buffer.from(JSON.stringify(session)).toString("base64url")
    return `${payload}.${this.signature(payload).toString("base64url")}`
  }

  verify(token: string): DemoSession {
    const [payload, encodedSignature, extra] = token.split(".")
    if (payload === undefined || encodedSignature === undefined || extra !== undefined)
      throw new InvalidSessionError("Malformed demo session")
    const received = Buffer.from(encodedSignature, "base64url")
    const expected = this.signature(payload)
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      throw new InvalidSessionError("Invalid demo session signature")
    const session = sessionSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    )
    if (
      session.issuer !== this.options.issuer ||
      session.expiresAt <= Math.floor(Date.now() / 1000)
    )
      throw new InvalidSessionError("Expired demo session")
    return session
  }

  require(session: DemoSession, room: string, operation: AccessOperation): void {
    const scoped = session.rooms.includes(room) || session.rooms.includes("*")
    const allowed =
      scoped &&
      (operation === "read" ||
        (operation === "write" && (session.role === "owner" || session.role === "editor")) ||
        (operation === "approve" && session.role === "owner"))
    if (!allowed) throw new AccessDeniedError(room, operation)
  }
}
