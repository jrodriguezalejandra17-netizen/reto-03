/**
 * Tests for the control rules RC1–RC10 against the real fixtures.
 * Run with: npm test
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { evaluar } from "./controls.ts"
import { FixtureSource } from "../adapters/fixture-source.ts"

const directory = join(import.meta.dirname, "..", "..")
const fixtures = new FixtureSource(directory)
const maestros = fixtures.leerMaestros()

function evaluarCaso(caso: string) {
  return evaluar(fixtures.leerPaquete(caso), maestros)
}

const codigos = (hallazgos: Array<{ codigo: string }>) => hallazgos.map((h) => h.codigo)

describe("RC — reglas de control", () => {
  it("sol-001 es apta, sin bloqueos ni confirmaciones", () => {
    const r = evaluarCaso("sol-001")
    assert.equal(r.apta, true)
    assert.deepEqual(r.bloqueos, [])
    assert.deepEqual(r.confirmaciones, [])
    assert.equal(r.retroactiva, false)
  })

  it("sol-002 queda bloqueada por RC1 (proveedor inexistente)", () => {
    const r = evaluarCaso("sol-002")
    assert.equal(r.apta, false)
    assert.ok(codigos(r.bloqueos).includes("RC1"))
  })

  it("sol-003 queda bloqueada por RC2 (aprobador sin autoridad en el centro de costo)", () => {
    const r = evaluarCaso("sol-003")
    assert.equal(r.apta, false)
    assert.ok(codigos(r.bloqueos).includes("RC2"))
  })

  it("sol-004 exige confirmación por RC5 (cotización vs solicitud)", () => {
    const r = evaluarCaso("sol-004")
    assert.equal(r.apta, true)
    assert.ok(codigos(r.confirmaciones).includes("RC5"))
  })

  it("sol-005 es retroactiva y exige confirmación por RC8", () => {
    const r = evaluarCaso("sol-005")
    assert.equal(r.retroactiva, true)
    assert.ok(codigos(r.confirmaciones).includes("RC8"))
    assert.equal(fixtures.leerPaquete("sol-005").factura?.numero, "FC-88231")
  })

  it("sol-006 deriva el indicador de IVA y exige confirmación por RC6", () => {
    const r = evaluarCaso("sol-006")
    assert.ok(codigos(r.confirmaciones).includes("RC6"))
    assert.equal(r.derivados["indicador_iva"], "C1")
    assert.equal(r.derivados["condiciones_pago"], "Z030")
  })

  it("RC10 bloquea cuando cantidad x valor unitario no cuadra", () => {
    const paquete = fixtures.leerPaquete("sol-001")
    paquete.solicitud.valor_total = 1
    const r = evaluar(paquete, maestros)
    assert.ok(codigos(r.bloqueos).includes("RC10"))
  })

  it("RC3 bloquea cuando el valor supera el tope del aprobador", () => {
    const paquete = fixtures.leerPaquete("sol-006")
    paquete.solicitud.valor_total = 99_000_000
    paquete.solicitud.valor_unitario = 3_300_000
    const r = evaluar(paquete, maestros)
    assert.ok(codigos(r.bloqueos).includes("RC3"))
  })

  it("RC9 exige confirmación si la aprobación precede a la solicitud", () => {
    const paquete = fixtures.leerPaquete("sol-001")
    if (paquete.aprobacion) paquete.aprobacion.fecha = "2026-08-01T10:00:00-05:00"
    const r = evaluar(paquete, maestros)
    assert.ok(codigos(r.confirmaciones).includes("RC9"))
  })

  it("RC4 bloquea una subárea ajena al centro de costo", () => {
    const paquete = fixtures.leerPaquete("sol-001")
    paquete.solicitud.subarea = "Marketing"
    const r = evaluar(paquete, maestros)
    assert.ok(codigos(r.bloqueos).includes("RC4"))
  })

  it("RC5 exige confirmación si no hay cotización", () => {
    const paquete = fixtures.leerPaquete("sol-001")
    paquete.cotizacion = null
    const r = evaluar(paquete, maestros)
    assert.ok(codigos(r.confirmaciones).includes("RC5"))
  })

  it("RC1 bloquea un proveedor inactivo", () => {
    const paquete = fixtures.leerPaquete("sol-001")
    paquete.solicitud.proveedor_nombre = "Consultores Ágiles S.A.S."
    paquete.solicitud.proveedor_nit = "901777888"
    const r = evaluar(paquete, maestros)
    assert.ok(codigos(r.bloqueos).includes("RC1"))
    assert.match(r.bloqueos[0]?.detalle ?? "", /inactivo/)
  })
})
