/**
 * z2-AdminExcedentesRepository.gs
 *
 * @fileoverview Acceso a hojas para la Administración de estados de excedentes.
 *
 * Este repositorio concentra las lecturas y escrituras FÍSICAS que necesita
 * AdminExcedentesService para corregir el estado de una etiqueta (IDUNICO):
 *
 *   Hoja                         Lectura                      Escritura
 *   ──────────────────────────── ──────────────────────────── ─────────────────────────────
 *   BD-EXCEDENTES                filas del IDUNICO            STATUS de la fila activa
 *   Bitacora-TRASPASOS           movimientos del IDUNICO      vaciar la fila revertida
 *   ADMIN_EXCEDENTES_BITACORA    —                            una fila por cambio aplicado
 *
 * Las lecturas de EXISTENCIAS / BITACORA-SINCRONIZACION-EXISTENCIAS viven en
 * ExistenciasRepository y las de REABASTECIMIENTO_DETALLES en su repositorio,
 * porque esos módulos son dueños de sus reglas.
 *
 * DECISIONES DE DISEÑO
 * - Búsqueda dirigida: TextFinder sobre la columna IDUNICO (celda completa) y
 *   lectura solo de las filas encontradas. Nunca se lee la hoja completa.
 * - Respaldo: cada lectura conserva la fila cruda (values) para guardarla en la
 *   bitácora de administración antes de modificarla.
 * - VACIAR EN LUGAR DE ELIMINAR (Bitacora-TRASPASOS): la vista de Conciliación
 *   actualiza filas por número sin validar su contenido; eliminar una fila
 *   desplazaría a las siguientes y esas escrituras caerían en filas ajenas.
 *   Vaciar el contenido conserva la numeración y, como TraspasosRepository y
 *   EstadoActualExcedentesService descartan filas sin datos/IDUNICO, el
 *   movimiento deja de existir para todo el sistema.
 * - Verificación de identidad: toda escritura relee la fila y exige que siga
 *   siendo la esperada (IDUNICO, tipo, cantidad); si cambió, no escribe.
 * - Ninguna función adquiere el ScriptLock: lo toma el Service.
 *
 * Dependencias globales:
 * - getSheetByKey_(), getSpreadsheetByFileKey_(), perfMark_().
 * - toStr_(), toStrUpper_(), toNum_(), round2_().
 * - COL.EXCEDENTES, COL.TRASPASOS, SHEETS, ADMIN_EXCEDENTES_BITACORA_HEADERS,
 *   ADMIN_EXCEDENTES_CONFIG.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version ADMIN-EXCEDENTES-REPOSITORY-2026-11-20-01
 */

