/**
 * Ports — the hexagonal boundary of the application.
 * Domain depends on nothing; application depends on these interfaces;
 * adapters (fs, out/) implement them.
 *
 * The two contracts the PRD fixes by path live next to their implementations:
 *   SAP   → src/sap/adapter.ts   (SapAdapter, PRD 7.4)
 *   LLM   → src/llm/adapter.ts   (LlmPort, PRD 6.1)
 */

import type { IntentoControl, Maestros, OrdenCompra, Paquete } from "../domain/types.ts"

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

/** Tool contract exposed to the model (PRD section 6.2). */
export type ToolResult = { ok: boolean; data?: unknown; error?: string }

export type ToolContext = { directory: string; sessionId: string }

export type Tool = {
  description: string
  args: Record<string, { description: string }>
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
}
