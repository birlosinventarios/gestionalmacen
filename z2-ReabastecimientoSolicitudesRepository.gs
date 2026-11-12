/**
 * z2-ReabastecimientoSolicitudesRepository.gs
 *
 * @fileoverview Persistencia de cabeceras de solicitudes de Reabastecimiento.
 * Una fila representa un ticket. El estado operativo no se persiste; el Service
 * lo deriva a partir de las marcas de inicio y cierre.
 *
 * Responsabilidades:
 * - Validar el contrato físico de REABASTECIMIENTO_SOLICITUDES.
 * - Normalizar filas físicas a objetos de dominio.
 * - Consultar solicitudes por folio y por fecha de creación.
 * - Calcular el siguiente consecutivo diario dentro de una transacción bloqueada.
 * - Insertar cabeceras y actualizar inicio o cierre bajo un lock externo.
 * - Mantener una caché local válida únicamente durante la ejecución actual.
 *
 * Dependencias globales:
 * - REABASTECIMIENTO_CONFIG, REABASTECIMIENTO_HEADERS y
 *   REABASTECIMIENTO_EXPECTED_WIDTHS.
 * - COL y SHEETS.
 * - getSheetByKey_(), readSheetRows_(), readRowAt_(), writeRowsBatch_() y
 *   writeRowAt_().
 * - assertSheetContract_(), toStr_(), toStrUpper_(), toNum_(),
 *   padPositiveInteger_() y perfMark_().
 *
 * Política de concurrencia:
 * - Los métodos cuyo nombre termina en UnderLock no adquieren un candado.
 * - El Service debe ejecutar la transacción completa dentro de withScriptLock_().
 * - Esto permite escribir cabecera, partidas y detalles bajo un único ScriptLock.
 *
 * Seguridad y observabilidad:
 * - No registra folios, códigos, ubicaciones, IDUNICO ni nombres de usuario.
 * - Las métricas contienen únicamente cantidades, índices y duraciones.
 * - El Repository no confía en números de fila proporcionados por el navegador.
 * @author Sigifredo de la Cruz Ramos
 * @version REAB-SOLICITUDES-REPOSITORY-2026-11-12-02
 */
