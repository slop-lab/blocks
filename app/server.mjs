import { createApplicationServer } from "./server/application.mjs"

const server = createApplicationServer()
server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0")
