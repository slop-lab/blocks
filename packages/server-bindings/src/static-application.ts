import { existsSync, statSync } from "node:fs"
import { extname, resolve, sep } from "node:path"

type StaticApplicationOptions = {
  readonly assetsRoot: string
  readonly method: string | undefined
  readonly requestUrl: string | undefined
}

export type StaticApplicationResolution =
  | {
      readonly kind: "file"
      readonly path: string
      readonly contentType: string
      readonly cacheControl: string
    }
  | { readonly kind: "no-content" }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" }

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

const fileResolution = (path: string): StaticApplicationResolution => {
  const extension = extname(path).toLowerCase()
  return {
    kind: "file",
    path,
    contentType: contentTypes[extension] ?? "application/octet-stream",
    cacheControl: extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  }
}

export const resolveStaticApplication = (
  options: StaticApplicationOptions,
): StaticApplicationResolution => {
  const root = resolve(options.assetsRoot)
  const index = resolve(root, "index.html")
  if (!existsSync(index)) return { kind: "unavailable" }
  if (options.method !== undefined && options.method !== "GET" && options.method !== "HEAD")
    return { kind: "not-found" }

  const pathname = decodeURIComponent(
    new URL(options.requestUrl ?? "/", "http://localhost").pathname,
  )
  const candidate = resolve(root, `.${pathname}`)
  const withinRoot = candidate === root || candidate.startsWith(`${root}${sep}`)
  if (withinRoot && existsSync(candidate) && statSync(candidate).isFile())
    return fileResolution(candidate)
  if (pathname === "/favicon.ico") return { kind: "no-content" }
  if (!withinRoot || extname(pathname) !== "") return { kind: "not-found" }
  return fileResolution(index)
}
