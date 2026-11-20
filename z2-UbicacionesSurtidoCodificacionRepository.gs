/**
 * z2-UbicacionesSurtidoCodificacionRepository.gs
 *
 * @fileoverview Acceso a hojas para la codificación de UBICACIONES_SURTIDO.
 *
 * Fuentes:
 *   Hoja (archivo)                         Uso
 *   ────────────────────────────────────── ──────────────────────────────────────────
 *   UBICACIONES (APPALMACEN4 / GESTION4)    Catálogo maestro: bodegas, áreas de
 *                                           suministro, niveles y DIRECCION. Solo lectura.
 *   UBICACIONES_SURTIDO (APPALMACEN1)       Productos con su ubicación preliminar
 *                                           (ZONA, PASILLO, UBICACION) y las columnas de
 *                                           captura (BODEGA_CLAVE, AREASUMINISTRO_CLAVE,
 *                                           NIVEL, AREADESUMINISTRO, BIN).
 *
 * DECISIONES DE DISEÑO
 * - Columnas por NOMBRE de encabezado, nunca por letra: la hoja puede cambiar
 *   de orden o recibir columnas nuevas (cargas masivas de layouts).
 * - UBICACIONES tiene "AREASUMINISTRO_CLAVE" repetido: la primera aparición es
 *   la clave (P1) y la segunda la clase (OPERATIVA, RESERVA, ...). Por eso el
 *   catálogo se lee con su propio lector (primera aparición = clave).
 * - UBICACIONES_SURTIDO usa createHeaderLayoutAccessor_: valida encabezados
 *   requeridos y, al escribir, agrega al final las columnas de captura que
 *   falten (por ejemplo BIN).
 * - Escrituras verificadas: antes de escribir se relee la columna CODIGO y se
 *   exige que cada fila siga teniendo el código esperado (si la hoja se
 *   reordenó o recargó, no se escribe nada).
 * - Escrituras agrupadas: filas consecutivas con columnas de captura
 *   contiguas se escriben en un solo bloque setValues().
 * - Ninguna función toma el ScriptLock: lo toma el Service.
 *
 * Dependencias globales:
 * - getSheetByKey_(), createHeaderLayoutAccessor_(), perfMark_().
 * - toStr_(), toStrUpper_().
 * - UBICACIONES_SURTIDO_CODIFICACION_HEADERS, UBICACIONES_SURTIDO_CODIFICACION_CONFIG.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version UBICACIONES-SURTIDO-CODIFICACION-REPOSITORY-2026-11-20-01
 */