const ReabastecimientoSolicitudesRepository = (() => {
  "use strict";

  const CFG = Object.freeze({
    SHEET_KEY: REABASTECIMIENTO_CONFIG.SHEET_KEYS.SOLICITUDES,
    WIDTH: REABASTECIMIENTO_EXPECTED_WIDTHS.REABASTECIMIENTO_SOLICITUDES,
    FIRST_DATA_ROW: 2,
    LOG_PREFIX: "[ReabastecimientoSolicitudesRepository]"
  });
  let cache_ = null;

  function validateDependencies_() {
    if (!COL.REABASTECIMIENTO_SOLICITUDES) {
      throw new Error(CFG.LOG_PREFIX + " Falta COL.REABASTECIMIENTO_SOLICITUDES.");
    }
    ["readSheetRows_", "readRowAt_", "writeRowsBatch_", "writeRowAt_",
      "assertSheetContract_", "toStr_", "toStrUpper_", "toNum_",
      "padPositiveInteger_", "buildReabastecimientoFolio_"]
      .forEach(function(name) {
        if (typeof globalThis[name] !== "function") {
          throw new Error(CFG.LOG_PREFIX + " Falta la utilidad " + name + ".");
        }
      });
  }

  function validateContract(trace) {
    validateDependencies_();
    return assertSheetContract_(
      CFG.SHEET_KEY,
      REABASTECIMIENTO_HEADERS.SOLICITUDES,
      trace
    );
  }

  function normalizeRow_(row, rowNumber) {
    const c = COL.REABASTECIMIENTO_SOLICITUDES;
    return {
      numFila: Number(rowNumber || 0),
      idSolicitud: toStrUpper_(row[c.ID_SOLICITUD]),
      idSolicitudConsecutivo: toStr_(row[c.ID_SOLICITUDCONSECUTIVO]),
      fechaCreacion: row[c.SOLICITUD_FECHACREACION] || "",
      horaCreacion: row[c.SOLICITUD_HORACREACION] || "",
      solicitante: toStrUpper_(row[c.SOLICITUD_SOLICITANTE]),
      bodega: toStrUpper_(row[c.SOLICITUD_BODEGA]),
      skusSolicitados: toNum_(row[c.SOLICITUD_SKUSOLICITADOS]),
      fechaInicioAtencion: row[c.SOLICITUD_FECHAINICIOATENCION] || "",
      horaInicioAtencion: row[c.SOLICITUD_HORAINICIOATENCION] || "",
      fechaCierreAtencion: row[c.SOLICITUD_FECHACIERREATENCION] || "",
      horaCierreAtencion: row[c.SOLICITUD_HORACIERREATENCION] || "",
      cajasInvolucradas: toNum_(row[c.CAJASINVOLUCRADAS])
    };
  }

  function buildRow_(record) {
    const row = new Array(CFG.WIDTH).fill("");
    const c = COL.REABASTECIMIENTO_SOLICITUDES;
    row[c.ID_SOLICITUD] = toStrUpper_(record.idSolicitud);
    row[c.ID_SOLICITUDCONSECUTIVO] = toStr_(record.idSolicitudConsecutivo);
    row[c.SOLICITUD_FECHACREACION] = record.fechaCreacion || "";
    row[c.SOLICITUD_HORACREACION] = record.horaCreacion || "";
    row[c.SOLICITUD_SOLICITANTE] = toStrUpper_(record.solicitante);
    row[c.SOLICITUD_BODEGA] = toStrUpper_(record.bodega);
    row[c.SOLICITUD_SKUSOLICITADOS] = Math.floor(toNum_(record.skusSolicitados));
    row[c.SOLICITUD_FECHAINICIOATENCION] = record.fechaInicioAtencion || "";
    row[c.SOLICITUD_HORAINICIOATENCION] = record.horaInicioAtencion || "";
    row[c.SOLICITUD_FECHACIERREATENCION] = record.fechaCierreAtencion || "";
    row[c.SOLICITUD_HORACIERREATENCION] = record.horaCierreAtencion || "";
    row[c.CAJASINVOLUCRADAS] = record.cajasInvolucradas === ""
      ? ""
      : Math.floor(toNum_(record.cajasInvolucradas));
    return row;
  }

  function readAll_(trace) {
    validateContract(trace);
    return readSheetRows_(CFG.SHEET_KEY, CFG.WIDTH, trace)
      .map(function(row, index) {
        return normalizeRow_(row, index + CFG.FIRST_DATA_ROW);
      })
      .filter(function(item) { return Boolean(item.idSolicitud); });
  }

  function getAll(trace) {
    if (!cache_) cache_ = readAll_(trace);
    return cache_.map(function(item) { return Object.assign({}, item); });
  }

  function getById(idSolicitud, trace) {
    const id = toStrUpper_(idSolicitud);
    if (!id) return null;
    const matches = getAll(trace).filter(function(item) {
      return item.idSolicitud === id;
    });
    if (matches.length > 1) {
      throw new Error(CFG.LOG_PREFIX + " Folio duplicado en la hoja.");
    }
    return matches[0] || null;
  }

  function nextDailyConsecutiveUnderLock(fechaCreacion, trace) {
    const dateText = toStr_(fechaCreacion);
    let maximum = 0;
    getAll(trace).forEach(function(item) {
      if (toStr_(item.fechaCreacion) !== dateText) return;
      const candidate = Math.floor(Number(item.idSolicitudConsecutivo || 0));
      if (candidate > maximum) maximum = candidate;
    });
    const next = maximum + 1;
    const limit = Number(REABASTECIMIENTO_CONFIG.FOLIO.MAX_SOLICITUDES_DIARIAS || 99);
    if (next > limit) {
      const error = new Error("Se alcanzó el límite diario de solicitudes.");
      error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.LIMITE_DIARIO_ALCANZADO;
      throw error;
    }
    perfMark_(trace, "REPOSITORY_DAILY_CONSECUTIVE_READY", { next: next });
    return next;
  }

  function createIdentityUnderLock(temporalContext, trace) {
    const context = temporalContext || {};
    const consecutive = nextDailyConsecutiveUnderLock(context.fecha, trace);
    const formatted = padPositiveInteger_(
      consecutive,
      REABASTECIMIENTO_CONFIG.FOLIO.CONSECUTIVO_DIGITOS,
      "ID_SOLICITUDCONSECUTIVO"
    );
    return {
      idSolicitud: buildReabastecimientoFolio_(context.fechaFolio, consecutive),
      idSolicitudConsecutivo: formatted
    };
  }

  function appendUnderLock(record, trace) {
    const row = buildRow_(record);
    if (!row[COL.REABASTECIMIENTO_SOLICITUDES.ID_SOLICITUD]) {
      throw new Error("ID_SOLICITUD es obligatorio.");
    }
    if (getById(row[0], trace)) {
      const error = new Error("La solicitud ya existe.");
      error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_DUPLICADA;
      throw error;
    }
    const result = writeRowsBatch_(CFG.SHEET_KEY, [row], CFG.WIDTH, trace);
    cache_ = null;
    return {
      created: result.written === 1,
      rowNumber: result.firstRow,
      idSolicitud: row[0]
    };
  }

  function updateTemporalFieldsUnderLock(idSolicitud, patch, trace) {
    const current = getById(idSolicitud, trace);
    if (!current) {
      const error = new Error("La solicitud no existe.");
      error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_NO_ENCONTRADA;
      throw error;
    }
    const authoritative = readRowAt_(CFG.SHEET_KEY, current.numFila, CFG.WIDTH, trace);
    if (!authoritative) throw new Error("No fue posible revalidar la solicitud.");
    const c = COL.REABASTECIMIENTO_SOLICITUDES;
    const normalizedPatch = patch || {};
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "fechaInicioAtencion"))
      authoritative[c.SOLICITUD_FECHAINICIOATENCION] = normalizedPatch.fechaInicioAtencion || "";
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "horaInicioAtencion"))
      authoritative[c.SOLICITUD_HORAINICIOATENCION] = normalizedPatch.horaInicioAtencion || "";
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "fechaCierreAtencion"))
      authoritative[c.SOLICITUD_FECHACIERREATENCION] = normalizedPatch.fechaCierreAtencion || "";
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "horaCierreAtencion"))
      authoritative[c.SOLICITUD_HORACIERREATENCION] = normalizedPatch.horaCierreAtencion || "";
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "cajasInvolucradas"))
      authoritative[c.CAJASINVOLUCRADAS] = Math.floor(toNum_(normalizedPatch.cajasInvolucradas));
    writeRowAt_(CFG.SHEET_KEY, current.numFila, authoritative, CFG.WIDTH, trace);
    cache_ = null;
    return { updated: true, rowNumber: current.numFila };
  }

  /**
   * Elimina la cabecera de un folio durante una compensación transaccional.
   * El Service debe mantener adquirido el ScriptLock.
   *
   * @param {*} idSolicitud Folio autoritativo.
   * @param {Object=} trace Traza opcional.
   * @return {{deleted:number,rowNumbers:!Array<number>}}
   */
  function deleteByIdUnderLock(idSolicitud, trace) {
    const id = toStrUpper_(idSolicitud);
    if (!id) return { deleted: 0, rowNumbers: [] };
    const result = deleteRowsByTextColumnUnderLock_(
      CFG.SHEET_KEY,
      CFG.WIDTH,
      COL.REABASTECIMIENTO_SOLICITUDES.ID_SOLICITUD,
      id,
      trace
    );
    cache_ = null;
    return result;
  }
  function clearCache() { cache_ = null; return true; }

  return Object.freeze({
    getAll,
    getById,
    validateContract,
    nextDailyConsecutiveUnderLock,
    createIdentityUnderLock,
    appendUnderLock,
    deleteByIdUnderLock,
    updateTemporalFieldsUnderLock,
    clearCache
  });
})();
