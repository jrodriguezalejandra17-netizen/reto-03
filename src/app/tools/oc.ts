/**
 * Use cases exposed to the model as tools (PRD section 6.2).
 * Each export becomes `<archivo>_<export>`, i.e. oc_leer_paquete, oc_validar...
 *
 * Hexagonal note: these are application services. They orchestrate the pure
 * domain (controls/payload) and talk to the outside only through ports.
 */

import { z } from "zod"
import { evaluar } from "../../domain/controls.ts"
import { construirPayload, ordenCompraSchema } from "../../domain/payload.ts"
import type { Evaluacion, IntentoControl, OrdenCompra, Paquete } from "../../domain/types.ts"
import { FixtureSource } from "../../adapters/fixture-source.ts"
import { OutStore, trazabilidadDe } from "../../adapters/out-store.ts"
import { SapMock } from "../../adapters/sap-mock.ts"
import type { Evidencia, Trazabilidad } from "../../ports/index.ts"

export type Contexto = { directory: string; sessionId: string }

export type Herramienta = {
  description: string
  args: z.ZodTypeAny
  execute(args: Record<string, unknown>, ctx: Contexto): Promise<string>
}

// --- helpers ---------------------------------------------------------------

function ok(data: unknown): string {
  return JSON.stringify({ ok: true, data })
}

function fallo(error: string): string {
  return JSON.stringify({ ok: false, error })
}

function mensajeDeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

type Servicios = {
  fixtures: FixtureSource
  out: OutStore
  sap: SapMock
}

const serviciosPorDirectorio = new Map<string, Servicios>()

function servicios(directory: string): Servicios {
  const existente = serviciosPorDirectorio.get(directory)
  if (existente) return existente
  const fixtures = new FixtureSource(directory)
  const maestros = fixtures.leerMaestros()
  const creado: Servicios = {
    fixtures,
    out: new OutStore(directory),
    sap: new SapMock(directory, maestros),
  }
  serviciosPorDirectorio.set(directory, creado)
  return creado
}

const casoArg = z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (ej. sol-001)")

function paqueteDe(args: Record<string, unknown>, s: Servicios): Paquete {
  const caso = String(args["caso"] ?? "")
  if (!caso) throw new Error("Falta el argumento obligatorio 'caso'.")
  // The fixture is the single source of truth. The optional `paquete` argument is
  // accepted by contract but never trusted over the read-only fixture (CA2).
  return s.fixtures.leerPaquete(caso)
}

function registrarIntento(
  s: Servicios,
  paquete: Paquete,
  evaluacion: Evaluacion,
  resultado: IntentoControl["resultado"],
  numeroOc: string,
): void {
  s.out.registrar({
    solicitud_id: paquete.solicitud.solicitud_id,
    resultado,
    numero_oc: numeroOc,
    retroactiva: evaluacion.retroactiva,
    bloqueos: evaluacion.bloqueos.map((b) => b.codigo).join(";"),
    confirmaciones: evaluacion.confirmaciones.map((c) => c.codigo).join(";"),
  })
}

// --- tools ------------------------------------------------------------------

export const leer_paquete: Herramienta = {
  description:
    "Lee el correo, la solicitud, la cotización, la aprobación y la factura (si existe) de un caso y los devuelve normalizados.",
  args: z.object({
    caso: casoArg,
  }),
  async execute(args, ctx) {
    try {
      const s = servicios(ctx.directory)
      const p = paqueteDe(args, s)
      return ok(p)
    } catch (e) {
      return fallo(`No se pudo leer el paquete: ${mensajeDeError(e)}`)
    }
  },
}

export const validar: Herramienta = {
  description:
    "Aplica las reglas de control RC1-RC10 a un caso y devuelve si está apta, los bloqueos, las confirmaciones requeridas, los valores derivados y si es retroactiva.",
  args: z.object({
    caso: casoArg,
    paquete: z.record(z.unknown()).optional().describe("Paquete normalizado; si se omite se relee del fixture del caso"),
  }),
  async execute(args, ctx) {
    try {
      const s = servicios(ctx.directory)
      const paquete = paqueteDe(args, s)
      const evaluacion = evaluar(paquete, s.fixtures.leerMaestros())
      const resultado: IntentoControl["resultado"] = !evaluacion.apta
        ? "bloqueada"
        : evaluacion.confirmaciones.length > 0
          ? "pendiente_confirmacion"
          : "validada"
      registrarIntento(s, paquete, evaluacion, resultado, "")
      return ok({ ...evaluacion, solicitud_id: paquete.solicitud.solicitud_id })
    } catch (e) {
      return fallo(`No se pudo validar el caso: ${mensajeDeError(e)}`)
    }
  },
}

export const generar_evidencia: Herramienta = {
  description:
    "Genera el archivo de evidencia de aprobación (out/<caso>/aprobacion.txt) con sus encabezados y el sha256 del contenido.",
  args: z.object({
    caso: casoArg,
  }),
  async execute(args, ctx) {
    try {
      const s = servicios(ctx.directory)
      const paquete = paqueteDe(args, s)
      const evidencia = s.out.generar(String(args["caso"]), paquete)
      return ok(evidencia)
    } catch (e) {
      return fallo(`No se pudo generar la evidencia: ${mensajeDeError(e)}`)
    }
  },
}