const UbicacionesSurtidoCodificacionRepository = (() => {
  "use strict";

  const CFG = UBICACIONES_SURTIDO_CODIFICACION_CONFIG;
  const HEADERS = UBICACIONES_SURTIDO_CODIFICACION_HEADERS;
  const FIRST_DATA_ROW = 2;

  /** Accesor por encabezado de UBICACIONES_SURTIDO (requeridos + captura). */
  const layout = createHeaderLayoutAccessor_(CFG.SURTIDO_SHEET_KEY, HEADERS.REQUERIDOS, HEADERS.CAPTURA);

  // ==========================================================================
  // CATÁLOGO DE ÁREAS DE SUMINISTRO (APPALMACEN4 → UBICACIONES)
  // ==========================================================================

  /**
   * Lee el catálogo maestro completo.
   *
   * Encabezados usados (primera aparición): BODEGA_NOMBRE, BODEGA_CLAVE,
   * AREASUMINISTRO_NOMBRE, AREASUMINISTRO_CLAVE, NIVEL, NIVEL_CLAVE,
   * DIRECCION. La clase del área es la columna con la SEGUNDA aparición de
   * AREASUMINISTRO_CLAVE (si existe).
   *
   * @param {Object=} trace Traza opcional.
   * @return {!Array<{bodegaNombre:string, bodegaClave:string, areaNombre:string,
   *     areaClave:string, areaClase:string, nivel:number, nivelClave:string,
   *     direccion:string}>}
   */
  function getCatalogo(trace) {
    const sheet = getSheetByKey_(CFG.CATALOGO_SHEET_KEY, trace);
    const startedAt = Date.now();
    const values = sheet.getDataRange().getValues();
    const headers = (values[0] || []).map(toStrUpper_);
    const first = (name) => headers.indexOf(name);
    const index = {
      bodegaNombre: first("BODEGA_NOMBRE"),
      bodegaClave: first("BODEGA_CLAVE"),
      areaNombre: first("AREASUMINISTRO_NOMBRE"),
      areaClave: first("AREASUMINISTRO_CLAVE"),
      areaClase: headers.indexOf("AREASUMINISTRO_CLAVE", first("AREASUMINISTRO_CLAVE") + 1),
      nivel: first("NIVEL"),
      nivelClave: first("NIVEL_CLAVE"),
      direccion: first("DIRECCION")
    };
    const missing = ["bodegaNombre", "bodegaClave", "areaClave", "nivel", "nivelClave", "direccion"]
      .filter((key) => index[key] < 0);
    if (missing.length) {
      throw new Error("La hoja UBICACIONES de APPALMACEN4 no tiene los encabezados: " + missing.join(", ") + ".");
    }
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const bodegaClave = toStrUpper_(row[index.bodegaClave]);
      const areaClave = toStrUpper_(row[index.areaClave]);
      const direccion = toStrUpper_(row[index.direccion]);
      if (!bodegaClave || !areaClave || !direccion) continue;
      rows.push({
        bodegaNombre: toStrUpper_(row[index.bodegaNombre]),
        bodegaClave: bodegaClave,
        areaNombre: index.areaNombre >= 0 ? toStrUpper_(row[index.areaNombre]) : areaClave,
        areaClave: areaClave,
        areaClase: index.areaClase >= 0 ? toStrUpper_(row[index.areaClase]) : "",
        nivel: Number(row[index.nivel]) || 0,
        nivelClave: toStrUpper_(row[index.nivelClave]),
        direccion: direccion
      });
    }
    perfMark_(trace, "UBICSURT_CATALOGO_READ", { rows: rows.length, elapsedMs: Date.now() - startedAt });
    return rows;
  }

  // ==========================================================================
  // UBICACIONES_SURTIDO
  // ==========================================================================

  /**
   * Lee UBICACIONES_SURTIDO completa (una llamada) y normaliza cada fila.
   *
   * @param {Object=} trace Traza opcional.
   * @return {!Array<!Object>} Filas con rowNumber, ubicación preliminar y captura.
   */
  function getFilas(trace) {
    const table = layout.readTable(trace);
    const current = table.layout;
    const read = (row, header) => layout.read(row, current, header);
    const result = [];
    table.rows.forEach(function(row, offset) {
      const codigo = toStrUpper_(read(row, "CODIGO"));
      if (!codigo) return;
      result.push({
        rowNumber: FIRST_DATA_ROW + offset,
        idUbicacion: toStr_(read(row, "IDUBICACION")),
        codigo: codigo,
        idProducto: toStr_(read(row, "IDPRODUCTO")),
        zona: toStr_(read(row, "ZONA")),
        pasillo: toStr_(read(row, "PASILLO")),
        anaquel: toStr_(read(row, "ANAQUEL")),
        repisa: toStr_(read(row, "REPISA")),
        ubicacion: toStrUpper_(read(row, "UBICACION")),
        bodegaClave: toStrUpper_(read(row, "BODEGA_CLAVE")),
        areaClave: toStrUpper_(read(row, "AREASUMINISTRO_CLAVE")),
        nivel: toStr_(read(row, "NIVEL")),
        bin: toStr_(read(row, "BIN")),
        codigoArea: toStrUpper_(read(row, "AREADESUMINISTRO"))
      });
    });
    return result;
  }

  /**
   * Escribe las columnas de captura de varias filas. El Service DEBE tener el
   * ScriptLock.
   *
   * @param {!Array<{rowNumber:number, codigo:string, valores:!Object<string,*>}>} items
   *     valores: {BODEGA_CLAVE, AREASUMINISTRO_CLAVE, NIVEL, AREADESUMINISTRO, BIN}.
   * @param {Object=} trace Traza opcional.
   * @return {{filas:number, bloques:number}}
   * @throws {Error} Si alguna fila ya no tiene el código esperado.
   */
  function writeCapturaUnderLock(items, trace) {
    const list = (Array.isArray(items) ? items : []).slice().sort((a, b) => a.rowNumber - b.rowNumber);
    if (!list.length) return { filas: 0, bloques: 0 };

    const sheet = getSheetByKey_(CFG.SURTIDO_SHEET_KEY, trace);

    // 1. Verificación de identidad con una sola lectura de la columna CODIGO.
    //    Va PRIMERO: si algo no coincide, la hoja no se modifica en absoluto
    //    (ni siquiera se agregan encabezados faltantes).
    const codeColumn = layout.columnIndex(layout.get(trace, false), "CODIGO") + 1;
    const minRow = list[0].rowNumber;
    const maxRow = list[list.length - 1].rowNumber;
    const codes = sheet.getRange(minRow, codeColumn, maxRow - minRow + 1, 1).getValues();
    list.forEach(function(item) {
      const actual = toStrUpper_(codes[item.rowNumber - minRow][0]);
      if (actual !== toStrUpper_(item.codigo)) {
        const error = new Error("La fila " + item.rowNumber + " ya no corresponde al código " + item.codigo + " (ahora: " + (actual || "vacía") + "). Actualiza el listado.");
        error.code = CFG.ERROR_CODES.FILA_CAMBIO;
        throw error;
      }
    });

    // 2. Estructura: agrega al final las columnas de captura que falten (BIN).
    const current = layout.get(trace, true);
    const columns = HEADERS.CAPTURA.map((header) => layout.columnIndex(current, header));

    // 3. Escritura: bloques de filas consecutivas si las columnas son contiguas.
    const sorted = columns.slice().sort((a, b) => a - b);
    const contiguous = sorted.every((value, i) => i === 0 || value === sorted[i - 1] + 1);
    const ordered = HEADERS.CAPTURA.slice().sort((a, b) => layout.columnIndex(current, a) - layout.columnIndex(current, b));
    let blocks = 0;
    if (contiguous) {
      let start = 0;
      while (start < list.length) {
        let end = start;
        while (end + 1 < list.length && list[end + 1].rowNumber === list[end].rowNumber + 1) end++;
        const block = list.slice(start, end + 1).map((item) => ordered.map((header) => item.valores[header] == null ? "" : item.valores[header]));
        sheet.getRange(list[start].rowNumber, sorted[0] + 1, block.length, sorted.length).setValues(block);
        blocks++;
        start = end + 1;
      }
    } else {
      list.forEach(function(item) {
        HEADERS.CAPTURA.forEach(function(header) {
          sheet.getRange(item.rowNumber, layout.columnIndex(current, header) + 1)
            .setValue(item.valores[header] == null ? "" : item.valores[header]);
        });
        blocks++;
      });
    }
    perfMark_(trace, "UBICSURT_CAPTURA_WRITTEN", { filas: list.length, bloques: blocks, contiguas: contiguous });
    return { filas: list.length, bloques: blocks };
  }

  /** Olvida la estructura leída (siguiente lectura vuelve a la hoja). */
  function clearCache() {
    layout.reset();
    return true;
  }

  return Object.freeze({
    getCatalogo,
    getFilas,
    writeCapturaUnderLock,
    clearCache
  });
})();
