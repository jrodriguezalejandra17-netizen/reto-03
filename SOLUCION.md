# SOLUCION.md — Agente de Órdenes de Compra SAP (Reto 03)

## 1. Problema en una frase y a quién le duele

Cada compra se digita a mano en SAP (proveedor, descripción, centro de costos, subárea, valor, IVA, aprobador, condiciones de pago) y un centro de costo mal tecleado se corrige en cierre contable: le duele a la **analista administrativa**, que repite el trabajo por cada factura, y a **contabilidad/auditoría**, que no puede demostrar que quien aprobó tenía autoridad para hacerlo.

## 2. Arquitectura

```
┌────────────────────┐  HTTP   ┌──────────────────────────────────────────────┐
│ web/index.html     │ ──────▶ │ src/server.ts                                │
│ chat (HTML plano)  │ ◀────── │  · API /api/chat, /api/sessions, /api/health │
│ · tool calls       │         │  · sirve el front estático                   │
│ · confirmaciones   │         └───────────────┬──────────────────────────────┘
└────────────────────┘                         │
                                   ┌───────────▼───────────────┐
                                   │ src/app/agent-loop.ts     │  <- caso de uso
                                   │ prompt→modelo→tools→reply │
                                   │ tope de 25 iteraciones    │
                                   └───────┬───────────┬───────┘
                         ┌─────────────────▼──┐   ┌────▼─────────────────────┐
                         │ src/ports (hexágono)│   │ src/tools/oc.ts         │
                         │ PaqueteSource, ...  │   │ herramientas oc_*        │
                         └───┬─────────┬───────┘   └────┬─────────────────────┘
                             │         │                │
              ┌──────────────▼──┐  ┌───▼────────────┐  ┌▼────────────────────┐
              │ src/adapters/    │  │ src/sap/       │  │ src/domain/         │
              │ fixture-source   │  │ adapter.ts     │  │ controls RC1-RC10   │
              │ out-store        │  │ mock.ts        │  │ payload + zod       │
              │                  │  │ src/llm/       │  │ parsers de texto    │
              │                  │  │ adapter.ts     │  │                     │
              │                  │  │ openai.ts      │  │                     │
              └──────────────────┘  └────────────────┘  └─────────────────────┘
                 fixtures/ (RO)      SAP + LLM            puro, sin I/O
                 out/ (escritura)
```

**Dónde vive cada cosa** (separación que el PRD evalúa):

- **Comportamiento** → `agent/prompt.md` (system prompt en Markdown, fuera del código). Cambiar cómo pregunta el agente no toca ni una línea de TypeScript.
- **Conocimiento** → `src/knowledge/ordenes-compra.md`, inyectado al system prompt y compartido con `modulo/skill/`.
- **Ejecución** → `src/tools/oc.ts` (casos de uso) y `src/domain/` (reglas puras).

El hexágono es real, no decorativo: `src/domain/controls.ts` no importa nada de Node. Los tests de RC1–RC10 y del payload corren sin tocar disco salvo para leer el fixture. El SAP mock y el proveedor LLM son intercambiables porque solo implementan `SapAdapter` (`src/sap/adapter.ts`, ruta que el PRD 7.4 marca como obligatoria) y `LlmPort` (`src/llm/adapter.ts`).

## 3. Ciclo del agente

`Agente.turno()` recibe el mensaje del usuario y entra en un bucle:

1. Envía `[system, ...historial]` + las definiciones de herramienta (JSON Schema generado desde zod) al proveedor.
2. Si el modelo devuelve `tool_calls`, valida los argumentos con zod **antes** de ejecutar. Si no cumplen, el error vuelve al modelo como resultado; la herramienta nunca se llama con datos inválidos.
3. Ejecuta, guarda la línea en `out/log.jsonl` (CA4) y agrega el resultado como mensaje `tool`.
4. Repite hasta que el modelo responda texto o se alcancen **25 iteraciones** (CA1). Al tope, responde con lo hecho y lo pendiente.

