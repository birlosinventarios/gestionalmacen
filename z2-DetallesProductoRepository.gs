/**
 * @fileoverview Repositorio de lectura y escritura de detalles de producto.
 *
 * Administra la hoja lógica DETALLES_PRODUCTOS, valida su contrato de encabezados,
 * normaliza entidades y expone consultas, upsert e inserción por lote.
 *
 * Dependencias globales:
 * - SHEETS.DETALLES_PRODUCTOS y COL.DETALLES_PRODUCTOS.
 * - getSpreadsheetByFileKey_(fileKey).
 * - toStr_(value), toStrUpper_(value) y toNum_(value).
 * - debugRepositoryCall_() y debugRepositoryMethods_().
 * - SpreadsheetApp y LockService de Google Apps Script.
 *
 * Reglas de mantenimiento:
 * - La fila 1 contiene encabezados; los datos comienzan en la fila 2.
 * - ID es la identidad utilizada por upsert() y no debe estar vacío.
 * - CODIGO es obligatorio para cualquier registro persistido.
 * - Las escrituras se protegen con ScriptLock y se confirman con flush().
 * - Crear la hoja automáticamente está permitido; sobrescribir encabezados con
 *   datos existentes no lo está, para evitar pérdida silenciosa de información.
 *
 * @author Sigifredo de la Cruz Ramos
 */
