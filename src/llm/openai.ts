/**
 * OpenAI-compatible LLM adapter.
 * Implements LlmPort over the /chat/completions API, so it works with OpenAI,
 * Azure OpenAI-compatible endpoints, Groq, Mistral and most local servers.
 * The API key never leaves this backend process.
 */

import type { LlmMensaje, LlmPort, LlmRespuesta, LlmToolCall, LlmToolDef } from "./adapter.ts"

type OpenAiToolCall = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
  // Google (Gemini 3.x) entrega la firma pensada dentro de `extra_content` y
  // exige reenviarla al reconstruir el historial; sin ella responde 400.
  // Otros proveedores no envían este campo.
  extra_content?: { thought_signature?: string }
  thought_signature?: string
}

type OpenAiMensaje =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant"
      content: string | null
      tool_calls?: OpenAiToolCall[]
      thought_signature?: string
    }
  | { role: "tool"; tool_call_id: string; content: string }

type OpenAiRespuesta = {
  choices: Array<{
    message: {
      content: string | null
      tool_calls?: OpenAiToolCall[]
    }
  }>
}

export class OpenAiCompatibleLlm implements LlmPort {
  readonly proveedor = "openai-compatible"
  readonly modelo: string
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(config: { apiKey: string; baseUrl: string; model: string }) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl.replace(/\/$/, "")
    this.modelo = config.model
  }

  async enviar(mensajes: LlmMensaje[], herramientas: LlmToolDef[]): Promise<LlmRespuesta> {
    const cuerpo = {
      model: this.modelo,
      messages: mensajes.map(aOpenAi),
      tools: herramientas.map((h) => ({
        type: "function" as const,
        function: {
          name: h.nombre,
          description: h.descripcion,
          parameters: h.argsSchema,
        },
      })),
      tool_choice: herramientas.length > 0 ? ("auto" as const) : undefined,
      temperature: 0.1,
    }

    let respuesta: Response
    try {
      respuesta = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(60_000),
      })
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e)
      throw new Error(`No se pudo contactar al proveedor LLM (${motivo}). Revise la conexión o la configuración.`)
    }

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => "")
      throw new Error(
        `El proveedor LLM respondió ${respuesta.status}. ${detalle.slice(0, 300)}`.trim(),
      )
    }

    const json = (await respuesta.json()) as OpenAiRespuesta
    const mensaje = json.choices?.[0]?.message
    if (!mensaje) throw new Error("Respuesta vacía del proveedor LLM.")

    return {
      contenido: mensaje.content ?? null,
      toolCalls: (mensaje.tool_calls ?? []).map((tc): LlmToolCall => ({
        id: tc.id,
        nombre: tc.function.name,
        args: parseArgs(tc.function.arguments),
        firma: tc.extra_content?.thought_signature ?? tc.thought_signature ?? mensaje.thought_signature,
      })),
    }
  }
}

function aOpenAi(mensaje: LlmMensaje): OpenAiMensaje {
  if (mensaje.rol === "tool") {
    return { role: "tool", tool_call_id: mensaje.toolCallId, content: mensaje.contenido }
  }
  if (mensaje.rol === "assistant") {
    // Solo se reenvía la firma si el proveedor la devolvió (Gemini 3.x). Como
    // JSON.stringify omite `undefined`, los demás proveedores no la ven.
    const firma = mensaje.toolCalls?.[0]?.firma
    return {
      role: "assistant",
      content: mensaje.contenido,
      tool_calls: mensaje.toolCalls?.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.nombre, arguments: JSON.stringify(tc.args) },
        ...(tc.firma ? { extra_content: { thought_signature: tc.firma } } : {}),
      })),
      ...(firma ? { thought_signature: firma } : {}),
    }
  }
  return { role: mensaje.rol, content: mensaje.contenido }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
