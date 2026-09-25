import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import config from "./vite.config.mjs"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist")
const routes = new Map()
config.plugins.find((plugin) => plugin.name === "scribeowl-api").configureServer({
  middlewares: {
    use(prefix, handler) {
      routes.set(prefix, handler)
    }
  }
})

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
}

createServer(async (req, res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname
  if (pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok")
    return
  }

  const route = routes.get(pathname)
  if (route) {
    req.url = (req.url || "").slice(pathname.length) || "/"
    return route(req, res)
  }

  if (pathname.startsWith("/api/")) {
    res.writeHead(404).end()
    return
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end()
    return
  }

  try {
    const requested = path.resolve(root, `.${decodeURIComponent(pathname)}`)
    const file = requested.startsWith(`${root}${path.sep}`) ? requested : path.join(root, "index.html")
    const target = (await stat(file)).isFile() ? file : path.join(root, "index.html")
    const body = await readFile(target)
    res.writeHead(200, { "content-type": types[path.extname(target)] || "application/octet-stream" })
    res.end(req.method === "HEAD" ? undefined : body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(Number(process.env.PORT) || 3000, "0.0.0.0")
