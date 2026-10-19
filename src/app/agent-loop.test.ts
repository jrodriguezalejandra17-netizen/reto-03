/**
 * Tests for the agent loop: iteration cap, tool execution and confirmation state.
 * Uses a fake LlmPort so the loop can be verified without any provider or API key.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { Agente, MAX_ITERACIONES } from "./agent-loop.ts"
import type { LlmMensaje, LlmPort, LlmRespuesta, LlmToolDef } from "../ports/index.ts"

const directory = join(import.meta.dirname, "..", "..")

class LlmGuionizado implements LlmPort {
  readonly proveedor = "fake"
  readonly modelo = "fake-1"
  private readonly guion: LlmRespuesta[]
  public llamadas: LlmMensaje[][] = []
  public herramientasVistas: LlmToolDef[][] = []

  constructor(guion: LlmRespuesta[]) {
    this.guion = [...guion]
  }

  async enviar(mensajes: LlmMensaje[], herramientas: LlmToolDef[]): Promise<LlmRespuesta> {
    this.llamadas.push(mensajes)
    this.herramientasVistas.push(herramientas)
    return this.guion.shift() ?? { contenido: "(guion agotado)", toolCalls: [] }
  }
}

function llamada(nombre: string, args: Record<string, unknown>, id = "call-1") {
  return { id, nombre, args }
}

describe("ciclo del agente", () => {
  it("expone las herramientas oc_* al modelo", async () => {
    const llm = new LlmGuionizado([{ contenido: "hola", toolCalls: [] }])
    const agente = new Agente(llm, directory)
    await agente.turno({ id: "s1", mensajes: [] }, "hola")
    const nombres = llm.herramientasVistas[0]?.map((h) => h.nombre) ?? []
    assert.deepEqual(nombres, ["oc_leer_paquete", "oc_validar", "oc_generar_evidencia", "oc_construir_payload", "oc_crear"])
    assert.ok((llm.herramientasVistas[0]?.[0]?.argsSchema["properties"] as Record<string, unknown>) !== undefined)
  })

  it("ejecuta la herramienta pedida y devuelve su resultado al modelo", async () => {
    const llm = new LlmGuionizado([
      { contenido: null, toolCalls: [llamada("oc_leer_paquete", { caso: "sol-001" })] },
      { contenido: "El caso confirmó una cotización limpia.", toolCalls: [] },
    ])
    const agente = new Agente(llm, directory)
    const sesion = { id: "s2", mensajes: [] as LlmMensaje[] }
    const r = await agente.turno(sesion, "procesa sol-001")

    assert.equal(r.toolCalls.length, 1)
    assert.equal(r.toolCalls[0]?.nombre, "oc_leer_paquete")
    assert.equal(r.toolCalls[0]?.ok, true)
    assert.equal(r.needsConfirmation, false)
    assert.match(r.reply, /cotización limpia/)
    const mensajeTool = sesion.mensajes.find((m) => m.rol === "tool")
    assert.ok(mensajeTool && mensajeTool.rol === "tool" && mensajeTool.contenido.includes('"ok":true'))
  })

  it("marca needsConfirmation cuando una validación deja confirmaciones pendientes", async () => {
    const llm = new LlmGuionizado([
      { contenido: null, toolCalls: [llamada("oc_validar", { caso: "sol-004" })] },
      { contenido: "La cotización difiere del 2%. ¿Confirmas?", toolCalls: [] },
    ])
    const agente = new Agente(llm, directory)
    const r = await agente.turno({ id: "s3", mensajes: [] }, "valida sol-004")
    assert.equal(r.needsConfirmation, true)
  })

  it("rechaza argumentos inválidos sin lanzar y se lo informa al modelo", async () => {
    const llm = new LlmGuionizado([
      { contenido: null, toolCalls: [llamada("oc_leer_paquete", { caso: 123 })] },
      { contenido: "No pude leer el caso.", toolCalls: [] },
    ])
    const agente = new Agente(llm, directory)
    const r = await agente.turno({ id: "s4", mensajes: [] }, "caso raro")
    assert.equal(r.toolCalls[0]?.ok, false)
    assert.match(r.toolCalls[0]?.resultado ?? "", /Argumentos inválidos/)
  })

  it("ignora herramientas desconocidas y no rompe la sesión", async () => {
    const llm = new LlmGuionizado([
      { contenido: null, toolCalls: [llamada("oc_borrar_todo", {})] },
      { contenido: "Esa acción no existe.", toolCalls: [] },
    ])
    const agente = new Agente(llm, directory)
    const r = await agente.turno({ id: "s5", mensajes: [] }, "borra todo")
    assert.match(r.toolCalls[0]?.resultado ?? "", /Herramienta desconocida/)
    assert.equal(r.reply, "Esa acción no existe.")
  })

  it("corta al llegar al tope de iteraciones y responde con lo que tiene", async () => {
    const llm = new LlmGuionizado(
      Array.from({ length: MAX_ITERACIONES + 5 }, (_, i) => ({
        contenido: null,
        toolCalls: [llamada("oc_leer_paquete", { caso: "sol-001" }, `call-${i}`)],
      })),
    )
    const agente = new Agente(llm, directory)
    const r = await agente.turno({ id: "s6", mensajes: [] }, "loop infinito")
    assert.equal(r.toolCalls.length, MAX_ITERACIONES)
    assert.match(r.reply, /tope de 25 iteraciones/)
  })

  it("un fallo del proveedor no mata la sesión y se muestra en lenguaje claro", async () => {
    const llm: LlmPort = {
      proveedor: "roto",
      modelo: "roto",
      async enviar(): Promise<LlmRespuesta> {
        throw new Error("timeout del proveedor")
      },
    }
    const agente = new Agente(llm, directory)
    const sesion = { id: "s7", mensajes: [] as LlmMensaje[] }
    const r = await agente.turno(sesion, "hola")
    assert.match(r.reply, /timeout del proveedor/)
    assert.equal(sesion.mensajes.some((m) => m.rol === "user"), true)
  })
})
