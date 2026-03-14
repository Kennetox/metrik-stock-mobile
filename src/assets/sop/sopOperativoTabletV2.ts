export const SOP_OPERATIVO_TABLET_V2 = String.raw`
# SOP Operativo v2 - Metrik Stock Tablet (Recepción + Recuentos)

## 1) Objetivo
Estandarizar en tablet dos flujos críticos:
- Recepción por lote.
- Recuentos por documento.

Con foco en trazabilidad por dispositivo, velocidad operativa y control de diferencias.

## 2) Alcance
Aplica a todo movimiento hecho desde la app Metrik Stock en tablet:
- Lotes de recepción creados/cerrados desde la app.
- Recuentos creados, cerrados y aplicados desde la app.
- Historial de documentos del dispositivo activo.

## 3) Roles sugeridos
- Responsable de recepción: captura lotes y cierra.
- Responsable de conteo: ejecuta recuentos y valida diferencias.
- Supervisor: revisa historial y movimientos en Metrik Web.

## 4) Principios no negociables
- Todo ingreso físico debe pasar por lote.
- Todo ajuste por diferencia debe pasar por recuento aplicado.
- No cerrar turno con documentos abiertos sin justificación.
- Cada tablet opera con su identidad ('stock_device_id') y sus documentos.

## 5) Flujo de recepción (resumen operativo)

### Paso 1 - Nuevo lote
- Ir a 'Inicio > Lotes abiertos > Nuevo lote'.
- Definir tipo ('Contado' / 'Factura') y datos mínimos de origen.

### Paso 2 - Captura de ítems
- Agregar ítems existentes por búsqueda o escaneo.
- Si no existe, usar 'Crear producto' y completar mínimos obligatorios.
- Registrar cantidad real recibida.

### Paso 3 - Verificación
- Revisar líneas y cantidades.
- Adjuntar soporte cuando aplique (factura/soporte interno).

### Paso 4 - Cierre del lote
- 'Cerrar lote'.
- Confirmar que el lote queda en historial del dispositivo.

## 6) Flujo de recuentos (paso a paso)

### Paso 1 - Crear recuento
- Ir a 'Recuentos > Nuevo recuento'.
- Completar:
  - Título (opcional).
  - Alcance:
    - 'Todo': catálogo completo del alcance permitido.
    - 'Libre': permite contar productos sin precarga inicial.
    - 'Por categoría': obliga a elegir categoría existente desde lista.
  - Modo:
    - 'Ciego': no muestra sistema al contar.
    - 'Visible': muestra sistema y diferencia en tiempo real.

### Paso 2 - Conteo en documento
- Ingresar al documento.
- Contar por:
  - Escáner bluetooth + Enter.
  - Cámara (escáner integrado).
  - Agregado manual.
- En 'Por categoría', sólo se aceptan productos de la categoría seleccionada.

### Paso 3 - Cierre del recuento
- Botón 'Cerrar'.
- Confirmar cierre: desde ese punto no se editan líneas.

### Paso 4 - Aplicar recuento
- Botón 'Aplicar' (disponible después de cerrar).
- Confirmar aplicación:
  - Genera ajustes de inventario por diferencia.
  - Deja trazabilidad en Metrik Web (movimientos/historial).

## 7) Estados de recuento
- 'En conteo': editable.
- 'Cerrado': bloqueado para edición, listo para aplicar.
- 'Aplicado': ajuste ejecutado.
- 'Cancelado': documento anulado sin aplicar.

## 8) Historial y trazabilidad
- El historial de la app muestra sólo documentos del dispositivo activo.
- No debe mezclar documentos de web ni de otras tablets.
- Se debe validar en historial:
  - Recepciones cerradas.
  - Recuentos cerrados/aplicados.

## 9) Checklist operativo de turno
- [ ] Sin lotes abiertos pendientes de cerrar.
- [ ] Sin recuentos cerrados pendientes de aplicar (o justificados).
- [ ] Sin errores de impresión pendientes críticos.
- [ ] Historial validado para el dispositivo activo.
- [ ] Incidencias documentadas en observaciones.

## 10) Incidencias comunes y acción
- No aparece teclado en agregado manual:
  - Cerrar y reabrir agregado manual, validar foco en búsqueda.
- Error al crear recuento por límite de abiertos:
  - Cerrar/cancelar documentos abiertos y reintentar.
- Dispositivo bloqueado:
  - Validar estado del dispositivo en panel de control (Metrik Web).

## 11) Criterio de éxito operativo
- Recepciones del día cerradas el mismo día.
- Recuentos críticos aplicados sin atraso.
- Trazabilidad consistente por dispositivo.
- Diferencias corregidas con evidencia de documento aplicado.

---
Versión: v2
Estado: Vigente
`;