- **CA2** (el modelo no puede afirmar valores que no salgan de una herramienta): el `system prompt` lo prohíbe y el diseño lo hace innecesario: los montos, códigos y rutas salen de las herramientas.
- **CA3 (confirmación humana)**: el bucle marca `needsConfirmation = true` cuando `oc_validar` devuelve confirmaciones y ninguna `oc_crear` exitosa las cerró en el turno. El front pinta ese estado en amarillo. `oc_crear` con confirmaciones pendientes y `confirmado != true` **falla por diseño**, aunque el modelo insista.
- **CA5**: un error del proveedor o de la herramienta se devuelve como texto al chat; la sesión vive en memoria + `out/sessions/<id>.json`.

## 4. Elección del modelo

**Proveedor**: cualquiera compatible con la API de OpenAI, configurable por `LLM_BASE_URL`. El despliegue desplegado usa **Google Gemini `gemini-3.1-flash-lite`** vía el endpoint OpenAI-compatible (`https://generativelanguage.googleapis.com/v1beta/openai/`).

**Por qué**: el trabajo del modelo aquí es *orquestar* (leer un paquete, llamar 5 herramientas en orden, explicar el resultado), no razonar sobre grandes volúmenes. Un modelo pequeño y con *tool calling* correcto es suficiente, y el adaptador permite cambiar de proveedor sin tocar el ciclo del agente. `temperature: 0.1` para que la secuencia de llamadas sea estable.

**Por qué `gemini-3.1-flash-lite` y no otro**: el agente hace ~5–6 iteraciones por caso y cada iteración reenvía el contexto completo (prompt + conocimiento + esquemas de herramientas + paquete). En el **plan free**:

| Modelo (free tier) | RPD | Nota |
|---|---|---|
| Groq `openai/gpt-oss-120b` | 1.000 | Pero **8.000 TPM**: un solo turno (5–6 iteraciones × 4–6 k tokens) agota el minuto y devuelve 429 a mitad del bucle. Inviable para una demo en vivo. |
| Gemini `gemini-3.8-flash` | **20** | Se agota en ~3 casos por día; el proyecto llegó a 26/20. |
| **Gemini `gemini-3.1-flash-lite`** | **500** | 25× más margen que el 3.8 Flash; soporta *tool calling* y thought signatures (Gemini 3). |

Los modelos **Flash-Lite** son el camino que Google recomienda justamente para experimentación y evaluación. Gemini 3 exige reenviar el mensaje del proveedor *verbatim* (trae `extra_content.thought_signature`): si no, responde 400. El adaptador guarda y reproduce ese mensaje original — ver `src/llm/adapter.ts` y `src/app/agent-loop.ts`.

**Costo estimado por caso**: ~5 iteraciones, un paquete de ~2 KB de entrada y respuestas cortas → del orden de **8–12 k tokens de entrada y ~1 k de salida por caso**. En el plan free es **$0**; con Gemini 3.8 Flash pago (≈ $0,30 / M entrada, $2,50 / M salida) son **≈ $0,006 por caso**, unos **$6 por cada 1.000 órdenes de compra**. Los topes de iteraciones (25) y de tamaño de la petición (1 MB) acotan el gasto por sesión.

## 5. Matriz de controles

| Regla | Implementación | Tipo | Caso que la ejerce |
|---|---|---|---|
| RC1 | `buscarProveedor()` por NIT (solicitud → cotización) y por nombre normalizado (sin tildes, sin S.A.S./Ltda.); verifica `activo` | Bloqueo | `sol-002`; test de proveedor inactivo |
| RC2 | `aprobacion.aprobado` por regex `/aprobado/i` sobre el cuerpo + el correo debe estar en `centro_costo.aprobadores` | Bloqueo | `sol-003` |
| RC3 | `valor_total <= aprobador.tope` | Bloqueo | test dedicado |
| RC4 | `centro_costo.subareas.includes(subarea)` | Bloqueo | test dedicado |
| RC5 | `abs(cot - sol) / sol <= 0.02`; sin cotización → confirmación | Confirmación | `sol-004` (6,0 %) |
| RC6 | Sin `indicador_iva` → deriva `proveedor.indicador_iva_default` + confirma | Confirmación + derivado | `sol-006` (C1) |
| RC7 | Sin `condiciones_pago` → deriva `proveedor.condiciones_pago_default` | Derivado | `sol-006` (Z030) |
| RC8 | `factura.fecha < fecha_solicitud` → `retroactiva = true` + confirma | Confirmación | `sol-005` |
| RC9 | `aprobacion.fecha >= fecha_solicitud` | Confirmación | test dedicado |
| RC10 | `abs(cantidad * valor_unitario - valor_total) <= 1` | Bloqueo | test dedicado |

