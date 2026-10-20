/**
 * LLM provider contract (PRD section 6.1 — "Una interfaz propia
 * (enviar(mensajes, herramientas) → respuesta)").
 *
 * Changing the provider must not touch the agent loop: src/app/agent-loop.ts
 * depends only on this interface. The current implementation is
 * openai.ts (any OpenAI-compatible endpoint: OpenAI, Gemini, Groq, Azure,
 * Mistral, local).
 */

export type LlmMensaje =
  | { rol: "system" | "user"; contenido: string }
  | {
      rol: "assistant"
      contenido: string | null
      toolCalls?: LlmToolCall[]
      // Mensaje original devuelto por el proveedor. Gemini 3.x exige reenviar
      // exactamente ese objeto (trae `extra_content.thought_signature`); si no,
      // responde 400. Se guarda tal cual para poder reproducirlo en el historial.
      crudo?: unknown
    }
  | { rol: "tool"; toolCallId: string; nombre: string; contenido: string }

export type LlmToolCall = {
  id: string
  nombre: string
  args: Record<string, unknown>
  // Firma del proveedor (Gemini 3.x) que hay que reenviar al reconstruir el
  // historial. undefined en el resto de los proveedores.
  firma?: string
}

export type LlmToolDef = {
  nombre: string
  descripcion: string
  argsSchema: Record<string, unknown> // JSON Schema generado desde zod
}

export type LlmRespuesta = {
  contenido: string | null
  toolCalls: LlmToolCall[]
  // Mensaje original del proveedor (verbatim). Ver comentario en LlmMensaje.
  crudo?: unknown
}

export interface LlmPort {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: LlmMensaje[], herramientas: LlmToolDef[]): Promise<LlmRespuesta>
}
