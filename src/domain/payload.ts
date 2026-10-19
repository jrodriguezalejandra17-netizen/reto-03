/**
 * Payload builder — builds and validates the OrdenCompra (PRD section 7.4).
 * Pure: receives a Paquete, the evaluation and the evidence hash; returns a typed payload.
 */

import { z } from "zod"
import type { Evaluacion, Maestros, OrdenCompra, Paquete } from "./types.ts"

const SAP_LIMITE_DESCRIPCION = 40

export const ordenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string(),
  }),
  posiciones: z
    .array(
      z.object({
        numero: z.number(),
        descripcion: z.string().max(SAP_LIMITE_DESCRIPCION),
        cantidad: z.number(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  excepciones: z.array(
    z.object({
      codigo: z.string(),
      detalle: z.string(),
      confirmado_por: z.string().nullable(),
    }),
  ),
})

/** Infers the SAP unit from the request description. */
export function inferirUnidad(descripcion: string): "UN" | "H" | "MES" {
  if (/hora/i.test(descripcion)) return "H"
  if (/mes/i.test(descripcion)) return "MES"
  return "UN"
}

export function truncarDescripcion(texto: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim()
  return limpio.length <= SAP_LIMITE_DESCRIPCION ? limpio : `${limpio.slice(0, SAP_LIMITE_DESCRIPCION - 1)}…`
}

export function construirPayload(
  paquete: Paquete,
  evaluacion: Evaluacion,
  maestros: Maestros,
  evidenciaSha256: string,
  confirmacionesAceptadas: boolean,
): { ok: true; payload: OrdenCompra } | { ok: false; error: string } {
  const { solicitud } = paquete
  const proveedor = maestros.proveedores.find(
    (p) => p.nit === (solicitud.proveedor_nit ?? paquete.cotizacion?.nit ?? ""),
  )
  if (!proveedor) {
    return { ok: false, error: `Proveedor con NIT ${solicitud.proveedor_nit ?? "desconocido"} no existe en el maestro; no se puede construir el payload.` }
  }
  const aprobacion = paquete.aprobacion
  if (!aprobacion) {
    return { ok: false, error: "No hay correo de aprobación; el payload requiere aprobador y evidencia." }
  }

  const indicadorIva = solicitud.indicador_iva ?? evaluacion.derivados["indicador_iva"] ?? proveedor.indicador_iva_default
  const condicionesPago = solicitud.condiciones_pago ?? evaluacion.derivados["condiciones_pago"] ?? proveedor.condiciones_pago_default

  const payload: OrdenCompra = {
    referencia: {
      solicitud_id: solicitud.solicitud_id,
      correo_id: paquete.correo.id,
      cotizacion_ref: paquete.cotizacion ? extraerRefCotizacion(paquete.cotizacion.texto) : null,
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: solicitud.moneda === "USD" ? "USD" : "COP",
    condiciones_pago: condicionesPago,
    aprobador: {
      email: aprobacion.de,
      fecha_aprobacion: aprobacion.fecha.slice(0, 10),
      evidencia_sha256: evidenciaSha256,
    },
    posiciones: [
      {
        numero: 10,
        descripcion: truncarDescripcion(solicitud.descripcion),
        cantidad: solicitud.cantidad,
        unidad: inferirUnidad(solicitud.descripcion),
        precio_unitario: solicitud.valor_unitario,
        centro_costo: solicitud.centro_costo,
        subarea: solicitud.subarea,
        indicador_iva: indicadorIva,
      },
    ],
    excepciones: [
      ...evaluacion.bloqueos.map((h) => ({ codigo: h.codigo, detalle: h.detalle, confirmado_por: null })),
      ...evaluacion.confirmaciones.map((h) => ({
        codigo: h.codigo,
        detalle: h.detalle,
        confirmado_por: confirmacionesAceptadas ? "analista" : null,
      })),
    ],
  }

  const parsed = ordenCompraSchema.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, error: `Payload inválido contra el esquema SAP: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }
  }
  return { ok: true, payload: parsed.data }
}

/** Pulls the quotation number ("COTIZACIÓN COT-TS-2026-0451" -> "COT-TS-2026-0451"). */
function extraerRefCotizacion(texto: string): string | null {
  return texto.match(/COTIZACI[ÓO]N\s+([A-Z0-9\-]+)/i)?.[1] ?? null
}