**La más difícil: RC2.** No basta con que exista un correo con la palabra "Aprobado": hay que cruzar tres piezas (el remitente del correo, el centro de costo de la solicitud y la lista de aprobadores de ese centro) y decidir qué pasa cuando el centro no existe. Ahí está el valor real del agente, porque la validación hoy es mental. La segunda es **RC5**, donde además hay que parsear el total de la cotización en texto libre (`TOTAL (IVA incluido): COP 26.500.000`) y decidir el mensaje con los dos valores.

**Regla de diseño**: un bloqueo con el centro de costo inexistente también bloquea RC4 (no se puede validar la subárea) — se prefirió bloquear con explicación antes que asumir.

## 6. Diseño del adaptador SAP real

**Opción elegida: OData — `API_PURCHASEORDER_PROCESS_SRV` (API_PURCHASEORDER_PROCESS_SRV / `A_PurchaseOrder`).**

**Por qué**: es API pública, documentada y *released* de SAP S/4HANA, con autenticación estándar y sin necesidad de un middleware adicional. Frente a `BAPI_PO_CREATE1` (RFC, requiere conectividad RFC/SAP GUI, más frágil entre versiones y difícil de probar) y a SAP Integration Suite (potente pero introduce licencia y un equipo de integración que hoy no existe), OData se integra desde Node con `fetch` y se puede probar contra un *sandbox*. Si la viabilidad no se confirma, existe Plan B.

**Mapeo del payload (7.4) → `A_PurchaseOrder`:**

| Payload local | Campo OData |
|---|---|
| `proveedor.codigo_sap` | `Supplier` |
| `sociedad` / `organizacion_compras` | `CompanyCode` / `PurchasingOrganization` |
| `moneda` | `DocumentCurrency` |
| `condiciones_pago` | `PaymentTerms` |
| `referencia.solicitud_id` | `PurchaseOrderType` + texto de cabecera (referencia para idempotencia) |
| `posiciones[]` | `to_PurchaseOrderItem` (`PurchaseOrderItem` 10/20/30, `Material`/`PurchaseOrderItemText` ≤ 40, `OrderQuantity`, `PurchaseOrderQuantityUnit`, `NetPriceAmount`, `CostCenter`, `TaxCode`) |
| `aprobador.evidencia_sha256` | adjunto (`to_PurchaseOrderAttachment`) + `ReleaseStrategy` |

**Autenticación y credenciales**: OAuth 2.0 client credentials (o Basic sobre HTTPS según el landscape) contra el gateway de SAP. Las credenciales viven en variables de entorno del backend o, mejor, en un *secret manager* (Azure Key Vault, AWS Secrets Manager). **Nunca** en el agente, el prompt, el repositorio ni los logs; el adaptador real las lee de `process.env` igual que hoy lee `LLM_API_KEY`.

**Idempotencia**: antes de crear, `GET A_PurchaseOrder?$filter=...` por la referencia (`solicitud_id` en un campo de texto de cabecera o un atributo de extensión) — es la misma estrategia que `buscarOrdenPorReferencia()` del mock. Si no hay match, se crea con una clave de idempotencia; ante reintentos por timeout, la búsqueda previa evita duplicar. Si SAP responde con error parcial (por ejemplo, cabecera creada y una posición rechazada), **no se reintenta a ciegas**: se devuelve el número de OC y el detalle de la posición rechazada para corrección manual asistida, y queda la fila en `control.csv` como excepción.

