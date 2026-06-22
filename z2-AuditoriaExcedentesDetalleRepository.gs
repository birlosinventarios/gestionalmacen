/**
 * AuditoriaExcedentesDetalleRepository.gs
 * ------------------------------------------------------------
 * Repository de detalle para la hoja:
 * - auditoriaexcedentesdetalle
 *
 * RESPONSABILIDAD:
 * - leer detalle
 * - filtrar por auditoría
 * - filtrar por ubicación
 * - insertar uno o varios registros
 * - detectar escaneos previos
 * - actualizar detalle por renglón
 * - borrar por auditoría (si se necesita rehacer)
 *
 * NOTAS:
 * - No decide correctos/faltantes/sobrantes por negocio
 * - Solo persiste / recupera
 */

const AuditoriaExcedentesDetalleRepository = (() => {

  const CFG = Object.freeze({
    SHEET_KEY: "AUDITORIA_EXCEDENTES_DETALLE"
  });

  let cache_ = null;

  // =========================================================
  // HELPERS
  // =========================================================
  function _sheetDef_() {
    const def = SHEETS[CFG.SHEET_KEY];
    if (!def) {
      throw new Error(`No existe SHEETS.${CFG.SHEET_KEY} en CONSTANTS.gs`);
    }
    return def;
  }

  function _colDef_() {
    const def = COL[CFG.SHEET_KEY];
    if (!def) {
      throw new Error(`No existe COL.${CFG.SHEET_KEY} en CONSTANTS.gs`);
    }
    return def;
  }

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

  function _toStr_(value) {
    return String(value == null ? "" : value).trim();
  }

  function _toUpper_(value) {
    return _toStr_(value).toUpperCase();
  }

  function _toNum_(value) {
    if (value === "" || value == null) return 0;
    const n = Number(value);
    return isNaN(n) ? 0 : n;
  }

  function _toBool_(value) {
    const v = _toUpper_(value);
    return v === "TRUE" || v === "VERDADERO" || value === true || value === 1 || value === "1";
  }

  function _clone_(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function _normalizeId_(value) {
    return _toStr_(value);
  }

  function _normalizeUbicacion_(value) {
    return _toUpper_(value);
  }

  function _normalizeIdUnico_(value) {
    return _toStr_(value);
  }

  function _maxColIndex_() {
    return Math.max(...Object.values(_colDef_())) + 1;
  }

  function _blankRow_() {
    return Array(_maxColIndex_()).fill("");
  }

  function _readValues_() {
    const sh = _sheet_();
    const lastRow = sh.getLastRow();
    const maxCol = _maxColIndex_();

    if (lastRow < 2) {
      return [];
    }

    return sh.getRange(2, 1, lastRow - 1, maxCol).getValues();
  }

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

  function _ensureCache_() {
    if (cache_ !== null) return;

    const values = _readValues_();
    cache_ = values
      .map((row, idx) => _rowToObj_(row, idx + 2))
      .filter(item => item.idauditoria);

    console.log("[CACHE] AuditoriaExcedentesDetalleRepository cargado", {
      total: cache_.length
    });
  }

  // =========================================================
  // API PÚBLICA
  // =========================================================
  function getAll() {
    _ensureCache_();
    return _clone_(cache_);
  }

  function getByIdAuditoria(idAuditoria) {
    _ensureCache_();
    const id = _normalizeId_(idAuditoria);
    return _clone_(cache_.filter(x => _normalizeId_(x.idauditoria) === id));
  }

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

  function getEscaneadosByAuditoriaYUbicacion(idAuditoria, ubicacion) {
    return getByAuditoriaYUbicacion(idAuditoria, ubicacion)
      .filter(x => x.idunico);
  }

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

  function insert(payload) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const obj = {
        idauditoria: _toStr_(payload.idauditoria),
        secuenciaubicacion: payload.secuenciaubicacion != null ? payload.secuenciaubicacion : "",
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

      if (!obj.idauditoria) {
        throw new Error("insert() requiere payload.idauditoria");
      }

      const row = _objToRow_(obj);
      _sheet_().appendRow(row);

      clearCache();

      return obj;

    } finally {
      lock.releaseLock();
    }
  }

  function insertMany(payloads) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const list = Array.isArray(payloads) ? payloads : [];
      if (!list.length) return [];

      const rows = list.map(item => _objToRow_({
        idauditoria: _toStr_(item.idauditoria),
        secuenciaubicacion: item.secuenciaubicacion != null ? item.secuenciaubicacion : "",
        bodega: item.bodega || "",
        ubicacion: item.ubicacion || "",
        horainicioubicacion: item.horainicioubicacion || "",
        horafinubicacion: item.horafinubicacion || "",
        idunico: item.idunico || "",
        codigo: item.codigo || "",
        descripcion: item.descripcion || "",
        horaescaneoidunico: item.horaescaneoidunico || "",
        escorrecto: item.escorrecto === true,
        esfaltante: item.esfaltante === true,
        essobrante: item.essobrante === true,
        observaciones: item.observaciones || ""
      }));

      const sh = _sheet_();
      const startRow = sh.getLastRow() + 1;
      const maxCol = _maxColIndex_();

      sh.getRange(startRow, 1, rows.length, maxCol).setValues(rows);

      clearCache();

      return payloads;

    } finally {
      lock.releaseLock();
    }
  }

  function updateByRowNumber(rowNumber, patch) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const sh = _sheet_();
      const maxCol = _maxColIndex_();
      const currentValues = sh.getRange(rowNumber, 1, 1, maxCol).getValues()[0];
      const current = _rowToObj_(currentValues, rowNumber);

      const merged = {
        ...current,
        ...patch
      };

      const newRow = _objToRow_(merged, currentValues);
      sh.getRange(rowNumber, 1, 1, maxCol).setValues([newRow]);

      clearCache();

      const refreshed = getAll().find(x => x._rowNumber === rowNumber);
      return refreshed || null;

    } finally {
      lock.releaseLock();
    }
  }

  function deleteByIdAuditoria(idAuditoria) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const id = _normalizeId_(idAuditoria);
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

  function clearCache() {
    cache_ = null;
    console.log("[CACHE] AuditoriaExcedentesDetalleRepository limpio");
    return true;
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
    clearCache
  };

})();

/**
 * ===========================
 * DEBUGGERS
 * ===========================
 */

function debugAuditoriaExcedentesDetalleRepository_getAll() {
  const data = AuditoriaExcedentesDetalleRepository.getAll();
  console.log("[DEBUG] AuditoriaExcedentesDetalleRepository.getAll :: total", data.length);
  console.log(JSON.stringify(data.slice(0, 20), null, 2));
  return data;
}

function debugAuditoriaExcedentesDetalleRepository_getByIdAuditoria() {
  const ID = "AUD-PRUEBA-001";
  const data = AuditoriaExcedentesDetalleRepository.getByIdAuditoria(ID);
  console.log("[DEBUG] AuditoriaExcedentesDetalleRepository.getByIdAuditoria :: total", data.length);
  console.log(JSON.stringify(data.slice(0, 20), null, 2));
  return data;
}

function debugAuditoriaExcedentesDetalleRepository_clearCache() {
  return AuditoriaExcedentesDetalleRepository.clearCache();
}