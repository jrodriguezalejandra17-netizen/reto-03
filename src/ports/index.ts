/**
 * Ports — the hexagonal boundary of the application.
 * Domain depends on nothing; application depends on these interfaces;
 * adapters (fs, sap mock, LLM) implement them.
 */

import type { Evaluacion, IntentoControl, Maestros, OrdenCompra, Paquete } from "../domain/types.ts"

/** Outbound port: simulated SAP system (PRD section 7.4 interface). */
export interface SapPort {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>
}

/** Outbound port: reads the read-only fixtures. */
export interface PaqueteSource {
  listarCasos(): string[]
  leerPaquete(caso: string): Paquete
  leerMaestros(): Maestros
}

export type Evidencia = { ruta: string; sha256: string }

/** Outbound port: approval evidence (txt with sha256). */
export interface EvidenciaPort {
  generar(caso: string, paquete: Paquete): Evidencia
  obtener(caso: string): Evidencia | null
}

/** Outbound port: audit/control log (out/control.csv). */
export interface ControlLogPort {
  registrar(intento: IntentoControl): void
}

/** Outbound port: artifacts produced under out/<caso>/. */
export interface ArtefactosPort {
  guardarPayload(caso: string, payload: OrdenCompra): string
  leerPayload(caso: string): OrdenCompra | null
  guardarTrazabilidad(caso: string, trazabilidad: Trazabilidad): string
}

export type TrazabilidadValor = { valor: string | number | boolean | null; fuente: string }

export type Trazabilidad = {
  caso: string
  campos: Record<string, TrazabilidadValor>
}

/** Outbound port: LLM provider (PRD section 6.1 adapter contract). */
export type LlmMensaje =
  | { rol: "system" | "user"; contenido: string }
  | { rol: "assistant"; contenido: string | null; toolCalls?: LlmToolCall[] }
  | { rol: "tool"; toolCallId: string; nombre: string; contenido: string }

export type LlmToolCall = { id: string; nombre: string; args: Record<string, unknown> }

export type LlmToolDef = {
  nombre: string
  descripcion: string
  argsSchema: Record<string, unknown> // JSON Schema generado desde zod
}

export type LlmRespuesta = {
  contenido: string | null
  toolCalls: LlmToolCall[]
}

export interface LlmPort {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: LlmMensaje[], herramientas: LlmToolDef[]): Promise<LlmRespuesta>
}

/** Tool contract exposed to the model (PRD section 6.2). */
export type ToolResult = { ok: boolean; data?: unknown; error?: string }

export type ToolContext = { directory: string; sessionId: string }

export type Tool = {
  description: string
  args: Record<string, { description: string }>
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
}
