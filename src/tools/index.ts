/**
 * Tool registry — exposes the application use cases to the LLM.
 * The model-facing name is `<file>_<export>` (PRD 6.2): oc_leer_paquete, oc_validar...
 */

import * as oc from "./oc.ts"
import { zodToJsonSchema } from "./schema.ts"
import type { LlmToolDef } from "../llm/adapter.ts"
import type { Herramienta } from "./oc.ts"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

/** Deterministic order: ES module exports are alphabetical, so we pin the workflow order. */
const ORDEN_FLUJO = [
  "oc_leer_paquete",
  "oc_validar",
  "oc_generar_evidencia",
  "oc_construir_payload",
  "oc_crear",
] as const

const disponibles: Record<string, Herramienta> = Object.fromEntries(
  Object.entries(oc)
    .filter(([, valor]) => typeof valor === "object" && valor !== null && "execute" in valor)
    .map(([nombre, herramienta]) => [`oc_${nombre}`, herramienta as Herramienta]),
)

export const herramientas: Record<string, Herramienta> = Object.fromEntries(
  ORDEN_FLUJO.filter((nombre) => nombre in disponibles).map((nombre) => [nombre, disponibles[nombre] as Herramienta]),
)

export function definicionesParaModelo(): LlmToolDef[] {
  return Object.entries(herramientas).map(([nombre, h]) => ({
    nombre,
    descripcion: h.description,
    argsSchema: zodToJsonSchema(h.args),
  }))
}

export function validarArgs(herramienta: Herramienta, args: Record<string, unknown>):
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string } {
  const parsed = (herramienta.args as { safeParse(v: unknown): { success: boolean; data?: unknown; error?: { issues: Array<{ path: Array<string | number>; message: string }> } } }).safeParse(args)
  if (!parsed.success) {
    const detalle = parsed.error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ?? "argumentos inválidos"
    return { ok: false, error: `Argumentos inválidos: ${detalle}` }
  }
  return { ok: true, args: parsed.data as Record<string, unknown> }
}

/** Appends one line to out/log.jsonl for every tool call (CA4). */
export function registrarLog(
  directory: string,
  herramienta: string,
  mensajeId: string,
  resultado: string,
): void {
  try {
    mkdirSync(join(directory, "out"), { recursive: true })
    const linea = JSON.stringify({
      ts: new Date().toISOString(),
      herramienta,
      mensaje_id: mensajeId,
      ok: (JSON.parse(resultado) as { ok?: boolean }).ok ?? false,
      resumen: resumenDe(resultado),
    })
    appendFileSync(join(directory, "out", "log.jsonl"), `${linea}\n`, "utf8")
  } catch {
    // logging must never break the flow
  }
}

function resumenDe(resultado: string): string {
  try {
    const parsed = JSON.parse(resultado) as { ok?: boolean; error?: string; data?: unknown }
    if (!parsed.ok) return String(parsed.error ?? "error").slice(0, 180)
    const texto = JSON.stringify(parsed.data)
    return texto.length > 180 ? `${texto.slice(0, 177)}...` : texto
  } catch {
    return resultado.slice(0, 180)
  }
}
