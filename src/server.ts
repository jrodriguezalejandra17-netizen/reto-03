/**
 * HTTP entry point (inbound adapter).
 * Node built-in server: chat API + static chat front. No framework needed.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import { extname, join, normalize } from "node:path"
import { Agente } from "./app/agent-loop.ts"
import { SessionStore } from "./app/sessions.ts"
import { OpenAiCompatibleLlm } from "./llm/openai.ts"

const directory = import.meta.dirname.replace(/[\\/]src$/, "")
cargarEnv(join(directory, ".env"))

const PORT = Number(process.env["PORT"] ?? 3000)
const MODELO = process.env["LLM_MODEL"] ?? "gpt-4o-mini"
const BASE_URL = process.env["LLM_BASE_URL"] ?? "https://api.openai.com/v1"
const API_KEY = process.env["LLM_API_KEY"] ?? ""

const sesiones = new SessionStore(directory)
const agente = API_KEY
  ? new Agente(new OpenAiCompatibleLlm({ apiKey: API_KEY, baseUrl: BASE_URL, model: MODELO }), directory)
  : null

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`)

    if (url.pathname === "/api/health" && req.method === "GET") {
      return json(res, 200, {
        ok: true,
        provider: "openai-compatible",
        model: MODELO,
        llm_configured: Boolean(API_KEY),
      })
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      const cuerpo = (await leerJson(req)) as { sessionId?: unknown; message?: unknown }
      const sessionId = String(cuerpo.sessionId ?? "").trim()
      const message = String(cuerpo.message ?? "").trim()

      if (!sessionId) return json(res, 400, { ok: false, error: "Falta sessionId." })
      if (!message) return json(res, 400, { ok: false, error: "El mensaje está vacío." })
      if (!agente) {
        return json(res, 503, {
          ok: false,
          error:
            "El proveedor LLM no está configurado. Defina LLM_API_KEY en el archivo .env y reinicie el servidor. La demo sin modelo sigue disponible con `npm run demo`.",
        })
      }

      const sesion = sesiones.obtenerOCrear(sessionId)
      const resultado = await agente.turno(sesion, message)
      sesiones.guardar(sesion)
      return json(res, 200, {
        ok: true,
        reply: resultado.reply,
        toolCalls: resultado.toolCalls,
        needsConfirmation: resultado.needsConfirmation,
      })
    }

    const matchSesion = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (matchSesion && req.method === "GET") {
      const sesion = sesiones.obtenerOCrear(decodeURIComponent(matchSesion[1] ?? ""))
      return json(res, 200, { ok: true, session: sesion })
    }

    if (req.method === "GET") return estatico(url.pathname, res)

    return json(res, 404, { ok: false, error: "Ruta no encontrada." })
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    return json(res, 500, { ok: false, error: `Error interno: ${motivo}` })
  }
})

server.listen(PORT, () => {
  console.log(`Agente OC SAP escuchando en http://localhost:${PORT}`)
  console.log(`Modelo: ${MODELO} · LLM configurado: ${API_KEY ? "sí" : "NO (defina LLM_API_KEY en .env)"}`)
})

// --- helpers ---------------------------------------------------------------

function cargarEnv(ruta: string): void {
  try {
    if (existsSync(ruta)) process.loadEnvFile(ruta)
  } catch {
    // env vars can also come from the shell
  }
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const cuerpo = JSON.stringify(data)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  })
  res.end(cuerpo)
}

function estatico(pathname: string, res: ServerResponse): void {
  const relativo = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
  const ruta = normalize(join(directory, "web", relativo))
  const raizWeb = normalize(join(directory, "web"))
  if (!ruta.startsWith(raizWeb) || !existsSync(ruta)) {
    json(res, 404, { ok: false, error: "Archivo no encontrado." })
    return
  }
  const contenido = readFileSync(ruta)
  res.writeHead(200, { "Content-Type": MIME[extname(ruta)] ?? "application/octet-stream" })
  res.end(contenido)
}

function leerJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let datos = ""
    req.on("data", (chunk: Buffer) => {
      datos += chunk.toString("utf8")
      if (datos.length > 1_000_000) {
        reject(new Error("Cuerpo de la petición demasiado grande."))
        req.destroy()
      }
    })
    req.on("end", () => {
      try {
        resolve(datos ? JSON.parse(datos) : {})
      } catch {
        reject(new Error("JSON inválido en el cuerpo de la petición."))
      }
    })
    req.on("error", reject)
  })
}
