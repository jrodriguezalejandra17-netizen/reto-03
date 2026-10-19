/**
 * demo.ts — runs every tool directly, without any LLM provider.
 * bun/node demo.ts
 *
 * Expected (PRD 3.1 / 6.6):
 *   sol-001 nuevo apto -> OC 4500000001 (twice: idempotent)
 *   sol-002 provider missing -> blocked RC1
 *   sol-003 approver without authority -> blocked RC2
 *   sol-004 quotation mismatch -> confirmation RC5, then created when confirmed
 *   sol-005 retroactive invoice -> confirmation RC8, created and flagged retroactiva
 *   sol-006 missing VAT -> derived C1 + confirmation RC6, created when confirmed
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { herramientas, registrarLog, validarArgs } from "./src/app/tools/index.ts"
import { OutStore } from "./src/adapters/out-store.ts"
import { FixtureSource } from "./src/adapters/fixture-source.ts"

const directory = import.meta.dirname
const ctx = { directory, sessionId: "demo" }

type Salida = { ok: boolean; data?: unknown; error?: string }

async function llamar(nombre: string, args: Record<string, unknown>): Promise<Salida> {
  const herramienta = herramientas[nombre]
  if (!herramienta) throw new Error(`Herramienta desconocida: ${nombre}`)
  const validados = validarArgs(herramienta, args)
  const resultado = validados.ok
    ? await herramienta.execute(validados.args, ctx)
    : JSON.stringify({ ok: false, error: validados.error })
  registrarLog(directory, nombre, String(args["caso"] ?? "-"), resultado)
  return JSON.parse(resultado) as Salida
}

function imprimir(titulo: string): void {
  console.log(`\n${"─".repeat(72)}\n${titulo}\n${"─".repeat(72)}`)
}

function describirValidacion(data: Record<string, unknown>): void {
  const bloqueos = (data["bloqueos"] as Array<{ codigo: string; detalle: string }>) ?? []
  const confirmaciones = (data["confirmaciones"] as Array<{ codigo: string; detalle: string }>) ?? []
  const derivados = (data["derivados"] as Record<string, string>) ?? {}
  console.log(`  apta: ${String(data["apta"])}   retroactiva: ${String(data["retroactiva"])}`)
  console.log(`  bloqueos: ${bloqueos.length === 0 ? "ninguno" : bloqueos.map((b) => b.codigo).join(", ")}`)
  for (const b of bloqueos) console.log(`    - ${b.codigo}: ${b.detalle}`)
  console.log(`  confirmaciones: ${confirmaciones.length === 0 ? "ninguna" : confirmaciones.map((c) => c.codigo).join(", ")}`)
  for (const c of confirmaciones) console.log(`    - ${c.codigo}: ${c.detalle}`)
  if (Object.keys(derivados).length > 0) console.log(`  derivados: ${JSON.stringify(derivados)}`)
}

async function main(): Promise<void> {
  const out = new OutStore(directory)
  out.limpiar()
  const fixtures = new FixtureSource(directory)
  const casos = fixtures.listarCasos()

  console.log("RETO 03 — Agente de Órdenes de Compra SAP (demo sin modelo)")
  console.log(`Casos: ${casos.join(", ")}`)

  for (const caso of casos) {
    imprimir(`CASO ${caso}`)

    const paquete = await llamar("oc_leer_paquete", { caso })
    if (!paquete.ok) {
      console.log(`  ERROR leyendo paquete: ${paquete.error}`)
      continue
    }
    const p = paquete.data as {
      solicitud: { solicitud_id: string; proveedor_nombre: string; valor_total: number }
      cotizacion: { total: number } | null
      factura: { fecha: string } | null
      aprobacion: { de: string } | null
    }
    console.log(
      `  ${p.solicitud.solicitud_id} · ${p.solicitud.proveedor_nombre} · total ${p.solicitud.valor_total}` +
        ` · cotización ${p.cotizacion?.total ?? "n/a"} · aprobador ${p.aprobacion?.de ?? "n/a"}` +
        ` · factura ${p.factura?.fecha ?? "n/a"}`,
    )

    const validacion = await llamar("oc_validar", { caso })
    if (!validacion.ok) {
      console.log(`  ERROR validando: ${validacion.error}`)
      continue
    }
    const evaluacion = validacion.data as Record<string, unknown>
    describirValidacion(evaluacion)

    if (evaluacion["apta"] !== true) {
      console.log("  ACCIÓN: no se crea la OC; se devuelve al humano con la razón y la acción sugerida.")
      continue
    }

    const construccion = await llamar("oc_construir_payload", { caso })
    if (!construccion.ok) {
      console.log(`  ERROR construyendo payload: ${construccion.error}`)
      continue
    }
    const construido = construccion.data as { ruta_payload: string; payload: { posiciones: Array<{ descripcion: string; indicador_iva: string }> } }
    console.log(`  payload: ${construido.ruta_payload}`)
    console.log(`  posición: "${construido.payload.posiciones[0]?.descripcion}" · IVA ${construido.payload.posiciones[0]?.indicador_iva}`)

    const primera = await llamar("oc_crear", { caso })
    if (primera.ok) {
      const r = primera.data as { numero_oc: string; idempotente: boolean }
      console.log(`  OC creada: ${r.numero_oc} (idempotente: ${r.idempotente})`)
      if (caso === "sol-001") {
        const segunda = await llamar("oc_crear", { caso })
        const r2 = segunda.data as { numero_oc: string; idempotente: boolean }
        console.log(`  segunda ejecución: OC ${r2.numero_oc} (idempotente: ${r2.idempotente})`)
      }
      continue
    }

    const pendientes = (evaluacion["confirmaciones"] as Array<{ codigo: string; detalle: string }>) ?? []
    console.log(`  PENDIENTE DE CONFIRMACIÓN: ${primera.error}`)
    if (pendientes.length > 0) {
      console.log(`  PREGUNTA AL USUARIO: ${pendientes.map((c) => c.detalle).join(" ")}`)
    }

    const confirmada = await llamar("oc_crear", { caso, confirmado: true })
    if (confirmada.ok) {
      const r = confirmada.data as { numero_oc: string; idempotente: boolean }
      console.log(`  tras confirmar: OC ${r.numero_oc} (idempotente: ${r.idempotente})`)
    } else {
      console.log(`  tras confirmar: ERROR ${confirmada.error}`)
    }
  }

  imprimir("LOG DE CONTROL — out/control.csv")
  console.log(readFileSync(join(directory, "out", "control.csv"), "utf8").trimEnd())
}

await main()
