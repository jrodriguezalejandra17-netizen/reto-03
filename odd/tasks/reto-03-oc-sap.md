# Feature: Agente conversacional OC SAP (Reto 03)

Objetivo: agente conversacional que valida el paquete de compra contra maestros, construye el payload de la OC, genera la evidencia y crea la orden en un SAP simulado.
Branch: `main` (repo local `reto-03`) · Estrategia de entrega: `single-pr` (repo/zip de entrega) · Runner: `npm test` (node:test) + `npm run demo`

## Specs

- **S1** — Arquitectura obligatoria: "Construyes un agente conversacional de extremo a extremo… Front de chat… Backend… Herramientas tipadas con zod… Adaptador LLM… System prompt en un archivo Markdown aparte (agent/prompt.md)". Separación evaluada: comportamiento en `agent/prompt.md`, conocimiento en `src/knowledge/`, ejecución en `src/tools/`.
- **S2** — Contrato de herramientas: "Cada herramienta es un objeto con tres miembros. El nombre que ve el modelo es `<archivo>_<export>`"; `execute` "Devuelve **string** (JSON serializado) con `{ ok: true, data }` o `{ ok: false, error }`. **Nunca lanza.**"
- **S3** — Herramientas P0: `oc_leer_paquete {caso}`, `oc_validar {caso, paquete}`, `oc_construir_payload {caso, paquete, derivados}`, `oc_generar_evidencia {caso}`, `oc_crear {caso, payload, confirmado?}`.
- **S4** — Reglas de control RC1–RC10 con sus tipos (bloqueo / confirmación / derivado) y umbrales exactos (RC5 ≤ 2 %, RC3 tope del aprobador, RC10 ± 1 unidad).
- **S5** — Ciclo del agente CA1–CA5: "Tope de iteraciones herramienta → modelo por turno (sugerido 25)"; el modelo no puede afirmar valores que no salgan de una herramienta; confirmación humana explícita; toda llamada queda en el historial y en `out/log.jsonl`; un error se muestra en el chat y "La sesión no muere".
- **S6** — Payload y SAP: esquema `OrdenCompra` validado con zod, descripción de posición "máx. 40 caracteres (límite SAP en texto breve)", `interface SapAdapter` con `consultarProveedor`, `crearOrden`, `buscarOrdenPorReferencia`; "El adaptador simulado asigna número secuencial desde `4500000001`"; "Crear dos veces el mismo `solicitud_id` devuelve el número existente (idempotencia)"; cada intento agrega fila a `out/control.csv`.
- **S7** — `demo.ts`: "Procesa los 6 casos… Imprime por caso: `apta`, bloqueos, confirmaciones, `retroactiva`, número de OC o motivo. Debe mostrar la idempotencia ejecutando `sol-001` dos veces y una confirmación explícita para `sol-004`. Debe correr sin clave de ningún proveedor."
- **S8** — Entregables: `SOLUCION.md` con 12 secciones obligatorias, `README.md`, link público de prueba, y bonus `modulo/` con `agent.md`, `tools/oc.ts` y `skill/ordenes-compra/SKILL.md`.
- **S9** — No funcionales: "<2 minutos en máquina limpia", determinismo de `demo.ts` con limpieza de `out/`, clave del modelo solo en variable de entorno (nunca front/repo/logs/API), errores tipados, TypeScript sin `any`, zod obligatorio.

## Tasks

- [x] T1 · S1, S9 — Estructura hexagonal (domain/ports/app/adapters) + `package.json`, `tsconfig`, `env.example` (inline)
- [x] T2 · S4 — Dominio puro: `types.ts`, `controls.ts` (RC1–RC10), `payload.ts` (zod), parsers de cotización/factura (inline)
- [x] T3 · S3, S2 — Herramientas `oc_*` con contrato `{ok,data|error}` + registry con orden determinista (inline)
- [x] T4 · S6 — Adaptadores: `fixture-source`, `out-store` (evidencia+sha256, payload, trazabilidad, `control.csv`), `sap-mock` (secuencial + idempotencia) (inline)
- [x] T5 · S7 — `demo.ts` con los 6 casos, idempotencia y confirmaciones explícitas (inline) — corregido bug de encoding UTF-8
- [x] T6 · S1, S5 — Adaptador LLM OpenAI-compatible, ciclo del agente con tope de 25 iteraciones, sesiones, `server.ts`, `web/index.html` (inline)
- [x] T7 · S1 — `agent/prompt.md` + `src/knowledge/ordenes-compra.md` (inline)
- [x] T8 · S9 — 25 tests: RC1–RC10, payload/esquema SAP, ciclo del agente con LLM falso (inline)
- [x] T9 · S8 — `README.md`, `SOLUCION.md`, `modulo/` con script de sincronización (inline)
- [ ] T10 · S8 — Link público de prueba (pendiente: requiere cuenta de despliegue y `LLM_API_KEY` de la candidata)

## Log

- **L1** (2026-10-19, verbatim): "aaanquemos con el eto 3 hagamos una estuctura hexagonal que te paece para poder hacelo structurado y el font hagamos html plano emepec¿emos" → autorización explícita para implementar el reto 3 con arquitectura hexagonal y front HTML plano.
- **L2** (2026-10-19): hallazgo — los PDF del reto no son legibles por el modelo; la especificación completa está en `PRD.md` del ZIP. Se verificó equivalencia leyendo los fixtures y el PRD.
- **L3** (2026-10-19, evidencia): primer `npm run demo` detectó dos bugs: (a) fixtures leídos como `latin1` cuando son UTF-8 → mojibake y `sol-005` sin factura; (b) el payload confirmado no marcaba `confirmado_por`. Corregidos: lectura `utf8` y reconstrucción del payload al confirmar. Segundo `demo` cumple los 6 resultados esperados.
- **L4** (2026-10-19, evidencia): `npm test` → 25/25 pasan. `GET /api/health` responde `{ok:true,provider,model,llm_configured:false}`; `POST /api/chat` sin clave devuelve 503 con mensaje claro; el front estático se sirve.
- **L5** (2026-10-19): decisión — el `paquete` que envía el modelo no reemplaza la lectura del fixture (seguridad sobre conveniencia). Documentado en SOLUCION §8.3.
- **L6** (2026-10-19): decisión — `.env.example` no se pudo crear por reglas de permisos del entorno (patrón `*.env.*`); se usó `env.example` y se documentó en el README.
