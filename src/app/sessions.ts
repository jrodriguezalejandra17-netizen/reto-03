/**
 * Session store — in-memory sessions with a JSON mirror under out/sessions/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { LlmMensaje } from "../llm/adapter.ts"

export type SesionPersistida = {
  id: string
  mensajes: LlmMensaje[]
  creada: string
}

export class SessionStore {
  private readonly sesiones = new Map<string, SesionPersistida>()
  private readonly dir: string

  constructor(directory: string) {
    this.dir = join(directory, "out", "sessions")
  }

  obtenerOCrear(id: string): SesionPersistida {
    const existente = this.sesiones.get(id)
    if (existente) return existente

    const enDisco = this.leerDeDisco(id)
    const sesion: SesionPersistida = enDisco ?? { id, mensajes: [], creada: new Date().toISOString() }
    this.sesiones.set(id, sesion)
    return sesion
  }

  guardar(sesion: SesionPersistida): void {
    this.sesiones.set(sesion.id, sesion)
    try {
      mkdirSync(this.dir, { recursive: true })
      const archivo = join(this.dir, `${seguro(sesion.id)}.json`)
      writeFileSync(archivo, JSON.stringify(sesion, null, 2), "utf8")
    } catch {
      // persistence is best-effort; the in-memory session survives the request
    }
  }

  private leerDeDisco(id: string): SesionPersistida | null {
    try {
      const archivo = join(this.dir, `${seguro(id)}.json`)
      if (!existsSync(archivo)) return null
      return JSON.parse(readFileSync(archivo, "utf8")) as SesionPersistida
    } catch {
      return null
    }
  }
}

function seguro(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)
}
