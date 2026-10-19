/**
 * Domain types — core entities of the Purchase Order agent.
 * Pure data: no I/O, no framework dependencies (zod schemas live in payload.ts / paquete.ts).
 */

export type MaestroProveedor = {
  codigo_sap: string
  nit: string
  nombre: string
  condiciones_pago_default: string
  indicador_iva_default: string
  activo: boolean
}

export type Aprobador = { email: string; nombre: string; tope: number }

export type MaestroCentroCosto = {
  centro_costo: string
  nombre: string
  subareas: string[]
  aprobadores: Aprobador[]
}

export type MaestroIndicadorIva = { codigo: string; descripcion: string; tasa: number }

export type MaestroCondicionPago = { codigo: string; descripcion: string; dias: number }

export type Maestros = {
  proveedores: MaestroProveedor[]
  centrosCosto: MaestroCentroCosto[]
  indicadoresIva: MaestroIndicadorIva[]
  condicionesPago: MaestroCondicionPago[]
}

export type Correo = { id: string; de: string; asunto: string; fecha: string }

export type Solicitud = {
  solicitud_id: string
  solicitante: string
  proveedor_nombre: string
  proveedor_nit: string | null
  descripcion: string
  centro_costo: string
  subarea: string
  cantidad: number
  valor_unitario: number
  valor_total: number
  moneda: string
  indicador_iva: string | null
  condiciones_pago: string | null
  fecha_solicitud: string
}

export type Cotizacion = {
  proveedor: string
  nit: string | null
  total: number
  moneda: string
  validez_hasta: string | null
  texto: string
}

export type Aprobacion = {
  de: string
  fecha: string
  aprobado: boolean
  texto: string
}

export type Factura = { numero: string; fecha: string; total: number }

export type Paquete = {
  correo: Correo
  solicitud: Solicitud
  cotizacion: Cotizacion | null
  aprobacion: Aprobacion | null
  factura: Factura | null
}

/** SAP purchase order payload — schema 7.4 of the PRD. */
export type OrdenCompra = {
  referencia: {
    solicitud_id: string
    correo_id: string
    cotizacion_ref: string | null
  }
  sociedad: "1000"
  organizacion_compras: "1000"
  proveedor: { codigo_sap: string; nit: string; nombre: string }
  moneda: "COP" | "USD"
  condiciones_pago: string
  aprobador: { email: string; fecha_aprobacion: string; evidencia_sha256: string }
  posiciones: Array<{
    numero: number
    descripcion: string
    cantidad: number
    unidad: "UN" | "H" | "MES"
    precio_unitario: number
    centro_costo: string
    subarea: string
    indicador_iva: string
  }>
  excepciones: Array<{ codigo: string; detalle: string; confirmado_por: string | null }>
}

export type Hallazgo = { codigo: string; detalle: string }

export type Derivados = Record<string, string>

/** Result of applying the control rules RC1–RC10 to a package. */
export type Evaluacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
}

export type ResultadoCreacion = {
  numero_oc: string
  fecha: string
  idempotente: boolean
}

export type IntentoControl = {
  solicitud_id: string
  resultado: "validada" | "bloqueada" | "pendiente_confirmacion" | "creada" | "idempotente" | "error"
  numero_oc: string
  retroactiva: boolean
  bloqueos: string
  confirmaciones: string
}
