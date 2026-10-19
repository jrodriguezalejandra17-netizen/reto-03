/**
 * FixtureSource â€” reads the read-only fixtures under fixtures/reto-03/.
 * Files are Windows-1252 encoded (accents); they are decoded as utf8 and
 * exposed to the rest of the app as proper unicode strings.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { Maestros, Paquete } from "../domain/types.ts"
import type { PaqueteSource } from "../ports/index.ts"
import { parseCotizacion, parseFactura } from "../domain/cotizacion.ts"

type CorreoJson = { id: string; de: string; asunto: string; fecha: string }
type SolicitudJson = Record<string, unknown>
type AprobacionJson = { de: string; fecha: string; cuerpo: string }

export class FixtureSource implements PaqueteSource {
  private readonly root: string

  constructor(directory: string) {
    this.root = join(directory, "fixtures", "reto-03")
  }

  listarCasos(): string[] {
    const dir = join(this.root, "solicitudes")
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  }

  leerPaquete(caso: string): Paquete {
    const base = join(this.root, "solicitudes", caso)
    const correo = leerJson<CorreoJson>(join(base, "correo.json"))
    const solicitud = leerJson<SolicitudJson>(join(base, "solicitud.json"))
    const aprobacion = existe(base, "aprobacion.json") ? leerJson<AprobacionJson>(join(base, "aprobacion.json")) : null
    const cotizacionTexto = existe(base, "cotizacion.txt") ? readFileSync(join(base, "cotizacion.txt"), "utf8") : null
    const facturaTexto = existe(base, "factura.txt") ? readFileSync(join(base, "factura.txt"), "utf8") : null

    return {
      correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
      solicitud: normalizarSolicitud(solicitud),
      cotizacion: cotizacionTexto ? parseCotizacion(cotizacionTexto) : null,
      aprobacion: aprobacion
        ? {
            de: aprobacion.de,
            fecha: aprobacion.fecha,
            aprobado: /aprobado/i.test(aprobacion.cuerpo),
            texto: aprobacion.cuerpo,
          }
        : null,
      factura: facturaTexto ? parseFactura(facturaTexto) : null,
    }
  }

  leerMaestros(): Maestros {
    return {
      proveedores: leerJson(join(this.root, "maestros", "proveedores.json")),
      centrosCosto: leerJson(join(this.root, "maestros", "centros-costo.json")),
      indicadoresIva: leerJson(join(this.root, "maestros", "indicadores-iva.json")),
      condicionesPago: leerJson(join(this.root, "maestros", "condiciones-pago.json")),
    }
  }
}

function existe(dir: string, archivo: string): boolean {
  return existsSync(join(dir, archivo))
}

function leerJson<T = Record<string, unknown>>(ruta: string): T {
  return JSON.parse(readFileSync(ruta, "utf8")) as T
}

function normalizarSolicitud(raw: SolicitudJson): Paquete["solicitud"] {
  return {
    solicitud_id: String(raw["solicitud_id"] ?? ""),
    solicitante: String(raw["solicitante"] ?? ""),
    proveedor_nombre: String(raw["proveedor_nombre"] ?? ""),
    proveedor_nit: raw["proveedor_nit"] == null ? null : String(raw["proveedor_nit"]),
    descripcion: String(raw["descripcion"] ?? ""),
    centro_costo: String(raw["centro_costo"] ?? ""),
    subarea: String(raw["subarea"] ?? ""),
    cantidad: Number(raw["cantidad"] ?? 0),
    valor_unitario: Number(raw["valor_unitario"] ?? 0),
    valor_total: Number(raw["valor_total"] ?? 0),
    moneda: String(raw["moneda"] ?? "COP"),
    indicador_iva: raw["indicador_iva"] == null ? null : String(raw["indicador_iva"]),
    condiciones_pago: raw["condiciones_pago"] == null ? null : String(raw["condiciones_pago"]),
    fecha_solicitud: String(raw["fecha_solicitud"] ?? ""),
  }
}

