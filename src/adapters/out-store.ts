/**
 * OutStore — filesystem adapter for everything written under out/.
 * Implements evidence generation, payload persistence, traceability and the control log.
 */

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import type { IntentoControl, OrdenCompra, Paquete } from "../domain/types.ts"
import type {
  ArtefactosPort,
  ControlLogPort,
  Evidencia,
  EvidenciaPort,
  Trazabilidad,
  TrazabilidadValor,
} from "../ports/index.ts"

const CONTROL_HEADER = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n"

export class OutStore implements EvidenciaPort, ControlLogPort, ArtefactosPort {
  readonly outDir: string

  constructor(directory: string) {
    this.outDir = join(directory, "out")
  }

  /** Removes out/ so consecutive runs (demo) are deterministic. */
  limpiar(): void {
    rmSync(this.outDir, { recursive: true, force: true })
    mkdirSync(this.outDir, { recursive: true })
    writeFileSync(join(this.outDir, "control.csv"), CONTROL_HEADER, "utf8")
  }

  // --- EvidenciaPort -------------------------------------------------------

  generar(caso: string, paquete: Paquete): Evidencia {
    const aprobacion = paquete.aprobacion
    if (!aprobacion) throw new Error(`El caso ${caso} no tiene correo de aprobación.`)

    const contenido = [
      `De: ${aprobacion.de}`,
      `Para: ${paquete.correo.id}`,
      `Fecha: ${aprobacion.fecha}`,
      `Asunto: ${paquete.correo.asunto}`,
      "",
      aprobacion.texto,
    ].join("\n")

    const sha256 = createHash("sha256").update(contenido, "utf8").digest("hex")
    const dir = this.casoDir(caso)
    const rutaAbs = join(dir, "aprobacion.txt")
    writeFileSync(rutaAbs, `${contenido}\n\nsha256: ${sha256}\n`, "utf8")
    return { ruta: relativo(this.outDir, rutaAbs), sha256 }
  }

  obtener(caso: string): Evidencia | null {
    const rutaAbs = join(this.casoDir(caso), "aprobacion.txt")
    if (!existsSync(rutaAbs)) return null
    const contenido = readFileSync(rutaAbs, "utf8")
    const sha256 = contenido.match(/sha256:\s*([a-f0-9]{64})/)?.[1] ?? ""
    return { ruta: relativo(this.outDir, rutaAbs), sha256 }
  }

  // --- ArtefactosPort ------------------------------------------------------

  guardarPayload(caso: string, payload: OrdenCompra): string {
    const ruta = join(this.casoDir(caso), "payload.json")
    writeFileSync(ruta, JSON.stringify(payload, null, 2), "utf8")
    return relativo(this.outDir, ruta)
  }

  leerPayload(caso: string): OrdenCompra | null {
    const ruta = join(this.casoDir(caso), "payload.json")
    if (!existsSync(ruta)) return null
    return JSON.parse(readFileSync(ruta, "utf8")) as OrdenCompra
  }

  guardarTrazabilidad(caso: string, trazabilidad: Trazabilidad): string {
    const ruta = join(this.casoDir(caso), "trazabilidad.json")
    writeFileSync(ruta, JSON.stringify(trazabilidad, null, 2), "utf8")
    return relativo(this.outDir, ruta)
  }

  // --- ControlLogPort ------------------------------------------------------

  registrar(intento: IntentoControl): void {
    const fila = [
      intento.solicitud_id,
      intento.resultado,
      intento.numero_oc,
      String(intento.retroactiva),
      escaparCsv(intento.bloqueos),
      escaparCsv(intento.confirmaciones),
      new Date().toISOString(),
    ].join(",")
    appendFileSync(join(this.outDir, "control.csv"), `${fila}\n`, "utf8")
  }

  // --- helpers -------------------------------------------------------------

  private casoDir(caso: string): string {
    const dir = join(this.outDir, caso)
    mkdirSync(dir, { recursive: true })
    return dir
  }
}

export function trazabilidadDe(paquete: Paquete, payload: OrdenCompra): Trazabilidad {
  const campos: Record<string, TrazabilidadValor> = {
    "proveedor.codigo_sap": { valor: payload.proveedor.codigo_sap, fuente: "maestro.proveedores" },
    "proveedor.nit": { valor: payload.proveedor.nit, fuente: "solicitud" },
    "posiciones[0].descripcion": { valor: payload.posiciones[0]?.descripcion ?? "", fuente: "solicitud" },
    "posiciones[0].cantidad": { valor: payload.posiciones[0]?.cantidad ?? 0, fuente: "solicitud" },
    "posiciones[0].precio_unitario": { valor: payload.posiciones[0]?.precio_unitario ?? 0, fuente: "solicitud" },
    "posiciones[0].centro_costo": { valor: payload.posiciones[0]?.centro_costo ?? "", fuente: "solicitud" },
    "posiciones[0].subarea": { valor: payload.posiciones[0]?.subarea ?? "", fuente: "solicitud" },
    "posiciones[0].indicador_iva": {
      valor: payload.posiciones[0]?.indicador_iva ?? "",
      fuente: paquete.solicitud.indicador_iva ? "solicitud" : "derivado",
    },
    condiciones_pago: {
      valor: payload.condiciones_pago,
      fuente: paquete.solicitud.condiciones_pago ? "solicitud" : "derivado",
    },
    "aprobador.email": { valor: payload.aprobador.email, fuente: "cotizacion" },
    "aprobador.evidencia_sha256": { valor: payload.aprobador.evidencia_sha256, fuente: "derivado" },
    "posiciones[0].unidad": { valor: payload.posiciones[0]?.unidad ?? "UN", fuente: "derivado" },
    moneda: { valor: payload.moneda, fuente: "solicitud" },
  }
  return { caso: paquete.solicitud.solicitud_id, campos }
}

function relativo(base: string, ruta: string): string {
  return ruta.slice(base.length + 1).replaceAll("\\", "/")
}

function escaparCsv(texto: string): string {
  if (!texto) return ""
  return `"${texto.replaceAll('"', '""')}"`
}