const AdminExcedentesRepository = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    EXCEDENTES_KEY: "EXCEDENTES",
    TRASPASOS_KEY: "TRASPASOS",
    BITACORA_KEY: "ADMIN_EXCEDENTES_BITACORA",
    HEADER_ROW: 1,
    FIRST_DATA_ROW: 2,
    LOG_PREFIX: "[AdminExcedentesRepository]"
  });

  // ==========================================================================
  // UTILIDADES DE FORMATO
  // ==========================================================================

  /** dd/MM/yyyy de una fecha válida ("" si no lo es). @private */
  function formatDate_(value) {
    if (!(value instanceof Date) || isNaN(value.getTime())) return toStr_(value);
    return [
      String(value.getDate()).padStart(2, "0"),
      String(value.getMonth() + 1).padStart(2, "0"),
      value.getFullYear()
    ].join("/");
  }

  /** HH:mm:ss de una hora válida ("" si no lo es). @private */
  function formatTime_(value) {
    if (!(value instanceof Date) || isNaN(value.getTime())) return toStr_(value);
    return [
      String(value.getHours()).padStart(2, "0"),
      String(value.getMinutes()).padStart(2, "0"),
      String(value.getSeconds()).padStart(2, "0")
    ].join(":");
  }

  /**
   * Marca de tiempo comparable de fecha + hora (mismo criterio que
   * EstadoActualExcedentesService para decidir el "último" movimiento).
   * @private
   */
  function timestamp_(fecha, hora) {
    const day = fecha instanceof Date ? fecha.getTime() : 0;
    const time = hora instanceof Date
      ? hora.getHours() * 3600000 + hora.getMinutes() * 60000 + hora.getSeconds() * 1000
      : 0;
    return day + time;
  }

  /** Copia JSON-segura de una fila cruda (fechas → texto ISO). @private */
  function serializableRow_(values) {
    return (values || []).map(function(value) {
      return value instanceof Date ? value.toISOString() : value;
    });
  }

  /**
   * Filas cuyo valor en la columna IDUNICO coincide (celda completa).
   *
   * @param {string} sheetKey Clave de SHEETS.
   * @param {number} idColumnZeroBased Índice base cero de la columna IDUNICO.
   * @param {number} width Columnas a leer desde la columna 1.
   * @param {string} token IDUNICO buscado.
   * @return {!Array<{rowNumber:number, values:!Array<*>}>}
   * @private
   */
  function findRowsById_(sheetKey, idColumnZeroBased, width, token) {
    const sheet = getSheetByKey_(sheetKey);
    const lastRow = sheet.getLastRow();
    if (lastRow < CFG.FIRST_DATA_ROW || !token) return [];
    return sheet
      .getRange(CFG.FIRST_DATA_ROW, idColumnZeroBased + 1, lastRow - CFG.HEADER_ROW, 1)
      .createTextFinder(token)
      .matchEntireCell(true)
      .matchCase(false)
      .findAll()
      .map(function(cell) {
        const rowNumber = cell.getRow();
        return { rowNumber: rowNumber, values: sheet.getRange(rowNumber, 1, 1, width).getValues()[0] };
      })
      .filter(function(entry) {
        return toStrUpper_(entry.values[idColumnZeroBased]) === toStrUpper_(token);
      })
      .sort(function(a, b) { return a.rowNumber - b.rowNumber; });
  }

  // ==========================================================================
  // BD-EXCEDENTES
  // ==========================================================================

  /** Columnas leídas de BD-EXCEDENTES (hasta la última requerida). @private */
  function excedentesWidth_() {
    const C = COL.EXCEDENTES;
    return Math.max(C.IDUNICO, C.FECHA, C.HORA, C.IDPRODUCTO, C.CODIGO, C.DESCRIPCION, C.CANTIDAD, C.STATUS, C.RESPONSABLEIMPRESION) + 1;
  }

  /**
   * Filas de BD-EXCEDENTES de un IDUNICO, en orden físico.
   *
   * La "fila activa" (la que se actualiza) es la ÚLTIMA física, el mismo
   * criterio que usa Traspasos al cambiar STATUS.
   *
   * @param {*} idUnico Etiqueta.
   * @return {!Array<!Object>} Filas normalizadas con values crudos.
   */
  function getExcedenteRows(idUnico) {
    const C = COL.EXCEDENTES;
    const token = toStr_(idUnico);
    return findRowsById_(CFG.EXCEDENTES_KEY, C.IDUNICO, excedentesWidth_(), token).map(function(entry) {
      const row = entry.values;
      return {
        rowNumber: entry.rowNumber,
        idUnico: toStr_(row[C.IDUNICO]),
        fecha: formatDate_(row[C.FECHA]),
        hora: formatTime_(row[C.HORA]),
        ts: timestamp_(row[C.FECHA], row[C.HORA]),
        idproducto: toStr_(row[C.IDPRODUCTO]),
        codigo: toStrUpper_(row[C.CODIGO]),
        descripcion: toStrUpper_(row[C.DESCRIPCION]),
        cantidad: Math.abs(toNum_(row[C.CANTIDAD])),
        status: toStrUpper_(row[C.STATUS]),
        responsableImpresion: toStrUpper_(row[C.RESPONSABLEIMPRESION]),
        values: serializableRow_(row)
      };
    });
  }

  /**
   * Actualiza STATUS de una fila de BD-EXCEDENTES tras verificar su identidad.
   * El Service DEBE tener el ScriptLock.
   *
   * @param {number} rowNumber Fila física.
   * @param {string} idUnico IDUNICO esperado en esa fila.
   * @param {string} expectedStatus STATUS que debe tener ahora (control de concurrencia).
   * @param {string} newStatus STATUS nuevo.
   * @return {{rowNumber:number, antes:string, despues:string}}
   */
  function updateExcedenteStatusUnderLock(rowNumber, idUnico, expectedStatus, newStatus) {
    const C = COL.EXCEDENTES;
    const sheet = getSheetByKey_(CFG.EXCEDENTES_KEY);
    const row = sheet.getRange(rowNumber, 1, 1, excedentesWidth_()).getValues()[0];
    if (toStrUpper_(row[C.IDUNICO]) !== toStrUpper_(idUnico)) {
      throw new Error("La fila " + rowNumber + " de BD-EXCEDENTES ya no corresponde a " + idUnico + ".");
    }
    if (toStrUpper_(row[C.STATUS]) !== toStrUpper_(expectedStatus)) {
      throw new Error("El STATUS de " + idUnico + " cambió durante la operación. Vuelve a consultar.");
    }
    sheet.getRange(rowNumber, C.STATUS + 1).setValue(toStrUpper_(newStatus));
    return { rowNumber: rowNumber, antes: toStrUpper_(expectedStatus), despues: toStrUpper_(newStatus) };
  }

  // ==========================================================================
  // BITACORA-TRASPASOS
  // ==========================================================================

  /** Columnas leídas de la bitácora (incluye conciliación para el respaldo). @private */
  function traspasosWidth_() {
    return COL.TRASPASOS.HORARESPUESTA + 1;
  }

  /**
   * Movimientos de un IDUNICO en orden cronológico (fecha + hora y, a igual
   * marca, fila física), igual que EstadoActualExcedentesService.
   *
   * @param {*} idUnico Etiqueta.
   * @return {!Array<!Object>} Movimientos normalizados con values crudos.
   */
  function getTraspasoRows(idUnico) {
    const C = COL.TRASPASOS;
    const token = toStr_(idUnico);
    return findRowsById_(CFG.TRASPASOS_KEY, C.IDUNICO, traspasosWidth_(), token)
      .map(function(entry) {
        const row = entry.values;
        return {
          fila: entry.rowNumber,
          fecha: formatDate_(row[C.FECHA]),
          hora: formatTime_(row[C.HORA]),
          ts: timestamp_(row[C.FECHA], row[C.HORA]),
          tipo: toStrUpper_(row[C.TIPOMOVIMIENTO]),
          serie: toStrUpper_(row[C.SERIE]),
          bodegaSalida: toStrUpper_(row[C.BODEGA_SALIDA]),
          ubicacionSalida: toStrUpper_(row[C.UBICACION_SALIDA]),
          bodegaEntrada: toStrUpper_(row[C.BODEGA_ENTRADA]),
          ubicacionEntrada: toStrUpper_(row[C.UBICACION_ENTRADA]),
          solicitante: toStrUpper_(row[C.SOLICITANTE]),
          codigo: toStrUpper_(row[C.CODIGO]),
          descripcion: toStrUpper_(row[C.DESCRIPCION]),
          cantidad: toNum_(row[C.CANTIDAD]),
          folio: toStr_(row[C.FOLIO]),
          responsable: toStrUpper_(row[C.RESPONSABLE]),
          idUnico: toStr_(row[C.IDUNICO]),
          values: serializableRow_(row)
        };
      })
      .sort(function(a, b) { return (a.ts - b.ts) || (a.fila - b.fila); });
  }

  /**
   * Comprueba, sin escribir, que una fila de la bitácora siga siendo el
   * movimiento esperado. Lanza error si no.
   *
   * @param {{fila:number, idUnico:string, tipo:string, cantidad:number}} expected
   * @return {!Array<*>} Valores actuales de la fila.
   */
  function assertTraspasoRow(expected) {
    const C = COL.TRASPASOS;
    const sheet = getSheetByKey_(CFG.TRASPASOS_KEY);
    const row = sheet.getRange(expected.fila, 1, 1, traspasosWidth_()).getValues()[0];
    const same =
      toStrUpper_(row[C.IDUNICO]) === toStrUpper_(expected.idUnico) &&
      toStrUpper_(row[C.TIPOMOVIMIENTO]) === toStrUpper_(expected.tipo) &&
      round2_(toNum_(row[C.CANTIDAD])) === round2_(toNum_(expected.cantidad));
    if (!same) {
      throw new Error("El movimiento de la fila " + expected.fila + " de Bitacora-TRASPASOS cambió. Vuelve a consultar.");
    }
    return row;
  }

  /**
   * Vacía una fila de Bitacora-TRASPASOS (ver "VACIAR EN LUGAR DE ELIMINAR").
   * El Service DEBE tener el ScriptLock y haber validado con assertTraspasoRow.
   *
   * @param {{fila:number, idUnico:string, tipo:string, cantidad:number}} expected
   * @return {{fila:number, respaldo:!Array<*>}}
   */
  function clearTraspasoRowUnderLock(expected) {
    const row = assertTraspasoRow(expected);
    getSheetByKey_(CFG.TRASPASOS_KEY).getRange(expected.fila, 1, 1, traspasosWidth_()).clearContent();
    return { fila: expected.fila, respaldo: serializableRow_(row) };
  }

  // ==========================================================================
  // BITÁCORA DE ADMINISTRACIÓN
  // ==========================================================================

  /** Hoja ADMIN_EXCEDENTES_BITACORA; la crea con encabezados si no existe. @private */
  function bitacoraSheet_() {
    const descriptor = SHEETS[CFG.BITACORA_KEY];
    const spreadsheet = getSpreadsheetByFileKey_(descriptor.file);
    let sheet = spreadsheet.getSheetByName(descriptor.name);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(descriptor.name);
      sheet.getRange(1, 1, 1, ADMIN_EXCEDENTES_BITACORA_HEADERS.length)
        .setValues([ADMIN_EXCEDENTES_BITACORA_HEADERS.slice()]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  /** Texto JSON acotado al límite de una celda. @private */
  function jsonCell_(value) {
    if (value == null || value === "") return "";
    let text;
    try {
      text = typeof value === "string" ? value : JSON.stringify(value);
    } catch (error) {
      text = String(value);
    }
    const max = Number(ADMIN_EXCEDENTES_CONFIG.MAX_JSON_CELL_CHARS || 45000);
    return text.length > max ? text.slice(0, max) + "…[TRUNCADO]" : text;
  }

  /**
   * Agrega una fila a la bitácora de administración (appendRow es atómico).
   *
   * @param {!Object} record Campos con los nombres de ADMIN_EXCEDENTES_BITACORA_HEADERS
   *     en minúsculas camelCase (fecha, hora, responsable, correo, accion,
   *     idUnico, codigo, statusAnterior, statusNuevo, saldoAnterior, saldoNuevo,
   *     movimientosRevertidos, existenciasAjustadas, reabDetallesEliminados,
   *     motivo, advertencias, respaldo).
   * @return {boolean} true si se escribió.
   */
  function appendBitacora(record) {
    const r = record || {};
    bitacoraSheet_().appendRow([
      r.fecha || "",
      r.hora || "",
      toStrUpper_(r.responsable),
      toStr_(r.correo),
      toStrUpper_(r.accion),
      toStr_(r.idUnico),
      toStrUpper_(r.codigo),
      toStrUpper_(r.statusAnterior),
      toStrUpper_(r.statusNuevo),
      r.saldoAnterior == null ? "" : r.saldoAnterior,
      r.saldoNuevo == null ? "" : r.saldoNuevo,
      r.movimientosRevertidos == null ? "" : r.movimientosRevertidos,
      r.existenciasAjustadas == null ? "" : r.existenciasAjustadas,
      r.reabDetallesEliminados == null ? "" : r.reabDetallesEliminados,
      toStr_(r.motivo),
      jsonCell_(r.advertencias),
      jsonCell_(r.respaldo)
    ]);
    return true;
  }

  return Object.freeze({
    getExcedenteRows,
    updateExcedenteStatusUnderLock,
    getTraspasoRows,
    assertTraspasoRow,
    clearTraspasoRowUnderLock,
    appendBitacora
  });
})();
