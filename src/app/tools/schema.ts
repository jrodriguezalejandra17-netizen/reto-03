/**
 * Minimal zod -> JSON Schema converter for the argument shapes used by the tools.
 * Avoids pulling a second dependency for a handful of primitive types.
 */

import { z } from "zod"

type JsonSchema = Record<string, unknown>

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return convertir(schema)
}

function convertir(schema: z.ZodTypeAny): JsonSchema {
  const descripcion = schema.description ? { description: schema.description } : {}

  if (schema instanceof z.ZodOptional) {
    return convertir(schema._def.innerType)
  }
  if (schema instanceof z.ZodString) {
    return { type: "string", ...descripcion }
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number", ...descripcion }
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean", ...descripcion }
  }
  if (schema instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: true, ...descripcion }
  }
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: convertir(schema.element), ...descripcion }
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []
    for (const [clave, valor] of Object.entries(shape)) {
      properties[clave] = convertir(valor)
      if (!valor.isOptional()) required.push(clave)
    }
    return { type: "object", properties, required, ...descripcion }
  }
  return { ...descripcion }
}
