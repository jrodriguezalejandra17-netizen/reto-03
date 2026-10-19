/**
 * SAP adapter contract (PRD section 7.4 — "Interfaz del adaptador (obligatoria
 * en src/sap/adapter.ts)").
 *
 * Production would implement it against OData API_PURCHASEORDER_PROCESS_SRV
 * (design in SOLUCION.md §6). The simulated implementation lives in mock.ts
 * and writes to out/sap/.
 */

import type { OrdenCompra } from "../domain/types.ts"

export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>
}
