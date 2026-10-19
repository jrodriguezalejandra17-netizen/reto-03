/**
 * Control rules RC1–RC10 (PRD section 7.3).
 * Pure functions: (Paquete, Maestros) -> Evaluacion. No I/O, no side effects.
 */

import type { Evaluacion, Hallazgo, Maestros, Paquete } from "./types.ts"

const TOLERANCIA_COTIZACION = 0.02
const TOLERANCIA_ARITMETICA = 1

export function evaluar(paquete: Paquete, maestros: Maestros): Evaluacion {
  const bloqueos: Hallazgo[] = []
  const confirmaciones: Hallazgo[] = []
  const derivados: Record<string, string> = {}

  const { solicitud, cotizacion, aprobacion, factura } = paquete
  const proveedor = buscarProveedor(paquete, maestros)
  const centro = maestros.centrosCosto.find((c) => c.centro_costo === solicitud.centro_costo) ?? null

  // RC1 — proveedor existe (por NIT, o por nombre normalizado) y está activo
  if (!proveedor) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `Proveedor "${solicitud.proveedor_nombre}" (NIT ${solicitud.proveedor_nit ?? "sin NIT"}) no existe en el maestro de proveedores.`,
    })
  } else if (!proveedor.activo) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `Proveedor "${proveedor.nombre}" (código SAP ${proveedor.codigo_sap}) está inactivo.`,
    })
  }

  // RC2 — aprobación existe, contiene "Aprobado" y viene de un aprobador del centro de costo
  const aprobador = centro?.aprobadores.find(
    (a) => aprobacion && a.email.toLowerCase() === aprobacion.de.toLowerCase(),
  ) ?? null
  if (!aprobacion) {
    bloqueos.push({ codigo: "RC2", detalle: "Falta el correo de aprobación del líder." })
  } else if (!aprobacion.aprobado) {
    bloqueos.push({ codigo: "RC2", detalle: `El correo de aprobación no contiene "Aprobado" (texto: "${aprobacion.texto.slice(0, 80)}").` })
  } else if (!centro) {
    bloqueos.push({ codigo: "RC2", detalle: `Centro de costo ${solicitud.centro_costo} inexistente en el maestro; no se puede verificar la autoridad del aprobador.` })
  } else if (!aprobador) {
    bloqueos.push({
      codigo: "RC2",
      detalle: `${aprobacion.de} no es aprobador del centro de costo ${solicitud.centro_costo}. Aprobadores: ${centro.aprobadores.map((a) => a.email).join(", ")}.`,
    })
  }

  // RC3 — valor_total <= tope del aprobador para ese centro
  if (aprobador && solicitud.valor_total > aprobador.tope) {
    bloqueos.push({
      codigo: "RC3",
      detalle: `Valor total ${solicitud.valor_total} excede el tope del aprobador ${aprobador.email} (${aprobador.tope}) para ${solicitud.centro_costo}.`,
    })
  }

  // RC4 — la subarea pertenece al centro de costo
  if (centro && !centro.subareas.includes(solicitud.subarea)) {
    bloqueos.push({
      codigo: "RC4",
      detalle: `Subárea "${solicitud.subarea}" no pertenece al centro de costo ${solicitud.centro_costo}. Subáreas válidas: ${centro.subareas.join(", ")}.`,
    })
  } else if (!centro) {
    bloqueos.push({ codigo: "RC4", detalle: `No se puede validar la subárea: centro de costo ${solicitud.centro_costo} inexistente.` })
  }

  // RC5 — diferencia solicitud vs cotización <= 2 %
  if (cotizacion) {
    const dif = Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total
    if (dif > TOLERANCIA_COTIZACION) {
      confirmaciones.push({
        codigo: "RC5",
        detalle: `La cotización totaliza ${cotizacion.total} y la solicitud declara ${solicitud.valor_total} (diferencia ${(dif * 100).toFixed(1)}%, tope 2%). Confirme cuál valor es el correcto.`,
      })
    }
  } else {
    confirmaciones.push({ codigo: "RC5", detalle: "No se encontró cotización adjunta. Confirme si procede sin cotización." })
  }

  // RC6 — indicador de IVA ausente -> derivado del proveedor + confirmación
  if (!solicitud.indicador_iva) {
    if (proveedor) {
      derivados["indicador_iva"] = proveedor.indicador_iva_default
      confirmaciones.push({
        codigo: "RC6",
        detalle: `La solicitud no informa indicador de IVA; se deriva "${proveedor.indicador_iva_default}" del proveedor. Confirme.`,
      })
    } else {
      bloqueos.push({ codigo: "RC6", detalle: "Solicitud sin indicador de IVA y sin proveedor resoluble; no hay de dónde derivarlo." })
    }
  } else if (!maestros.indicadoresIva.some((i) => i.codigo === solicitud.indicador_iva)) {
    bloqueos.push({ codigo: "RC6", detalle: `Indicador de IVA "${solicitud.indicador_iva}" no existe en el maestro de indicadores.` })
  }

  // RC7 — condiciones de pago ausentes -> derivadas del proveedor, solo se informa
  if (!solicitud.condiciones_pago) {
    if (proveedor) {
      derivados["condiciones_pago"] = proveedor.condiciones_pago_default
    } else {
      bloqueos.push({ codigo: "RC7", detalle: "Solicitud sin condiciones de pago y sin proveedor resoluble; no hay de dónde derivarlas." })
    }
  } else if (!maestros.condicionesPago.some((c) => c.codigo === solicitud.condiciones_pago)) {
    bloqueos.push({ codigo: "RC7", detalle: `Condición de pago "${solicitud.condiciones_pago}" no existe en el maestro.` })
  }

  // RC8 — factura anterior a la solicitud => retroactiva, confirmación
  const retroactiva = Boolean(factura && factura.fecha < solicitud.fecha_solicitud)
  if (retroactiva) {
    confirmaciones.push({
      codigo: "RC8",
      detalle: `Factura ${factura?.numero} con fecha ${factura?.fecha} anterior a la fecha de solicitud ${solicitud.fecha_solicitud}: la OC es retroactiva. Confirme su creación.`,
    })
  }

  // RC9 — fecha de aprobación >= fecha de solicitud
  if (aprobacion) {
    const fechaAprob = aprobacion.fecha.slice(0, 10)
    if (fechaAprob < solicitud.fecha_solicitud) {
      confirmaciones.push({
        codigo: "RC9",
        detalle: `La aprobación (${fechaAprob}) es anterior a la fecha de solicitud (${solicitud.fecha_solicitud}). Confirme.`,
      })
    }
  }

  // RC10 — cantidad x valor_unitario ~= valor_total
  if (Math.abs(solicitud.cantidad * solicitud.valor_unitario - solicitud.valor_total) > TOLERANCIA_ARITMETICA) {
    bloqueos.push({
      codigo: "RC10",
      detalle: `Aritmética no cuadra: ${solicitud.cantidad} x ${solicitud.valor_unitario} != ${solicitud.valor_total}.`,
    })
  }

  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones,
    derivados,
    retroactiva,
  }
}

function buscarProveedor(paquete: Paquete, maestros: Maestros) {
  const { solicitud, cotizacion } = paquete
  if (solicitud.proveedor_nit) {
    const porNit = maestros.proveedores.find((p) => p.nit === solicitud.proveedor_nit)
    if (porNit) return porNit
  }
  if (cotizacion?.nit) {
    const porNitCot = maestros.proveedores.find((p) => p.nit === cotizacion.nit)
    if (porNitCot) return porNitCot
  }
  return maestros.proveedores.find((p) => normalizarNombre(p.nombre) === normalizarNombre(solicitud.proveedor_nombre)) ?? null
}

function normalizarNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(s\.?a\.?s\.?|ltda\.?|s\.?a\.?)\b\.?/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
