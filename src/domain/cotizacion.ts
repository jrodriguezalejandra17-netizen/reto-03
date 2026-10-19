/**
 * Parsers for the free-text attachments (quotation and invoice).
 * Pure functions: string in, typed data out. No I/O.
 */

import type { Cotizacion, Factura } from "./types.ts"

/** "900.555.111-2" -> "900555111" (drops the check digit and separators). */
export function normalizarNit(raw: string): string {
  const partePrincipal = raw.split("-")[0] ?? ""
  return partePrincipal.replace(/\D/g, "")
}

/** "COP 11.400.000" / "11.400.000" -> 11400000 */
export function parseMonto(raw: string): number {
  return Number(raw.replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."))
}

function sumaDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Extracts the normalized quotation from `cotizacion.txt`.
 * Returns null when the text does not look like a quotation at all.
 */
export function parseCotizacion(texto: string): Cotizacion | null {
  if (!/COTIZACI/i.test(texto)) return null

  const proveedor = texto.match(/Proveedor:\s*(.+)/i)?.[1]?.trim() ?? ""
  const nitRaw = texto.match(/NIT:\s*([0-9.,\-]+)/i)?.[1]?.trim() ?? null
  const totalRaw = texto.match(/TOTAL\s*\(IVA incluido\):\s*([^\n]+)/i)?.[1]?.trim()
    ?? texto.match(/TOTAL:\s*([^\n]+)/i)?.[1]?.trim()
    ?? null
  const fechaCot = texto.match(/Fecha:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null
  const validezDias = texto.match(/Validez de la oferta:\s*(\d+)\s*d/i)?.[1] ?? null
  const moneda = texto.match(/TOTAL[^\n]*?([A-Z]{3})\s/i)?.[1] ?? "COP"

  if (!proveedor || !totalRaw) return null

  return {
    proveedor,
    nit: nitRaw ? normalizarNit(nitRaw) : null,
    total: parseMonto(totalRaw),
    moneda,
    validez_hasta: fechaCot && validezDias ? sumaDias(fechaCot, Number(validezDias)) : null,
    texto,
  }
}

/** Extracts the normalized invoice from `factura.txt`. */
export function parseFactura(texto: string): Factura | null {
  if (!/FACTURA/i.test(texto)) return null
  const numero = texto.match(/FACTURA[^\n]*?No\.?\s*([A-Z0-9\-]+)/i)?.[1]?.trim() ?? null
  const fecha = texto.match(/Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null
  const totalRaw = texto.match(/TOTAL:\s*([^\n]+)/i)?.[1]?.trim() ?? null
  if (!numero || !fecha || !totalRaw) return null
  return { numero, fecha, total: parseMonto(totalRaw) }
}