const DetallesProductoRepository = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    HEADER_ROW: 1,
    FIRST_DATA_ROW: 2,
    LOCK_TIMEOUT_MS: 30000,
    NOT_FOUND_ROW: -1
  });

  /** Contrato físico e inmutable de encabezados. @private @const */
  const HEADERS = Object.freeze([
    "ID",
    "CODIGO",
    "DESCRIPCION",
    "TIPOHILO",
    "HILO",
    "LARGOCUERPO",
    "LARGOCABEZA",
    "ANCHOCUERPO",
    "ANCHOCABEZA",
    "LARGOTOTAL",
    "ANCHOTOTAL",
    "PESOTEORICO",
    "ROSCADO",
    "LARGOROSCADO"
  ]);

  /**
   * Obtiene la hoja configurada y garantiza su contrato estructural.
   * @return {!GoogleAppsScript.Spreadsheet.Sheet}
   * @private
   */
  function _getSheet_() {
    const config = SHEETS.DETALLES_PRODUCTOS;
    if (!config) {
      throw new Error("No existe la configuración SHEETS.DETALLES_PRODUCTOS.");
    }

    const spreadsheet = getSpreadsheetByFileKey_(config.file);
    let sheet = spreadsheet.getSheetByName(config.name);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(config.name);
    }

    _ensureHeaders_(sheet);
    return sheet;
  }

  /**
   * Valida los encabezados y solo los crea cuando la hoja no contiene datos.
   * @param {!GoogleAppsScript.Spreadsheet.Sheet} sheet
   * @return {void}
   * @throws {Error} Si una hoja con datos tiene un contrato incompatible.
   * @private
   */
  function _ensureHeaders_(sheet) {
    const currentHeaders = sheet
      .getRange(CFG.HEADER_ROW, 1, 1, HEADERS.length)
      .getValues()[0];
    const areInvalid = HEADERS.some((header, index) =>
      toStrUpper_(currentHeaders[index]) !== header
    );

    if (!areInvalid) {
      sheet.setFrozenRows(CFG.HEADER_ROW);
      return;
    }

    const hasData = sheet.getLastRow() >= CFG.FIRST_DATA_ROW;
    if (hasData) {
      throw new Error(
        `La hoja "${sheet.getName()}" contiene datos y encabezados incompatibles`
      );
    }

    sheet
      .getRange(CFG.HEADER_ROW, 1, 1, HEADERS.length)
      .setValues([[...HEADERS]]);
    sheet.setFrozenRows(CFG.HEADER_ROW);
  }

  /**
   * Convierte una fila física al contrato normalizado del repositorio.
   * @param {!Array<*>} fila
   * @return {!Object}
   * @private
   */
  function _normalizarFila_(fila) {
    if (!Array.isArray(fila) || fila.length < HEADERS.length) {
      throw new TypeError("La fila de detalle de producto tiene un formato inválido");
    }
    return {
      ID: toStr_(fila[COL.DETALLES_PRODUCTOS.ID]),
      CODIGO: toStrUpper_(fila[COL.DETALLES_PRODUCTOS.CODIGO]),
      DESCRIPCION: toStrUpper_(fila[COL.DETALLES_PRODUCTOS.DESCRIPCION]),
      TIPOHILO: toStrUpper_(fila[COL.DETALLES_PRODUCTOS.TIPOHILO]),
      HILO: toNum_(fila[COL.DETALLES_PRODUCTOS.HILO]),
      LARGOCUERPO: toNum_(fila[COL.DETALLES_PRODUCTOS.LARGOCUERPO]),
      LARGOCABEZA: toNum_(fila[COL.DETALLES_PRODUCTOS.LARGOCABEZA]),
      ANCHOCUERPO: toNum_(fila[COL.DETALLES_PRODUCTOS.ANCHOCUERPO]),
      ANCHOCABEZA: toNum_(fila[COL.DETALLES_PRODUCTOS.ANCHOCABEZA]),
      LARGOTOTAL: toNum_(fila[COL.DETALLES_PRODUCTOS.LARGOTOTAL]),
      ANCHOTOTAL: toNum_(fila[COL.DETALLES_PRODUCTOS.ANCHOTOTAL]),
      PESOTEORICO: toNum_(fila[COL.DETALLES_PRODUCTOS.PESOTEORICO]),
      ROSCADO: toStrUpper_(fila[COL.DETALLES_PRODUCTOS.ROSCADO]),
      LARGOROSCADO: toNum_(fila[COL.DETALLES_PRODUCTOS.LARGOROSCADO])
    };
  }

  /**
   * Valida una entidad y la convierte en fila física.
   * @param {*} item
   * @param {string=} operationName
   * @return {!Array<*>}
   * @private
   */
  function _toRow_(item, operationName = "operación") {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError(`${operationName} requiere un objeto válido`);
    }
    if (!toStr_(item.ID)) {
      throw new Error(`${operationName} requiere item.ID`);
    }
    if (!toStrUpper_(item.CODIGO)) {
      throw new Error(`${operationName} requiere item.CODIGO`);
    }

    return [
      toStr_(item.ID),
      toStrUpper_(item.CODIGO),
      toStrUpper_(item.DESCRIPCION),
      toStrUpper_(item.TIPOHILO),
      toNum_(item.HILO),
      toNum_(item.LARGOCUERPO),
      toNum_(item.LARGOCABEZA),
      toNum_(item.ANCHOCUERPO),
      toNum_(item.ANCHOCABEZA),
      toNum_(item.LARGOTOTAL),
      toNum_(item.ANCHOTOTAL),
      toNum_(item.PESOTEORICO),
      toStrUpper_(item.ROSCADO),
      toNum_(item.LARGOROSCADO)
    ];
  }

  /** Devuelve todos los detalles válidos. @return {!Array<!Object>} */
  function getAll() {
    const hoja = _getSheet_();
    const lastRow = hoja.getLastRow();

    if (lastRow < CFG.FIRST_DATA_ROW) {
      return [];
    }

    const values = hoja
      .getRange(CFG.FIRST_DATA_ROW, 1, lastRow - CFG.HEADER_ROW, HEADERS.length)
      .getValues();

    return values
      .map(function (fila) {
        return _normalizarFila_(fila);
      })
      .filter(function (item) {
        return item.ID && item.CODIGO;
      });
  }

  /** Busca la primera coincidencia por ID. @param {*} id @return {?Object} */
  function getUnoPorId(id) {
    const idBuscado = toStr_(id);

    if (!idBuscado) {
      return null;
    }

    const rows = getAll();

    return rows.find(function (item) {
      return toStr_(item.ID) === idBuscado;
    }) || null;
  }

  /** Busca la primera coincidencia por código. @param {*} codigo @return {?Object} */
  function getUnoPorCodigo(codigo) {
    const codigoBuscado = toStrUpper_(codigo);

    if (!codigoBuscado) {
      return null;
    }

    const rows = getAll();

    return rows.find(function (item) {
      return toStrUpper_(item.CODIGO) === codigoBuscado;
    }) || null;
  }

  /** Busca todas las coincidencias por ID. @param {*} id @return {!Array<!Object>} */
  function getPorId(id) {
    const idBuscado = toStr_(id);

    if (!idBuscado) {
      return [];
    }

    return getAll().filter(function (item) {
      return toStr_(item.ID) === idBuscado;
    });
  }

  /** Busca todas las coincidencias por código. @param {*} codigo @return {!Array<!Object>} */
  function getPorCodigo(codigo) {
    const codigoBuscado = toStrUpper_(codigo);

    if (!codigoBuscado) {
      return [];
    }

    return getAll().filter(function (item) {
      return toStrUpper_(item.CODIGO) === codigoBuscado;
    });
  }

  /**
   * Localiza la fila física correspondiente a un ID.
   * @param {*} id
   * @param {GoogleAppsScript.Spreadsheet.Sheet=} sheet
   * @return {number} Fila base uno o CFG.NOT_FOUND_ROW.
   * @private
   */
  function _findRowById_(id, sheet) {
    const hoja = sheet || _getSheet_();
    const lastRow = hoja.getLastRow();
    const idBuscado = toStr_(id);

    if (!idBuscado || lastRow < 2) {
      return CFG.NOT_FOUND_ROW;
    }

    const values = hoja
      .getRange(
        CFG.FIRST_DATA_ROW,
        COL.DETALLES_PRODUCTOS.ID + 1,
        lastRow - CFG.HEADER_ROW,
        1
      )
      .getValues();

    for (let i = 0; i < values.length; i++) {
      const idActual = toStr_(values[i][0]);

      if (idActual === idBuscado) {
        return i + CFG.FIRST_DATA_ROW;
      }
    }

    return CFG.NOT_FOUND_ROW;
  }

  /** Indica si existe un registro por ID. @param {*} id @return {boolean} */
  function existePorId(id) {
    return _findRowById_(id) > 0;
  }

  /** Crea o actualiza un detalle bajo bloqueo. @param {!Object} item @return {!Object} */
  function upsert(item) {
    const row = _toRow_(item, "upsert()");
    const lock = LockService.getScriptLock();
    lock.waitLock(CFG.LOCK_TIMEOUT_MS);

    try {
      const sheet = _getSheet_();
      const rowNumber = _findRowById_(item.ID, sheet);
      let action;
      let persistedRow;

      if (rowNumber > 0) {
        sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([row]);
        action = "ACTUALIZADO";
        persistedRow = rowNumber;
      } else {
        persistedRow = sheet.getLastRow() + 1;
        sheet.getRange(persistedRow, 1, 1, HEADERS.length).setValues([row]);
        action = "CREADO";
      }

      SpreadsheetApp.flush();
      return {
        ok: true,
        accion: action,
        rowNumber: persistedRow,
        item: _normalizarFila_(row)
      };
    } finally {
      lock.releaseLock();
    }
  }

  /** Inserta un lote validado en una sola escritura. @param {!Array<!Object>} items @return {!Object} */
  function insertarLote(items) {
    if (!Array.isArray(items)) {
      throw new TypeError("insertarLote() requiere un arreglo");
    }
    if (items.length === 0) {
      return { ok: true, insertados: 0 };
    }

    const rows = items.map((item, index) =>
      _toRow_(item, `insertarLote()[${index}]`)
    );
    const lock = LockService.getScriptLock();
    lock.waitLock(CFG.LOCK_TIMEOUT_MS);

    try {
      const sheet = _getSheet_();
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, HEADERS.length).setValues(rows);
      SpreadsheetApp.flush();
      return { ok: true, insertados: rows.length, startRow };
    } finally {
      lock.releaseLock();
    }
  }

  /** Ejecuta una lectura instrumentada para diagnóstico. @return {*} */
  function debugGetAll() {
    return debugRepositoryCall_(
      "DetallesProductoRepository.getAll",
      {},
      function () {
        return getAll();
      },
      {
        limit: 10
      }
    );
  }

  /** Describe los métodos públicos mediante la utilidad de diagnóstico. @return {*} */
  function debugMethods() {
    return debugRepositoryMethods_(
      "DetallesProductoRepository",
      DetallesProductoRepository
    );
  }

  return Object.freeze({
    getAll,
    getUnoPorId,
    getUnoPorCodigo,
    getPorId,
    getPorCodigo,
    existePorId,
    upsert,
    insertarLote,
    debugGetAll,
    debugMethods
  });

})();