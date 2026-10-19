/**
 * SapMock — simulated SAP adapter backed by out/sap/ordenes.jsonl.
 * Numbers are sequential from 4500000001 and creation is idempotent per solicitud_id.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import type { OrdenCompra } from "../domain/types.ts"
import type { SapPort } from "../ports/index.ts"
import type { Maestros } from "../domain/types.ts"

const PRIMER_NUMERO = 4500000001

type OrdenPersistida = { numero_oc: string; fecha: string; orden: OrdenCompra }

export class SapMock implements SapPort {
  private readonly dir: string
  private readonly sapDir: string
  private readonly archivo: string
  private readonly maestros: Maestros

  constructor(directory: string, maestros: Maestros) {
    this.dir = directory
    this.sapDir = join(directory, "out", "sap")
    this.archivo = join(this.sapDir, "ordenes.jsonl")
    this.maestros = maestros
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const p = this.maestros.proveedores.find((x) => x.nit === nit)
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const existente = await this.buscarOrdenPorReferencia(orden.referencia.solicitud_id)
    if (existente) {
      const previa = this.leerOrdenes().find((o) => o.numero_oc === existente.numero_oc)
      return { numero_oc: existente.numero_oc, fecha: previa?.fecha ?? new Date().toISOString() }
    }

    this.asegurarDir()
    const ordenes = this.leerOrdenes()
    const numero_oc = String(PRIMER_NUMERO + ordenes.length)
    const fecha = new Date().toISOString()
    appendFileSync(this.archivo, `${JSON.stringify({ numero_oc, fecha, orden } satisfies OrdenPersistida)}\n`, "utf8")
    return { numero_oc, fecha }
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null> {
    const encontrada = this.leerOrdenes().find((o) => o.orden.referencia.solicitud_id === solicitud_id)
    return encontrada ? { numero_oc: encontrada.numero_oc } : null
  }

  private leerOrdenes(): OrdenPersistida[] {
    if (!existsSync(this.archivo)) return []
    return readFileSync(this.archivo, "utf8")
      .split("\n")
      .filter((linea) => linea.trim().length > 0)
      .map((linea) => JSON.parse(linea) as OrdenPersistida)
  }

  private asegurarDir(): void {
    mkdirSync(this.sapDir, { recursive: true })
  }
}
