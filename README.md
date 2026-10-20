# Reto 03 — Agente de Órdenes de Compra SAP

Agente conversacional que lee el paquete de compra (correo + solicitud + cotización + aprobación + factura), lo valida contra los maestros con las reglas **RC1–RC10**, construye el payload de la OC, genera la evidencia de aprobación y crea la orden en un SAP simulado. Las excepciones no se resuelven a la fuerza: se clasifican y se devuelven al humano con una recomendación.

## Levantar en local (un comando)

```bash
npm install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
npm run dev
```

Abre `http://localhost:3000`. Un solo comando levanta front (HTML plano) y backend (Node built-in HTTP server).

> Requiere **Node 20+**. Probado con Node 24, que ejecuta TypeScript nativamente sin paso de build.

## Variables de entorno (`.env.example` → `.env`)

| Variable | Requerida | Descripción |
|---|---|---|
| `LLM_API_KEY` | Sí, para el chat | Clave del proveedor. **Nunca** se expone al front, ni a los logs, ni a las respuestas de la API. |
| `LLM_BASE_URL` | No | Endpoint compatible con OpenAI. Por defecto `https://api.openai.com/v1`; sirve para Gemini, Groq, Azure, Mistral o un servidor local. |
| `LLM_MODEL` | No | Modelo a usar (por defecto `gpt-4o-mini`). El despliegue usa `gemini-3.1-flash-lite`. |
| `PORT` | No | Puerto del servidor (por defecto `3000`). |

El archivo `.env` está en `.gitignore` y no se entrega.

> **¿Qué modelo usar en producción?** El trabajo del agente es *orquestar* llamadas a herramientas, no razonar sobre grandes volúmenes: cualquier modelo con tool calling correcto alcanza. Cada caso consume ~5–6 request (una por iteración) y cada iteración reenvía el contexto completo, así que el límite que importa es el de **requests por minuto/día**, no el de tokens. Con el plan free, `gemini-3.1-flash-lite` ofrece 500 RPD frente a los 20 de `gemini-3.8-flash` — de ahí la elección. Ver §4 de `SOLUCION.md` para la comparación completa.

## Verificación sin modelo

```bash
npm run demo
```

Procesa los 6 casos llamando directamente a las herramientas e imprime, por caso: `apta`, bloqueos, confirmaciones, `retroactiva`, payload y número de OC. Muestra la **idempotencia** de `sol-001` (dos ejecuciones, mismo número) y confirmaciones explícitas para `sol-004`, `sol-005` (retroactiva) y `sol-006`. `out/` se limpia al inicio, así que dos ejecuciones seguidas dan el mismo resultado (salvo timestamps).

Resultados esperados:

| Caso | Resultado |
|---|---|
| `sol-001` | apta → OC `4500000001`; la segunda ejecución devuelve el mismo número (`idempotente: true`) |
| `sol-002` | bloqueada por **RC1** (proveedor inexistente) |
| `sol-003` | bloqueada por **RC2** (aprobador sin autoridad en el centro de costo) |
| `sol-004` | confirmación **RC5** (cotización 26.500.000 vs solicitud 25.000.000) → OC al confirmar |
| `sol-005` | confirmación **RC8**, `retroactiva = true` → OC al confirmar |
| `sol-006` | derivado `C1` + confirmación **RC6** → OC al confirmar |

## Tests

```bash
npm test
```

25 pruebas con el runner nativo de Node: las 10 reglas de control contra los fixtures reales, el esquema SAP del payload (incluido el límite de 40 caracteres del texto breve) y el ciclo del agente con un proveedor LLM falso (tope de iteraciones, argumentos inválidos, herramienta desconocida, caída del proveedor y estado de confirmación). No requieren ninguna clave.

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ ok, reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model, llm_configured }` — sin claves |

## Arquitectura (hexagonal)

```
web/index.html ──HTTP──▶ src/server.ts ──▶ src/app/agent-loop.ts ──▶ src/llm/adapter.ts
   (adaptador in)          (adaptador in)      (caso de uso)          (interfaz LLM)
                                                                        ▲
                            src/domain (reglas puras) ──────────────────┤
                            src/tools (herramientas oc_*) ──────────────┤
                            src/sap (SapAdapter + mock) ────────────────┤
                            src/adapters (fs: fixtures, out/) ──────────┘
