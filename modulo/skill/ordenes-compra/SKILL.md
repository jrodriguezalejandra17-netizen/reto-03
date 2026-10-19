---
name: ordenes-compra
description: Valida y prepara órdenes de compra SAP (RC1-RC10) desde un paquete de correo con solicitud, cotización, aprobación y factura. Úsala para evaluar si un caso es apto, qué bloqueos tiene, qué confirmaciones exige y cómo se arma el payload de la OC.
---

# Proceso de órdenes de compra (conocimiento del negocio)

## Contexto

Cada compra llega a administración por correo con tres piezas: la solicitud (Excel normalizado a JSON), la cotización del proveedor y el correo de aprobación del líder. Hoy la analista digita proveedor, descripción, centro de costos, subárea, valor, indicador de IVA, aprobador y condiciones de pago en SAP GUI, y adjunta el correo de aprobación convertido a PDF.

Un hallazgo del proceso: muchas OC se crean **después** de que llega la factura, saltándose la cotización. El agente debe detectar ese caso (`retroactiva = true`) y registrarlo, porque la dirección lo mide.

## Actores

- **Solicitante**: pide la compra, envía el paquete.
- **Líder aprobador**: responde "Aprobado" por correo.
- **Analista administrativa**: usa el agente y confirma excepciones.
- **Contabilidad / Auditoría**: consume `out/control.csv`.
- **SAP**: sistema de registro, simulado por el adaptador local.

## Reglas de control

| Código | Regla | Efecto |
|---|---|---|
| RC1 | El proveedor debe existir en el maestro (por NIT, o por nombre normalizado) y estar activo. | Bloqueo |
| RC2 | La aprobación debe existir, contener "Aprobado" y venir de un aprobador del centro de costo. | Bloqueo |
| RC3 | El valor total no puede superar el tope del aprobador para ese centro. | Bloqueo |
| RC4 | La subárea debe pertenecer al centro de costo. | Bloqueo |
| RC5 | Diferencia cotización vs solicitud ≤ 2 %. Si no hay cotización, confirmación. | Confirmación |
| RC6 | Indicador de IVA ausente: se deriva del proveedor y se confirma. | Confirmación + derivado |
| RC7 | Condiciones de pago ausentes: se derivan del proveedor, solo se informan. | Derivado |
| RC8 | Factura con fecha anterior a la solicitud: OC retroactiva. | Confirmación + marca |
| RC9 | La fecha de aprobación debe ser ≥ fecha de solicitud. | Confirmación |
| RC10 | cantidad × valor unitario debe igualar el valor total (± 1 unidad). | Bloqueo |

## Glosario

- **OC**: orden de compra.
- **Solicitud**: pedido interno de compra (payload normalizado en `solicitud.json`).
- **Cotización**: oferta del proveedor; su total puede diferir de la solicitud.
- **Aprobación**: correo del líder que autoriza el gasto.
- **Retroactiva**: la factura existe antes de crear la OC; el proceso se saltó la cotización.
- **Indicador de IVA**: código SAP (C0 excluido, C1 19 %, C2 5 %).
- **Condiciones de pago**: código SAP (Z000 inmediato, Z015 15 días, Z030 30 días, Z060 60 días).

## Trazabilidad

Todo valor del payload debe poder rastrearse a una fuente: `solicitud`, `cotizacion`, `maestro.<nombre>` o `derivado`. La trazabilidad se guarda en `out/<caso>/trazabilidad.json`. Los montos salen de las herramientas; el modelo nunca los altera.

## Política de retroactivas

El agente no decide la política: la mide. Una OC retroactiva se crea solo con confirmación explícita y queda marcada en el log de control para que contabilidad y auditoría la revisen.
