/**
 * AuditoriaExcedentesRepository.gs
 * 
 * @fileoverview Repositorio de cabeceras de auditorías de excedentes.
 *
 * Centraliza la persistencia y consulta de la hoja AUDITORIA_EXCEDENTES. Expone
 * operaciones de lectura, inserción, actualización y upsert, con caché local por
 * ejecución y bloqueo de script para proteger las escrituras concurrentes.
 *
 * Dependencias globales:
 * - FILES, SHEETS y COL, declaradas en CONSTANTS.gs.
 * - SpreadsheetApp y LockService, proporcionados por Google Apps Script.
 *
 * Reglas de mantenimiento:
 * - La fila 1 contiene encabezados y los datos comienzan en la fila 2.
 * - COL utiliza índices base cero; SpreadsheetApp utiliza filas y columnas base uno.
 * - IDAUDITORIA es la identidad inmutable del registro.
 * - Toda escritura debe invalidar la caché después de confirmar los cambios.
 * - La API pública devuelve copias defensivas para proteger el estado interno.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const AuditoriaExcedentesRepository = (() => {

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    SHEET_KEY: "AUDITORIA_EXCEDENTES",
    HEADER_ROWS: 1,
    FIRST_DATA_ROW: 2,
    LOCK_TIMEOUT_MS: 30000,
    STATUS: Object.freeze({
      ABIERTA: "ABIERTA",
      CERRADA: "CERRADA"
    })
  });

  /**
   * Caché de entidades normalizadas. `null` indica que aún no se ha cargado.
   * @private
   * @type {?Array<!Object>}
   */
  let cache_ = null;

  // ---------------------------------------------------------------------------
  // Infraestructura y normalización
  // ---------------------------------------------------------------------------
  /** Obtiene y valida la definición de la hoja. @return {!Object} @private */
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

  /** Convierte un valor a número finito; devuelve cero si no es válido. @param {*} value @return {number} @private */
  function _toNum_(value) {
    if (value === "" || value == null) return 0;
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  /** Crea una copia defensiva serializable. @param {*} obj @return {*} @private */
  function _clone_(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** Normaliza la identidad de auditoría. @param {*} value @return {string} @private */
  function _normalizeId_(value) {
    return _toStr_(value);
  }

  /** Calcula el ancho físico declarado en COL. @return {number} @private */
  function _maxColIndex_() {
    return Math.max(...Object.values(_colDef_())) + 1;
  }

  /** Crea una fila vacía con el ancho contractual. @return {!Array<*>} @private */
  function _blankRow_() {
    return Array(_maxColIndex_()).fill("");
  }

  /** Lee las filas de datos sin incluir encabezados. @return {!Array<!Array<*>>} @private */
  function _readValues_() {
    const sh = _sheet_();
    const lastRow = sh.getLastRow();
    const maxCol = _maxColIndex_();

    if (lastRow < CFG.FIRST_DATA_ROW) {
      return [];
    }

    return sh.getRange(CFG.FIRST_DATA_ROW, 1, lastRow - CFG.HEADER_ROWS, maxCol).getValues();
  }

  /** Convierte una fila física en entidad. @param {!Array<*>} row @param {number} rowNumber @return {!Object} @private */
  function _rowToObj_(row, rowNumber) {
    const C = _colDef_();

    return {
      _rowNumber: rowNumber,

      idauditoria: _toStr_(row[C.IDAUDITORIA]),
      fecha: row[C.FECHA] || "",
      horainicio: row[C.HORAINICIO] || "",
      horafin: row[C.HORAFIN] || "",
      duracionmin: _toNum_(row[C.DURACIONMIN]),
      auditor: _toUpper_(row[C.AUDITOR]),
      tipoauditoria: _toUpper_(row[C.TIPOAUDITORIA]),
      bodegaobjetivo: _toUpper_(row[C.BODEGAOBJETIVO]),
      estatus: _toUpper_(row[C.ESTATUS]),
      ubicacionesauditadas: _toNum_(row[C.UBICACIONESAUDITADAS]),
      ubicacionescondiferencia: _toNum_(row[C.UBICACIONESCONDIFERENCIA]),
      idunicosesperadostotales: _toNum_(row[C.IDUNICOS_ESPERADOS_TOTALES]),
      idunicosescaneadostotales: _toNum_(row[C.IDUNICOS_ESCANEADOS_TOTALES]),
      idunicoscorrectostotales: _toNum_(row[C.IDUNICOS_CORRECTOS_TOTALES]),
      idunicosfaltantestotales: _toNum_(row[C.IDUNICOS_FALTANTES_TOTALES]),
      idunicossobrantestotales: _toNum_(row[C.IDUNICOS_SOBRANTES_TOTALES]),
      confiabilidadtotal: _toNum_(row[C.CONFIABILIDAD_TOTAL]),
      observaciones: _toStr_(row[C.OBSERVACIONES])
    };
  }

  /** Convierte una entidad en fila física. @param {!Object} obj @param {Array<*>=} existingRow @return {!Array<*>} @private */
  function _objToRow_(obj, existingRow) {
    const C = _colDef_();
    const row = existingRow ? [...existingRow] : _blankRow_();

    row[C.IDAUDITORIA] = _toStr_(obj.idauditoria);
    row[C.FECHA] = obj.fecha || "";
    row[C.HORAINICIO] = obj.horainicio || "";
    row[C.HORAFIN] = obj.horafin || "";
    row[C.DURACIONMIN] = obj.duracionmin != null ? obj.duracionmin : "";
    row[C.AUDITOR] = _toUpper_(obj.auditor);
    row[C.TIPOAUDITORIA] = _toUpper_(obj.tipoauditoria);
    row[C.BODEGAOBJETIVO] = _toUpper_(obj.bodegaobjetivo);
    row[C.ESTATUS] = _toUpper_(obj.estatus);
    row[C.UBICACIONESAUDITADAS] = obj.ubicacionesauditadas != null ? obj.ubicacionesauditadas : "";
    row[C.UBICACIONESCONDIFERENCIA] = obj.ubicacionescondiferencia != null ? obj.ubicacionescondiferencia : "";
    row[C.IDUNICOS_ESPERADOS_TOTALES] = obj.idunicosesperadostotales != null ? obj.idunicosesperadostotales : "";
    row[C.IDUNICOS_ESCANEADOS_TOTALES] = obj.idunicosescaneadostotales != null ? obj.idunicosescaneadostotales : "";
    row[C.IDUNICOS_CORRECTOS_TOTALES] = obj.idunicoscorrectostotales != null ? obj.idunicoscorrectostotales : "";
    row[C.IDUNICOS_FALTANTES_TOTALES] = obj.idunicosfaltantestotales != null ? obj.idunicosfaltantestotales : "";
    row[C.IDUNICOS_SOBRANTES_TOTALES] = obj.idunicossobrantestotales != null ? obj.idunicossobrantestotales : "";
    row[C.CONFIABILIDAD_TOTAL] = obj.confiabilidadtotal != null ? obj.confiabilidadtotal : "";
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
      fecha: payload.fecha || "",
      horainicio: payload.horainicio || "",
      horafin: payload.horafin || "",
      duracionmin: payload.duracionmin != null ? payload.duracionmin : "",
      auditor: payload.auditor || "",
      tipoauditoria: payload.tipoauditoria || "",
      bodegaobjetivo: payload.bodegaobjetivo || "",
      estatus: payload.estatus || "",
      ubicacionesauditadas:
        payload.ubicacionesauditadas != null ? payload.ubicacionesauditadas : "",
      ubicacionescondiferencia:
        payload.ubicacionescondiferencia != null
          ? payload.ubicacionescondiferencia
          : "",
      idunicosesperadostotales:
        payload.idunicosesperadostotales != null
          ? payload.idunicosesperadostotales
          : "",
      idunicosescaneadostotales:
        payload.idunicosescaneadostotales != null
          ? payload.idunicosescaneadostotales
          : "",
      idunicoscorrectostotales:
        payload.idunicoscorrectostotales != null
          ? payload.idunicoscorrectostotales
          : "",
      idunicosfaltantestotales:
        payload.idunicosfaltantestotales != null
          ? payload.idunicosfaltantestotales
          : "",
      idunicossobrantestotales:
        payload.idunicossobrantestotales != null
          ? payload.idunicossobrantestotales
          : "",
      confiabilidadtotal:
        payload.confiabilidadtotal != null ? payload.confiabilidadtotal : "",
      observaciones: payload.observaciones || ""
    };

    if (!normalized.idauditoria) {
      throw new Error(`${operationName} requiere payload.idauditoria`);
    }
    return normalized;
  }

  /** Carga la caché bajo demanda. @return {void} @private */
  function _ensureCache_() {
    if (cache_ !== null) return;

    const values = _readValues_();
    cache_ = values
      .map((row, idx) => _rowToObj_(row, idx + CFG.FIRST_DATA_ROW))
      .filter(item => item.idauditoria);

    console.log("[CACHE] AuditoriaExcedentesRepository cargado", {
      total: cache_.length
    });
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------
  /** Devuelve todas las auditorías almacenadas. @return {!Array<!Object>} */
  function getAll() {
    _ensureCache_();
    return _clone_(cache_);
  }

  /** Busca una auditoría por identidad. @param {*} idAuditoria @return {?Object} */
  function getByIdAuditoria(idAuditoria) {
    _ensureCache_();
    const id = _normalizeId_(idAuditoria);
    const found = cache_.find(x => _normalizeId_(x.idauditoria) === id);
    return found ? _clone_(found) : null;
  }

  /** Devuelve las auditorías con estado ABIERTA. @return {!Array<!Object>} */
  function getAbiertas() {
    _ensureCache_();
    return _clone_(cache_.filter(x => _toUpper_(x.estatus) === CFG.STATUS.ABIERTA));
  }

  /** Devuelve las auditorías con estado CERRADA. @return {!Array<!Object>} */
  function getCerradas() {
    _ensureCache_();
    return _clone_(cache_.filter(x => _toUpper_(x.estatus) === CFG.STATUS.CERRADA));
  }

  /** Indica si existe una auditoría. @param {*} idAuditoria @return {boolean} */
  function exists(idAuditoria) {
    return !!getByIdAuditoria(idAuditoria);
  }

  /** Inserta una auditoría nueva. @param {!Object} payload @return {!Object} */
  function insert(payload) {
    const lock = LockService.getScriptLock();
    lock.waitLock(CFG.LOCK_TIMEOUT_MS);

    try {
      const obj = _normalizePayload_(payload, "insert()");


      if (exists(obj.idauditoria)) {
        throw new Error(`Ya existe una auditoría con IdAuditoria=${obj.idauditoria}`);
      }

      const row = _objToRow_(obj);
      _sheet_().appendRow(row);

      clearCache();

      return getByIdAuditoria(obj.idauditoria);

    } finally {
      lock.releaseLock();
    }
  }

  /** Actualiza una auditoría preservando su identidad. @param {*} idAuditoria @param {!Object} patch @return {!Object} */
  function updateByIdAuditoria(idAuditoria, patch) {
    const lock = LockService.getScriptLock();
    lock.waitLock(CFG.LOCK_TIMEOUT_MS);

    try {
      const id = _normalizeId_(idAuditoria);
      if (!id) {
        throw new Error("updateByIdAuditoria() requiere idAuditoria");
      }
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new TypeError("updateByIdAuditoria() requiere un objeto patch válido");
      }

      const current = getByIdAuditoria(id);
      if (!current) {
        throw new Error(`No existe la auditoría ${idAuditoria}`);
      }

      const sh = _sheet_();
      const maxCol = _maxColIndex_();
      const currentValues = sh.getRange(current._rowNumber, 1, 1, maxCol).getValues()[0];

      const merged = {
        ...current,
        ...patch,
        idauditoria: current.idauditoria // blindado
      };

      const newRow = _objToRow_(merged, currentValues);
      sh.getRange(current._rowNumber, 1, 1, maxCol).setValues([newRow]);

      clearCache();

      return getByIdAuditoria(id);

    } finally {
      lock.releaseLock();
    }
  }

  /** Inserta o actualiza una auditoría según su identidad. @param {!Object} payload @return {!Object} */
  function upsert(payload) {
    const normalized = _normalizePayload_(payload, "upsert()");
    const current = getByIdAuditoria(normalized.idauditoria);
    return current
      ? updateByIdAuditoria(normalized.idauditoria, normalized)
      : insert(normalized);
  }

  /** Invalida la caché del repositorio. @return {boolean} */
  function clearCache() {
    cache_ = null;
    console.log("[CACHE] AuditoriaExcedentesRepository limpio");
    return true;
  }

  /** Lee todas las auditorías omitiendo la caché. @return {!Array<!Object>} */
  function getAllFresh() {
    const values = _readValues_();

    return values
      .map((row, idx) => _rowToObj_(row, idx + CFG.FIRST_DATA_ROW))
      .filter(item => item.idauditoria);
  }

  /** Busca una auditoría directamente en la hoja. @param {*} idAuditoria @return {?Object} */
  function getByIdAuditoriaFresh(idAuditoria) {
    const id = _normalizeId_(idAuditoria);
    const all = getAllFresh();
    const found = all.find(x => _normalizeId_(x.idauditoria) === id);

    return found ? _clone_(found) : null;
  }

  
  return {
    getAll,
    getAllFresh,
    getByIdAuditoria,
    getByIdAuditoriaFresh,
    getAbiertas,
    getCerradas,
    exists,
    insert,
    updateByIdAuditoria,
    upsert,
    clearCache
  };


})();