export const construir_payload: Herramienta = {
  description:
    "Construye y valida el payload de la orden de compra según el esquema SAP, guarda payload.json y trazabilidad.json, y devuelve la orden lista para crear.",
  args: z.object({
    caso: casoArg,
    paquete: z.record(z.unknown()).optional().describe("Paquete normalizado; si se omite se relee del fixture del caso"),
    derivados: z.record(z.string()).optional().describe("Valores derivados de maestros; se recalculan si se omiten"),
  }),
  async execute(args, ctx) {
    try {
      const s = servicios(ctx.directory)
      const caso = String(args["caso"])
      const paquete = paqueteDe(args, s)
      const maestros = s.fixtures.leerMaestros()
      const evaluacion = evaluar(paquete, maestros)
      if (evaluacion.bloqueos.length > 0) {
        return fallo(`El caso tiene bloqueos que impiden construir el payload: ${evaluacion.bloqueos.map((b) => `${b.codigo} ${b.detalle}`).join(" | ")}`)
      }
      const evidencia: Evidencia = s.out.obtener(caso) ?? s.out.generar(caso, paquete)
      const construido = construirPayload(paquete, evaluacion, maestros, evidencia.sha256, false)
      if (!construido.ok) return fallo(construido.error)

      const rutaPayload = s.out.guardarPayload(caso, construido.payload)
      const trazabilidad: Trazabilidad = trazabilidadDe(paquete, construido.payload)
      const rutaTrazabilidad = s.out.guardarTrazabilidad(caso, trazabilidad)
      return ok({
        payload: construido.payload,
        ruta_payload: rutaPayload,
        ruta_trazabilidad: rutaTrazabilidad,
        confirmaciones: evaluacion.confirmaciones,
        retroactiva: evaluacion.retroactiva,
      })
    } catch (e) {
      return fallo(`No se pudo construir el payload: ${mensajeDeError(e)}`)
    }
  },
}

export const crear: Herramienta = {
  description:
    "Crea la orden de compra en el SAP simulado. Requiere que el caso esté apto y confirmado=true si existen confirmaciones pendientes. Es idempotente por solicitud_id.",
  args: z.object({
    caso: casoArg,
    payload: z.record(z.unknown()).optional().describe("Payload validado; si se omite se usa out/<caso>/payload.json"),
    confirmado: z.boolean().optional().describe("true solo si la analista confirmó explícitamente las excepciones"),
  }),
  async execute(args, ctx) {
    try {
      const s = servicios(ctx.directory)
      const caso = String(args["caso"])
      const paquete = paqueteDe(args, s)
      const maestros = s.fixtures.leerMaestros()
      const evaluacion = evaluar(paquete, maestros)

      if (!evaluacion.apta) {
        registrarIntento(s, paquete, evaluacion, "bloqueada", "")
        return fallo(`La OC no puede crearse. Bloqueos: ${evaluacion.bloqueos.map((b) => `${b.codigo} ${b.detalle}`).join(" | ")}`)
      }
      const confirmado = args["confirmado"] === true
      if (evaluacion.confirmaciones.length > 0 && !confirmado) {
        registrarIntento(s, paquete, evaluacion, "pendiente_confirmacion", "")
        return fallo(`Requiere confirmación humana antes de crear: ${evaluacion.confirmaciones.map((c) => `${c.codigo} ${c.detalle}`).join(" | ")}. Vuelva a llamar con confirmado=true.`)
      }

      let payload: OrdenCompra
      if (args["payload"]) {
        const parsed = ordenCompraSchema.safeParse(args["payload"])
        if (!parsed.success) {
          return fallo(`El payload recibido no cumple el esquema SAP: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)
        }
        payload = parsed.data
      } else {
        const guardado = s.out.leerPayload(caso)
        if (!guardado || (confirmado && evaluacion.confirmaciones.length > 0)) {
          // Rebuild when confirming so the exceptions record who accepted them.
          const evidencia = s.out.obtener(caso) ?? s.out.generar(caso, paquete)
          const construido = construirPayload(paquete, evaluacion, maestros, evidencia.sha256, confirmado)
          if (!construido.ok) return fallo(construido.error)
          payload = construido.payload
          s.out.guardarPayload(caso, payload)
        } else {
          payload = guardado
        }
      }

      const previa = await s.sap.buscarOrdenPorReferencia(payload.referencia.solicitud_id)
      const resultado = await s.sap.crearOrden(payload)
      registrarIntento(s, paquete, evaluacion, previa ? "idempotente" : "creada", resultado.numero_oc)
      return ok({
        numero_oc: resultado.numero_oc,
        fecha: resultado.fecha,
        idempotente: Boolean(previa),
      })
    } catch (e) {
      try {
        const s = servicios(ctx.directory)
        const paquete = paqueteDe(args, s)
        const evaluacion = evaluar(paquete, s.fixtures.leerMaestros())
        registrarIntento(s, paquete, evaluacion, "error", "")
      } catch {
        // logging is best-effort; the tool never throws
      }
      return fallo(`No se pudo crear la orden: ${mensajeDeError(e)}`)
    }
  },
}
