/**
 * Agent loop — the application service that drives prompt -> model -> tools -> answer.
 * Provider-agnostic: it only depends on the LlmPort and the tool registry.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { LlmMensaje, LlmPort, LlmRespuesta } from "../llm/adapter.ts"
import { definicionesParaModelo, herramientas, registrarLog, validarArgs } from "../tools/index.ts"

export const MAX_ITERACIONES = 25

export type ToolCallVisible = {
  nombre: string
  argumentos: Record<string, unknown>
  resultado: string
  ok: boolean
}

export type ResultadoTurno = {
  reply: string
  toolCalls: ToolCallVisible[]
  needsConfirmation: boolean
}

export type Sesion = {
  id: string
  mensajes: LlmMensaje[]
  creada: string
}

export class Agente {
  private readonly llm: LlmPort
  private readonly directory: string
  private readonly systemPrompt: string

  constructor(llm: LlmPort, directory: string) {
    this.llm = llm
    this.directory = directory
    this.systemPrompt = cargarSystemPrompt(directory)
  }

  async turno(sesion: Sesion, mensajeUsuario: string): Promise<ResultadoTurno> {
    sesion.mensajes.push({ rol: "user", contenido: mensajeUsuario })

    const visibles: ToolCallVisible[] = []
    let pendienteConfirmacion = false

    for (let iteracion = 0; iteracion < MAX_ITERACIONES; iteracion++) {
      let respuesta: LlmRespuesta
      try {
        respuesta = await this.llm.enviar([this.mensajeSistema(), ...sesion.mensajes], definicionesParaModelo())
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e)
        return {
          reply: `No pude consultar el modelo: ${motivo}. La sesión sigue activa; puede reintentar o usar la demo sin modelo.`,
          toolCalls: visibles,
          needsConfirmation: pendienteConfirmacion,
        }
      }

      if (respuesta.toolCalls.length === 0) {
        const texto = respuesta.contenido?.trim() || "Listo."
        sesion.mensajes.push({ rol: "assistant", contenido: texto })
        return { reply: texto, toolCalls: visibles, needsConfirmation: pendienteConfirmacion }
      }

      sesion.mensajes.push({ rol: "assistant", contenido: respuesta.contenido, toolCalls: respuesta.toolCalls })

      for (const llamada of respuesta.toolCalls) {
        const herramienta = herramientas[llamada.nombre]
        let resultado: string
        let ok = false
        let confirmacionesPendientes = false

        if (!herramienta) {
          resultado = JSON.stringify({ ok: false, error: `Herramienta desconocida: ${llamada.nombre}` })
        } else {
          const validados = validarArgs(herramienta, llamada.args)
          resultado = validados.ok
            ? await herramienta.execute(validados.args, {
                directory: this.directory,
                sessionId: sesion.id,
              })
            : JSON.stringify({ ok: false, error: validados.error })
          ok = leerOk(resultado)
          confirmacionesPendientes = hayConfirmacionesPendientes(llamada.nombre, resultado)
        }

        registrarLog(this.directory, llamada.nombre, String(llamada.args["caso"] ?? "-"), resultado)
        visibles.push({ nombre: llamada.nombre, argumentos: llamada.args, resultado, ok })

        if (confirmacionesPendientes) pendienteConfirmacion = true
        if (llamada.nombre === "oc_crear" && ok) pendienteConfirmacion = false

        sesion.mensajes.push({
          rol: "tool",
          toolCallId: llamada.id,
          nombre: llamada.nombre,
          contenido: resultado,
        })
      }
    }

    const texto = `Alcancé el tope de ${MAX_ITERACIONES} iteraciones por turno. Esto es lo que quedó hecho; indíqueme cómo continuar.`
    sesion.mensajes.push({ rol: "assistant", contenido: texto })
    return { reply: texto, toolCalls: visibles, needsConfirmation: pendienteConfirmacion }
  }

  private mensajeSistema(): LlmMensaje {
    return { rol: "system", contenido: this.systemPrompt }
  }
}

function cargarSystemPrompt(directory: string): string {
  const prompt = readFileSync(join(directory, "agent", "prompt.md"), "utf8")
  const conocimiento = readFileSync(join(directory, "src", "knowledge", "ordenes-compra.md"), "utf8")
  return `${prompt}\n\n---\n\n# Conocimiento del proceso\n\n${conocimiento}`
}

function leerOk(resultado: string): boolean {
  try {
    return (JSON.parse(resultado) as { ok?: boolean }).ok === true
  } catch {
    return false
  }
}

function hayConfirmacionesPendientes(nombre: string, resultado: string): boolean {
  if (nombre !== "oc_validar") return false
  try {
    const parsed = JSON.parse(resultado) as {
      ok?: boolean
      data?: { confirmaciones?: unknown[] }
    }
    return parsed.ok === true && (parsed.data?.confirmaciones?.length ?? 0) > 0
  } catch {
    return false
  }
}
