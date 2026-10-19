/**
 * Syncs the reusable module from the application sources, so `modulo/` never
 * becomes a divergent copy:
 *   agent/prompt.md + src/knowledge/ordenes-compra.md  ->  modulo/agent.md
 *   src/knowledge/ordenes-compra.md                    ->  modulo/skill/ordenes-compra/SKILL.md
 * Register a tools export here if a new tool must be part of the module.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const raiz = join(import.meta.dirname, "..")
const prompt = readFileSync(join(raiz, "agent", "prompt.md"), "utf8").trim()
const conocimiento = readFileSync(join(raiz, "src", "knowledge", "ordenes-compra.md"), "utf8").trim()

mkdirSync(join(raiz, "modulo", "skill", "ordenes-compra"), { recursive: true })

const agentMd = `---
description: Crea órdenes de compra en SAP a partir del paquete de correo, solicitud, cotización y aprobación, aplicando los controles RC1-RC10 y pidiendo confirmación humana antes de crear excepciones.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}

---

# Conocimiento del proceso

${conocimiento}
`
writeFileSync(join(raiz, "modulo", "agent.md"), agentMd, "utf8")

const skillMd = `---
name: ordenes-compra
description: Valida y prepara órdenes de compra SAP (RC1-RC10) desde un paquete de correo con solicitud, cotización, aprobación y factura. Úsala para evaluar si un caso es apto, qué bloqueos tiene, qué confirmaciones exige y cómo se arma el payload de la OC.
---

${conocimiento}
`
writeFileSync(join(raiz, "modulo", "skill", "ordenes-compra", "SKILL.md"), skillMd, "utf8")

console.log("modulo/ sincronizado desde agent/prompt.md y src/knowledge/ordenes-compra.md")
