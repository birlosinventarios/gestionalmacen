/**
 * AuditoriaExcedentesRepository.gs
 */

const AuditoriaExcedentesRepository = (() => {

  const CFG = Object.freeze({
    SHEET_KEY: "AUDITORIA_EXCEDENTES"
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

  function _clone_(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function _normalizeId_(value) {
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

  function _ensureCache_() {
    if (cache_ !== null) return;

    const values = _readValues_();
    cache_ = values
      .map((row, idx) => _rowToObj_(row, idx + 2))
      .filter(item => item.idauditoria);

    console.log("[CACHE] AuditoriaExcedentesRepository cargado", {
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
    const found = cache_.find(x => _normalizeId_(x.idauditoria) === id);
    return found ? _clone_(found) : null;
  }

  function getAbiertas() {
    _ensureCache_();
    return _clone_(cache_.filter(x => _toUpper_(x.estatus) === "ABIERTA"));
  }

  function getCerradas() {
    _ensureCache_();
    return _clone_(cache_.filter(x => _toUpper_(x.estatus) === "CERRADA"));
  }

  function exists(idAuditoria) {
    return !!getByIdAuditoria(idAuditoria);
  }

  function insert(payload) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const obj = {
        idauditoria: _toStr_(payload.idauditoria),
        fecha: payload.fecha || "",
        horainicio: payload.horainicio || "",
        horafin: payload.horafin || "",
        duracionmin: payload.duracionmin != null ? payload.duracionmin : "",
        auditor: payload.auditor || "",
        tipoauditoria: payload.tipoauditoria || "",
        bodegaobjetivo: payload.bodegaobjetivo || "",
        estatus: payload.estatus || "",
        ubicacionesauditadas: payload.ubicacionesauditadas != null ? payload.ubicacionesauditadas : "",
        ubicacionescondiferencia: payload.ubicacionescondiferencia != null ? payload.ubicacionescondiferencia : "",
        idunicosesperadostotales: payload.idunicosesperadostotales != null ? payload.idunicosesperadostotales : "",
        idunicosescaneadostotales: payload.idunicosescaneadostotales != null ? payload.idunicosescaneadostotales : "",
        idunicoscorrectostotales: payload.idunicoscorrectostotales != null ? payload.idunicoscorrectostotales : "",
        idunicosfaltantestotales: payload.idunicosfaltantestotales != null ? payload.idunicosfaltantestotales : "",
        idunicossobrantestotales: payload.idunicossobrantestotales != null ? payload.idunicossobrantestotales : "",
        confiabilidadtotal: payload.confiabilidadtotal != null ? payload.confiabilidadtotal : "",
        observaciones: payload.observaciones || ""
      };

      if (!obj.idauditoria) {
        throw new Error("insert() requiere payload.idauditoria");
      }

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

  function updateByIdAuditoria(idAuditoria, patch) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const current = getByIdAuditoria(idAuditoria);
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

      return getByIdAuditoria(idAuditoria);

    } finally {
      lock.releaseLock();
    }
  }

  function upsert(payload) {
    const id = _normalizeId_(payload && payload.idauditoria);
    if (!id) {
      throw new Error("upsert() requiere payload.idauditoria");
    }

    if (exists(id)) {
      return updateByIdAuditoria(id, payload);
    }

    return insert(payload);
  }

  function clearCache() {
    cache_ = null;
    console.log("[CACHE] AuditoriaExcedentesRepository limpio");
    return true;
  }

  function getAllFresh() {
    const values = _readValues_();

    return values
      .map((row, idx) => _rowToObj_(row, idx + 2))
      .filter(item => item.idauditoria);
  }

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
