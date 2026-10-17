const [major, minor] = process.versions.node.split(".").map(Number)
if (major < 24 || (major === 24 && minor < 22)) {
  console.error(`Node.js 24.22.0 or newer is required; current version is ${process.versions.node}`)
  process.exit(1)
}

const { createApplicationServer } = await import("./server/application.mjs")
const server = createApplicationServer()
server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0")
