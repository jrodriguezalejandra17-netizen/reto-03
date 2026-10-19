/**
 * Tests for the payload builder and the SAP schema (PRD 7.4).
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { construirPayload, inferirUnidad, ordenCompraSchema, truncarDescripcion } from "./payload.ts"
import { evaluar } from "./controls.ts"
import { FixtureSource } from "../adapters/fixture-source.ts"

const directory = join(import.meta.dirname, "..", "..")
const fixtures = new FixtureSource(directory)
const maestros = fixtures.leerMaestros()
const SHA_FICTICIO = "a".repeat(64)

describe("payload — construcción y esquema SAP", () => {
  it("sol-001 produce un payload válido contra el esquema", () => {
    const paquete = fixtures.leerPaquete("sol-001")
    const evaluacion = evaluar(paquete, maestros)
    const r = construirPayload(paquete, evaluacion, maestros, SHA_FICTICIO, false)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(ordenCompraSchema.safeParse(r.payload).success, true)
    assert.equal(r.payload.moneda, "COP")
    assert.equal(r.payload.proveedor.codigo_sap, "100234")
    assert.equal(r.payload.posiciones[0]?.indicador_iva, "C1")
    assert.equal(r.payload.posiciones[0]?.numero, 10)
    assert.equal(r.payload.referencia.solicitud_id, "SOL-2026-001")
  })

  it("nunca supera los 40 caracteres del texto breve de SAP", () => {
    const paquete = fixtures.leerPaquete("sol-001")
    const evaluacion = evaluar(paquete, maestros)
    const r = construirPayload(paquete, evaluacion, maestros, SHA_FICTICIO, false)
    assert.equal(r.ok, true)
    if (!r.ok) return
    for (const posicion of r.payload.posiciones) {
      assert.ok(posicion.descripcion.length <= 40, `descripción demasiado larga: ${posicion.descripcion}`)
    }
  })

  it("trunca descripciones largas y conserva las cortas", () => {
    assert.equal(truncarDescripcion("Corto"), "Corto")
    assert.equal(truncarDescripcion("x".repeat(60)).length, 40)
  })

  it("infiere la unidad SAP desde la descripción", () => {
    assert.equal(inferirUnidad("Bolsa de 100 horas de arquitectura"), "H")
    assert.equal(inferirUnidad("Suscripción por 12 meses"), "MES")
    assert.equal(inferirUnidad("Licencia antivirus"), "UN")
  })

  it("las excepciones marcan confirmado_por solo cuando se confirmó", () => {
    const paquete = fixtures.leerPaquete("sol-004")
    const evaluacion = evaluar(paquete, maestros)
    const sinConfirmar = construirPayload(paquete, evaluacion, maestros, SHA_FICTICIO, false)
    const confirmado = construirPayload(paquete, evaluacion, maestros, SHA_FICTICIO, true)
    assert.equal(sinConfirmar.ok && sinConfirmar.payload.excepciones[0]?.confirmado_por, null)
    assert.equal(confirmado.ok && confirmado.payload.excepciones[0]?.confirmado_por, "analista")
  })

  it("falla con error legible si el proveedor no existe", () => {
    const paquete = fixtures.leerPaquete("sol-002")
    const evaluacion = evaluar(paquete, maestros)
    const r = construirPayload(paquete, evaluacion, maestros, SHA_FICTICIO, false)
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.match(r.error, /no existe en el maestro/)
  })
})