```

| Capa | Contenido | Regla |
|---|---|---|
| `src/domain/` | `types.ts`, `controls.ts` (RC1–RC10), `payload.ts`, `cotizacion.ts` | Puro: no conoce HTTP, ni archivos, ni proveedor. Todo lo testeable vive aquí. |
| `src/tools/` | `oc.ts` (herramientas `oc_*`), `index.ts` (registro + zod), `schema.ts` | Contrato de herramientas del PRD 6.2 en la ruta que el instructivo nombra. Única fuente de valores que el agente puede afirmar. |
| `src/sap/` | `adapter.ts` (`SapAdapter`, obligatoria en el PRD 7.4), `mock.ts` | Interfaz SAP y simulación sobre `out/sap/`. El mock es intercambiable por el adaptador real. |
| `src/llm/` | `adapter.ts` (interfaz `LlmPort`), `openai.ts` | Proveedor del modelo. Cambiar de proveedor no toca el ciclo del agente. |
| `src/ports/` | `PaqueteSource`, `EvidenciaPort`, `ControlLogPort`, `ArtefactosPort` | Los puertos restantes del hexágono. |
| `src/app/` | `agent-loop.ts`, `sessions.ts` | Caso de uso: bucle del agente con tope de iteraciones y sesiones. |
| `src/adapters/` | `fixture-source.ts`, `out-store.ts` | I/O: fixtures de solo lectura y escritura en `out/`. |
| `agent/prompt.md` | Comportamiento | Cambiar una regla de conducta no toca código. |
| `src/knowledge/ordenes-compra.md` | Conocimiento del proceso | Se inyecta al system prompt y se comparte con `modulo/skill/`. |

Separación evaluada por el PRD —**comportamiento** en `agent/prompt.md`, **conocimiento** en `src/knowledge/`, **ejecución** en `src/tools`— respetada con las rutas literales que pide el instructivo: cambiar las reglas de negocio no toca el servidor.

## Estructura

```
reto-03/
├── agent/prompt.md              # system prompt
├── src/
│   ├── domain/                  # reglas puras + tests
│   ├── tools/                   # herramientas oc_* con zod (PRD 6.2)
│   ├── sap/                     # SapAdapter (obligatorio, PRD 7.4) + mock
│   ├── llm/                     # interfaz del proveedor + implementación
│   ├── ports/                   # interfaces restantes (hexágono)
│   ├── app/                     # ciclo del agente y sesiones
│   ├── adapters/                # fixtures y out/
│   ├── knowledge/               # conocimiento del proceso
│   └── server.ts                # API HTTP + front estático
├── web/index.html               # front de chat (HTML plano)
├── modulo/                      # bonus: agente empaquetado reutilizable
├── scripts/sync-modulo.mjs      # sincroniza modulo/ desde las fuentes
├── demo.ts                      # verificación sin modelo
├── fixtures/                    # entregados por Periferia (solo lectura)
├── out/                         # generado en ejecución (no se entrega)
├── .env.example
├── README.md
└── SOLUCION.md
```

## Front de chat

Muestra el historial, el indicador de "pensando", **cada llamada a herramienta** (nombre, argumentos y resultado en un bloque desplegable) y **resalta en amarillo** cuando el agente pide confirmación. Sin build step, sin dependencias.

## Módulo reutilizable (bonus)

```
modulo/
├── agent.md                          # frontmatter + system prompt
├── tools/oc.ts                       # re-export de las MISMAS herramientas de la app
└── skill/ordenes-compra/SKILL.md     # frontmatter + conocimiento
```

`modulo/tools/oc.ts` re-exporta la implementación real, así que no puede divergir. `agent.md` y `SKILL.md` se generan con `npm run sync:modulo` desde `agent/prompt.md` y `src/knowledge/ordenes-compra.md`.

## Link de prueba

**https://reto-03.onrender.com** — desplegado en Render con `gemini-3.1-flash-lite` (endpoint OpenAI-compatible de Google).

### Cómo desplegarlo

La app no tiene paso de build (Node 24 ejecuta TypeScript directo), así que cualquier host sirve:

**Opción A — host de Node (Render, Railway, Fly, Cloud Run), sin Docker.**

| Ajuste | Valor |
|---|---|
| Repositorio | este repo |
| Build command | `npm install` |
| Start command | `npm start` |
| Puerto | el host inyecta `PORT`; `src/server.ts` ya lo lee |
| Variables de entorno | `LLM_API_KEY`, `LLM_BASE_URL` (`https://generativelanguage.googleapis.com/v1beta/openai/`), `LLM_MODEL` (`gemini-3.1-flash-lite`) |

**Opción B — contenedor.** Hay un `Dockerfile` listo en la raíz (`docker build -t reto-03 .`). **No está validado en esta máquina porque Docker no está instalado aquí** — si vas por esta vía, probalo antes de la entrega.

En ambos casos el despliegue **necesita la clave del modelo** como variable de entorno del host; sin ella `/api/health` responde `llm_configured: false` y `/api/chat` devuelve HTTP 503 con un mensaje claro (las reglas de negocio y `npm run demo` funcionan igual, porque no dependen del modelo).

> Nota: en hosts con sistema de archivos efímero, `out/` (evidencia, `control.csv`, órdenes del SAP simulado) se reinicia en cada despliegue. Para persistirlo, montá un volumen en `/app/out`.

## Uso de IA

Ver sección 11 de `SOLUCION.md`.