**Plan B si la conexión no es viable**: el agente ya aporta valor sin escribir en SAP. Genera el payload completo y el archivo de evidencia, y puede exportar un **archivo de carga masiva** (LSMW / `MIGO`-ready o un `.txt` para *upload*) o una OC "lista para pegar" con los campos en el orden de la pantalla de SAP GUI. La analista deja de digitar: revisa y pega. El control RC1–RC10 y el log de retroactivas se mantienen completos, que es la mitad del problema.

## 7. Lectura del proceso (retroactivas)

A la dirección: **las OC retroactivas no son un accidente aislado, son un síntoma de que el control se ejerce después del gasto.** Cuando la factura llega antes de la OC, la cotización ya se saltó y el proveedor ya entregó: el sistema solo está registrando lo que ya pasó, y las validaciones (tope del aprobador, centro de costo correcto, IVA) se aplican cuando ya no pueden evitar nada. El agente lo mide: `retroactiva = true` en `out/control.csv` da el porcentaje real de OC creadas fuera de secuencia, que hoy nadie conoce.

Cambio de proceso propuesto: **sin OC no hay radicación de factura**. Es una regla de sistema, no de buena voluntad — si cuentas por pagar no puede radicar sin número de OC, el solicitante pide la OC antes de recibir el bien. Para que la regla no ahogue la operación (compras urgentes, servicios de continuidad), se acompaña de una figura explícita de **OC express con aprobación de excepción** y plazo de 24 h, medida y visible en el mismo log. El objetivo no es prohibir la excepción, es que deje de ser invisible.

## 8. Decisiones y trade-offs

1. **Hexagonal con dominio puro, sin framework HTTP.** Elegido: `node:http` + capas. Alternativa descartada: Express/Fastify + arquitectura plana. Motivo: las 10 reglas de control son la parte que más se va a modificar, y mantenerlas puras permite testearlas con los fixtures reales en 25 ms, sin levantar un servidor. Costó algo más de código de arranque; se cobró en testabilidad.
2. **`demo.ts` recorre los 6 casos por el mismo camino que el agente.** Alternativa descartada: un script que llame a las funciones directamente. Motivo: si la demo usa las mismas herramientas que el modelo (con validación zod incluida), la demo es una prueba real del contrato, no un atajo.
3. **El paquete siempre se relee del fixture dentro de cada herramienta.** Alternativa descartada: confiar en el objeto `paquete` que envía el modelo (que es lo que sugiere el contrato del PRD). Motivo: el modelo no debe poder cambiar un monto entre `validar` y `crear`. El argumento se acepta por contrato, pero no reemplaza la fuente. Es una decisión de seguridad sobre conveniencia.
4. **Sin `dotenv` ni dependencias fuera de `zod`.** Se usa `process.loadEnvFile` de Node. Menos superficie, arranque más rápido, menos que justificar.
5. **PDF de evidencia (P1) no implementado; el txt con `sha256` sí (P0).** Prioridad explícita del PRD y de la ventana de 2 horas: el hash es lo que da valor probatorio al archivo; el formato PDF es presentación.

## 9. Supuestos

- Los fixtures vienen **UTF-8** (verificado; se leen como `utf8`, no `latin1`).
- Un caso = un centro de costo y una posición de OC. El payload ya está preparado para varias posiciones (`posiciones[]`), pero los fixtures traen una sola y el builder no las inventa.
- El NIT de la solicitud llega sin dígito de verificación; el de la cotización llega con puntos y guion (`900.555.111-2`). Se normalizan a dígitos y se descarta el DV.
- La comparación de montos de RC5 usa el **total con IVA incluido** de la cotización, que es el que aparece en el fixture.
- `aprobado` se detecta por la palabra en el cuerpo del correo; se asume que el correo de aprobación es suficiente evidencia (riesgo señalado en el PRD).
- Los maestros son la fuente de verdad de proveedores, centros de costo y códigos; no hay consulta en vivo a SAP en este prototipo.

