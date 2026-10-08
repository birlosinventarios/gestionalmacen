/**
 * 
 * z2-AuditoriaExcedentesDetalleRepository.gs
 * 
 * @fileoverview Repositorio de persistencia para el detalle de auditorías de excedentes.
 *
 * Encapsula el acceso a la hoja configurada como AUDITORIA_EXCEDENTES_DETALLE y
 * expone operaciones de consulta, alta, actualización y eliminación. El módulo
 * conserva una caché en memoria por ejecución para reducir lecturas repetidas y
 * utiliza ScriptLock en las operaciones de escritura para evitar colisiones.
 *
 * Dependencias globales:
 * - FILES, SHEETS y COL, declaradas en CONSTANTS.gs.
 * - SpreadsheetApp y LockService, proporcionados por Google Apps Script.
 *
 * Consideraciones de mantenimiento:
 * - Los índices de COL son base cero, mientras que las filas de Sheets son base uno.
 * - La fila 1 se reserva para encabezados; los datos comienzan en la fila 2.
 * - Toda escritura invalida la caché después de completar SpreadsheetApp.flush().
 * - Los objetos públicos son copias defensivas y no deben modificar el estado interno.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const AuditoriaExcedentesDetalleRepository = (() => {

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    SHEET_KEY: "AUDITORIA_EXCEDENTES_DETALLE",
    HEADER_ROWS: 1,
    FIRST_DATA_ROW: 2,
    LOCK_TIMEOUT_MS: 30000
  });

  /**
   * Caché local de registros normalizados. `null` indica que todavía no se carga.
   * @private
   * @type {?Array<!Object>}
   */
  let cache_ = null;

  // ---------------------------------------------------------------------------
  // Infraestructura y normalización
  // ---------------------------------------------------------------------------
  /** Obtiene y valida la definición física de la hoja. @return {!Object} @private */
  function _sheetDef_() {
    const def = SHEETS[CFG.SHEET_KEY];
    if (!def) {
      throw new Error(`No existe SHEETS.${CFG.SHEET_KEY} en CONSTANTS.gs`);
    }
    return def;
  }

  /** Obtiene y valida el contrato de columnas. @return {!Object<string, number>} @private */
  function _colDef_() {
    const def = COL[CFG.SHEET_KEY];
    if (!def) {
      throw new Error(`No existe COL.${CFG.SHEET_KEY} en CONSTANTS.gs`);
    }
    return def;
  }

  /** Abre la hoja configurada. @return {!GoogleAppsScript.Spreadsheet.Sheet} @private */
  function _sheet_() {
    const def = _sheetDef_();
    const fileId = FILES[def.file];

    if (!fileId) {
      throw new Error(`No existe FILES.${def.file} en CONSTANTS.gs`);
    }

    const ss = SpreadsheetApp.openById(fileId);
    const sh = ss.getSheetByName(def.name);

    if (!sh) {
      throw new Error(`No se encontró la hoja "${def.name}" en FILES.${def.file}`);
    }

    return sh;
  }

  /** Normaliza un valor como texto sin espacios exteriores. @param {*} value @return {string} @private */
  function _toStr_(value) {
    return String(value == null ? "" : value).trim();
  }

  /** Normaliza texto en mayúsculas. @param {*} value @return {string} @private */
  function _toUpper_(value) {
    return _toStr_(value).toUpperCase();
  }

  /** Convierte un valor numérico; devuelve cero si no es válido. @param {*} value @return {number} @private */
  function _toNum_(value) {
    if (value === "" || value == null) return 0;
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  /** Interpreta representaciones admitidas de verdadero. @param {*} value @return {boolean} @private */
  function _toBool_(value) {
    const v = _toUpper_(value);
    return v === "TRUE" || v === "VERDADERO" || value === true || value === 1 || value === "1";
  }

  /** Crea una copia defensiva serializable. @param {*} obj @return {*} @private */
  function _clone_(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** Normaliza el identificador de auditoría. @param {*} value @return {string} @private */
  function _normalizeId_(value) {
    return _toStr_(value);
  }

  /** Normaliza una ubicación para comparaciones. @param {*} value @return {string} @private */
  function _normalizeUbicacion_(value) {
    return _toUpper_(value);
  }

  /** Normaliza el identificador único escaneado. @param {*} value @return {string} @private */
  function _normalizeIdUnico_(value) {
    return _toStr_(value);
  }

  /** Calcula el ancho físico requerido por el contrato de columnas. @return {number} @private */
  function _maxColIndex_() {
    return Math.max(...Object.values(_colDef_())) + 1;
  }

  /** Construye una fila vacía con el ancho contractual. @return {!Array<*>} @private */
  function _blankRow_() {
    return Array(_maxColIndex_()).fill("");
  }

  /** Lee todas las filas de datos, sin incluir encabezados. @return {!Array<!Array<*>>} @private */
  function _readValues_() {
    const sh = _sheet_();
    const lastRow = sh.getLastRow();
    const maxCol = _maxColIndex_();

    if (lastRow < CFG.FIRST_DATA_ROW) {
      return [];
    }

    return sh.getRange(CFG.FIRST_DATA_ROW, 1, lastRow - CFG.HEADER_ROWS, maxCol).getValues();
  }

  /** Convierte una fila física en entidad normalizada. @param {!Array<*>} row @param {number} rowNumber @return {!Object} @private */
  function _rowToObj_(row, rowNumber) {
    const C = _colDef_();

    return {
      _rowNumber: rowNumber,

      idauditoria: _toStr_(row[C.IDAUDITORIA]),
      secuenciaubicacion: _toNum_(row[C.SECUENCIA_UBICACION]),
      bodega: _toUpper_(row[C.BODEGA]),
      ubicacion: _toUpper_(row[C.UBICACION]),
      horainicioubicacion: row[C.HORAINICIO_UBICACION] || "",
      horafinubicacion: row[C.HORAFIN_UBICACION] || "",
      idunico: _toStr_(row[C.IDUNICO]),
      codigo: _toUpper_(row[C.CODIGO]),
      descripcion: _toUpper_(row[C.DESCRIPCION]),
      horaescaneoidunico: row[C.HORAESCANEO_IDUNICO] || "",
      escorrecto: _toBool_(row[C.ESCORRECTO]),
      esfaltante: _toBool_(row[C.ESFALTANTE]),
      essobrante: _toBool_(row[C.ESSOBRANTE]),
      observaciones: _toStr_(row[C.OBSERVACIONES])
    };
  }

  /** Convierte una entidad en fila física, preservando columnas existentes. @param {!Object} obj @param {Array<*>=} existingRow @return {!Array<*>} @private */
  function _objToRow_(obj, existingRow) {
    const C = _colDef_();
    const row = existingRow ? [...existingRow] : _blankRow_();

    row[C.IDAUDITORIA] = _toStr_(obj.idauditoria);
    row[C.SECUENCIA_UBICACION] = obj.secuenciaubicacion != null ? obj.secuenciaubicacion : "";
    row[C.BODEGA] = _toUpper_(obj.bodega);
    row[C.UBICACION] = _toUpper_(obj.ubicacion);
    row[C.HORAINICIO_UBICACION] = obj.horainicioubicacion || "";
    row[C.HORAFIN_UBICACION] = obj.horafinubicacion || "";
    row[C.IDUNICO] = _toStr_(obj.idunico);
    row[C.CODIGO] = _toUpper_(obj.codigo);
    row[C.DESCRIPCION] = _toUpper_(obj.descripcion);
    row[C.HORAESCANEO_IDUNICO] = obj.horaescaneoidunico || "";
    row[C.ESCORRECTO] = obj.escorrecto === true;
    row[C.ESFALTANTE] = obj.esfaltante === true;
    row[C.ESSOBRANTE] = obj.essobrante === true;
    row[C.OBSERVACIONES] = _toStr_(obj.observaciones);

    return row;
  }

  /**
   * Valida y normaliza un payload antes de persistirlo.
   * @param {*} payload
   * @param {string} operationName
   * @return {!Object}
   * @private
   */
  function _normalizePayload_(payload, operationName) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError(`${operationName} requiere un objeto de datos válido`);
    }

    const normalized = {
      idauditoria: _toStr_(payload.idauditoria),
      secuenciaubicacion:
        payload.secuenciaubicacion != null ? payload.secuenciaubicacion : "",
      bodega: payload.bodega || "",
      ubicacion: payload.ubicacion || "",
      horainicioubicacion: payload.horainicioubicacion || "",
      horafinubicacion: payload.horafinubicacion || "",
      idunico: payload.idunico || "",
      codigo: payload.codigo || "",
      descripcion: payload.descripcion || "",
      horaescaneoidunico: payload.horaescaneoidunico || "",
      escorrecto: payload.escorrecto === true,
      esfaltante: payload.esfaltante === true,
      essobrante: payload.essobrante === true,
      observaciones: payload.observaciones || ""
    };

    if (!normalized.idauditoria) {
      throw new Error(`${operationName} requiere payload.idauditoria`);
    }
    return normalized;
  }

  /** Carga la caché de forma diferida. @return {void} @private */
  function _ensureCache_() {
    if (cache_ !== null) return;

    const values = _readValues_();
    cache_ = values
      .map((row, idx) => _rowToObj_(row, idx + CFG.FIRST_DATA_ROW))
      .filter(item => item.idauditoria);

    console.log("[CACHE] AuditoriaExcedentesDetalleRepository cargado", {
      total: cache_.length
    });
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------
  /** Devuelve todos los registros almacenados. @return {!Array<!Object>} */
  function getAll() {
    _ensureCache_();
    return _clone_(cache_);
  }

  /** Busca registros de una auditoría. @param {*} idAuditoria @return {!Array<!Object>} */
  function getByIdAuditoria(idAuditoria) {
    _ensureCache_();
    const id = _normalizeId_(idAuditoria);
    return _clone_(cache_.filter(x => _normalizeId_(x.idauditoria) === id));
  }

  /** Busca registros por auditoría y ubicación. @param {*} idAuditoria @param {*} ubicacion @return {!Array<!Object>} */
  function getByAuditoriaYUbicacion(idAuditoria, ubicacion) {
    _ensureCache_();
    const id = _normalizeId_(idAuditoria);
    const ubi = _normalizeUbicacion_(ubicacion);

    return _clone_(
      cache_.filter(x =>
        _normalizeId_(x.idauditoria) === id &&
        _normalizeUbicacion_(x.ubicacion) === ubi
      )
    );
  }

  /** Devuelve únicamente registros con ID único escaneado. @param {*} idAuditoria @param {*} ubicacion @return {!Array<!Object>} */
  function getEscaneadosByAuditoriaYUbicacion(idAuditoria, ubicacion) {
    return getByAuditoriaYUbicacion(idAuditoria, ubicacion)
      .filter(x => x.idunico);
  }

  /** Localiza un escaneo dentro de una auditoría. @param {*} idAuditoria @param {*} idUnico @return {?Object} */
  function findEscaneo(idAuditoria, idUnico) {
    _ensureCache_();
    const id = _normalizeId_(idAuditoria);
    const idu = _normalizeIdUnico_(idUnico);

    const found = cache_.find(x =>
      _normalizeId_(x.idauditoria) === id &&
      _normalizeIdUnico_(x.idunico) === idu
    );

    return found ? _clone_(found) : null;
  }

  /** Localiza un escaneo por auditoría, ubicación e ID único. @param {*} idAuditoria @param {*} ubicacion @param {*} idUnico @return {?Object} */
  function findEscaneoEnUbicacion(idAuditoria, ubicacion, idUnico) {
    _ensureCache_();
    const id = _normalizeId_(idAuditoria);
    const ubi = _normalizeUbicacion_(ubicacion);
    const idu = _normalizeIdUnico_(idUnico);

    const found = cache_.find(x =>
      _normalizeId_(x.idauditoria) === id &&
      _normalizeUbicacion_(x.ubicacion) === ubi &&
      _normalizeIdUnico_(x.idunico) === idu
    );

    return found ? _clone_(found) : null;
  }

  /** Inserta un registro bajo bloqueo de script. @param {!Object} payload @return {!Object} */
  function insert(payload) {
    const lock = LockService.getScriptLock();
    lock.waitLock(CFG.LOCK_TIMEOUT_MS);

    try {
      const obj = _normalizePayload_(payload, "insert()");
      const row = _objToRow_(obj);

      _sheet_().appendRow(row);
      SpreadsheetApp.flush();

      clearCache();

      return obj;

    } finally {
      lock.releaseLock();
    }
  }

  /** Inserta registros mediante una sola escritura por lote. @param {!Array<!Object>} payloads @return {!Array<!Object>} */
  function insertMany(payloads) {
    const lock = LockService.getScriptLock();
    lock.waitLock(CFG.LOCK_TIMEOUT_MS);

    try {
      const list = Array.isArray(payloads) ? payloads : [];
      if (!list.length) return [];

      const normalized = list.map((item, index) =>
        _normalizePayload_(item, `insertMany()[${index}]`)
      );
      const rows = normalized.map(item => _objToRow_(item));

      const sh = _sheet_();
      const startRow = sh.getLastRow() + 1;
      const maxCol = _maxColIndex_();

      sh.getRange(startRow, 1, rows.length, maxCol).setValues(rows);
      SpreadsheetApp.flush();

      clearCache();

      return payloads;

    } finally {
      lock.releaseLock();
    }
  }

  /** Actualiza una fila de datos existente. @param {number} rowNumber @param {!Object} patch @return {?Object} */
  function updateByRowNumber(rowNumber, patch) {
    const lock = LockService.getScriptLock();
    lock.waitLock(CFG.LOCK_TIMEOUT_MS);

    try {
      if (!Number.isInteger(rowNumber) || rowNumber < CFG.FIRST_DATA_ROW) {
        throw new RangeError(
          `updateByRowNumber() requiere una fila entera >= ${CFG.FIRST_DATA_ROW}`
        );
      }
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new TypeError("updateByRowNumber() requiere un objeto patch válido");
      }

      const sh = _sheet_();
      if (rowNumber > sh.getLastRow()) {
        throw new RangeError(`La fila ${rowNumber} no existe en la hoja de detalle`);
      }
      const maxCol = _maxColIndex_();
      const currentValues = sh.getRange(rowNumber, 1, 1, maxCol).getValues()[0];
      const current = _rowToObj_(currentValues, rowNumber);

      const merged = {
        ...current,
        ...patch
      };

      const newRow = _objToRow_(merged, currentValues);

      sh.getRange(rowNumber, 1, 1, maxCol).setValues([newRow]);
      SpreadsheetApp.flush();

      clearCache();

      const refreshed = getAll().find(x => x._rowNumber === rowNumber);
      return refreshed || null;

    } finally {
      lock.releaseLock();
    }
  }

  /** Elimina todos los registros de una auditoría. @param {*} idAuditoria @return {{idauditoria:string, eliminados:number}} */
  function deleteByIdAuditoria(idAuditoria) {
    const lock = LockService.getScriptLock();
    lock.waitLock(CFG.LOCK_TIMEOUT_MS);

    try {
      const id = _normalizeId_(idAuditoria);
      if (!id) {
        throw new Error("deleteByIdAuditoria() requiere idAuditoria");
      }
      const sh = _sheet_();
      const all = getAll();

      const rowsToDelete = all
        .filter(x => _normalizeId_(x.idauditoria) === id)
        .map(x => x._rowNumber)
        .sort((a, b) => b - a);

      rowsToDelete.forEach(rowNumber => sh.deleteRow(rowNumber));

      clearCache();

      return {
        idauditoria: id,
        eliminados: rowsToDelete.length
      };

    } finally {
      lock.releaseLock();
    }
  }

  /** Invalida la caché local. @return {boolean} */
  function clearCache() {
    cache_ = null;
    console.log("[CACHE] AuditoriaExcedentesDetalleRepository limpio");
    return true;
  }


  /** Consulta directamente la hoja, omitiendo la caché. @param {*} idAuditoria @return {!Array<!Object>} */
  function getByIdAuditoriaFresh(idAuditoria) {
    const id = _normalizeId_(idAuditoria);
    const values = _readValues_();

    return values
      .map((row, idx) => _rowToObj_(row, idx + CFG.FIRST_DATA_ROW))
      .filter(item =>
        item.idauditoria &&
        _normalizeId_(item.idauditoria) === id
      );
  }


  return {
    getAll,
    getByIdAuditoria,
    getByAuditoriaYUbicacion,
    getEscaneadosByAuditoriaYUbicacion,
    findEscaneo,
    findEscaneoEnUbicacion,
    insert,
    insertMany,
    updateByRowNumber,
    deleteByIdAuditoria,
    getByIdAuditoriaFresh,
    clearCache
  };

})();
