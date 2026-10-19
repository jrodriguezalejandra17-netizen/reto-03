/**
 * Módulo reutilizable — las MISMAS herramientas que usa la aplicación, importables
 * sin levantar el servidor HTTP.
 *
 * No es una copia divergente: re-exporta la implementación real de `src/tools/oc.ts`,
 * la que también consume el backend. Cualquier cambio en las herramientas queda
 * automáticamente disponible aquí.
 *
 * Los nombres que ve el modelo son los mismos (`oc_leer_paquete`, `oc_validar`, ...):
 * usa `definicionesParaModelo()` y `validarArgs()` de `src/tools/index.ts`.
 *
 * El prompt y el conocimiento se sincronizan con `node scripts/sync-modulo.mjs`.
 */

export {
  leer_paquete,
  validar,
  generar_evidencia,
  construir_payload,
  crear,
  type Contexto,
  type Herramienta,
} from "../../src/tools/oc.ts"

export { definicionesParaModelo, herramientas, registrarLog, validarArgs } from "../../src/tools/index.ts"