## 10. Cobertura

| Historia | Estado | Detalle |
|---|---|---|
| HU-1 Leer el paquete | ✅ Hecho | `oc_leer_paquete` normaliza correo, solicitud, cotización, aprobación y factura; adjunto ausente = `null` |
| HU-2 Validar contra maestros | ✅ Hecho | `oc_validar` aplica RC1–RC10 y devuelve `apta`, `bloqueos`, `confirmaciones`, `derivados`, `retroactiva` |
| HU-3 Construir el payload | ✅ Hecho | `oc_construir_payload` + `trazabilidad.json` con la fuente de cada valor |
| HU-4 Evidencia de aprobación | ✅ P0 hecho (txt + `sha256`) / ⚪ P1 no hecho (PDF) | Falta PDF con `pdf-lib` |
| HU-5 Crear la OC en SAP | ✅ Hecho | Secuencial desde `4500000001`, idempotente por `solicitud_id`, `control.csv` por intento |
| HU-6 Manejo de errores | ✅ Hecho | Errores tipados `{ok:false,error}`, la demo y el chat siguen con el siguiente caso |
| Bonus: módulo reutilizable | ✅ Hecho | `modulo/agent.md`, `modulo/tools/oc.ts` (re-export), `modulo/skill/` |

**Qué falta para producción**: adaptador SAP real (§6), lectura de `.xlsx`/PDF binarios (P1), OCR si llegan escaneos, autenticación y roles, secret manager para credenciales, y despliegue con logs centralizados.

## 11. Uso de IA

- **Asistente usado para construir**: OpenCode (agente), con el PRD como especificación. La IA escribió el andamiaje hexagonal, los parsers, el mock de SAP, el front y los tests; yo definí el diseño de capas, revisé cada regla contra los fixtures y verifiqué los resultados caso por caso.
- **Qué descarté y por qué**:
  - *Parser de NIT con dígito de verificación* (propuesto): lo simplifiqué porque el maestro guarda NIT sin DV.
  - *Confiar en el `paquete` que envía el modelo*: descartado por seguridad (§8.3), aunque el PRD lo lista como argumento.
  - *Usar `latin1` para leer los fixtures* (mi primera hipótesis por los acentos de la consola): lo verifiqué y era falso — los archivos son UTF-8. La factura de `sol-005` no se detectaba; leer con `utf8` lo corrigió. La lección: no confiar en la consola de Windows para juzgar encoding.
  - *Streaming de respuestas*: marcado como opcional en el PRD y sacrificado por la ventana de tiempo.
- **Verificación**: los 6 casos esperados se comprobaron con `npm run demo`, y las reglas con 25 tests automatizados. Cada resultado de la tabla del README salió de una ejecución real, no de la descripción del PRD.

## 12. Riesgos de llevarlo a producción

| Riesgo | Mitigación |
|---|---|
| El modelo elige mal el caso o inventa un valor | Las herramientas son la única fuente de valores; los montos salen del payload validado con zod, no del texto del modelo |
| Conectividad SAP no viable | Plan B de §6: carga masiva / OC lista para pegar |
| Duplicar una OC por reintento o timeout | Idempotencia por `solicitud_id` (mock y diseño real); `control.csv` registra cada intento |
| Credenciales filtradas al front, logs o prompt | Claves solo en variables de entorno del backend; `/api/health` no las expone; el payload nunca las contiene |
| Crecimiento del costo por sesión | Tope de 25 iteraciones por turno, `temperature` baja, límite de tamaño de petición |
| Maestros desactualizados (proveedor nuevo, aprobador que cambió) | El bloqueo RC1/RC2 devuelve la acción sugerida en vez de fallar en silencio; en producción se consultan en vivo |
| OC retroactivas que se normalizan | Se crean solo con confirmación explícita y quedan marcadas en el log; la política la decide la dirección, el agente la mide |
| Pérdida de trazabilidad de la evidencia | `sha256` del contenido de aprobación en el payload y el archivo en `out/<caso>/aprobacion.txt` |
