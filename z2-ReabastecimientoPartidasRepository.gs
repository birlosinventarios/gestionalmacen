/**
 * z2-ReabastecimientoPartidasRepository.gs
 *
 * @fileoverview Persistencia de partidas de Reabastecimiento. Una partida
 * representa un SKU solicitado para una ubicación de piso dentro de un ticket.
 *
 * Responsabilidades:
 * - Validar REABASTECIMIENTO_PARTIDAS.
 * - Consultar partidas por solicitud, consecutivo y código.
 * - Insertar lotes y garantizar un solo registro por código dentro del ticket.
 * - Cambiar una partida de PENDIENTE a ATENDIDO bajo lock externo.
 * - Conservar fecha, hora y usuario de la primera atención.
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
 * @version REAB-PARTIDAS-REPOSITORY-2026-11-10-02
 */
const ReabastecimientoPartidasRepository = (() => {
  "use strict";
  const CFG = Object.freeze({
    SHEET_KEY: REABASTECIMIENTO_CONFIG.SHEET_KEYS.PARTIDAS,
    WIDTH: REABASTECIMIENTO_EXPECTED_WIDTHS.REABASTECIMIENTO_PARTIDAS,
    FIRST_DATA_ROW: 2,
    LOG_PREFIX: "[ReabastecimientoPartidasRepository]"
  });
  let cache_ = null;

  function validateContract(trace) {
    return assertSheetContract_(CFG.SHEET_KEY, REABASTECIMIENTO_HEADERS.PARTIDAS, trace);
  }

  function normalizeRow_(row, rowNumber) {
    const c = COL.REABASTECIMIENTO_PARTIDAS;
    return {
      numFila: Number(rowNumber || 0),
      idSolicitud: toStrUpper_(row[c.ID_SOLICITUD]),
      idPartidaConsecutivo: toStr_(row[c.ID_PARTIDACONSECUTIVO]),
      codigoSolicitado: toStrUpper_(row[c.SOLICITUD_CODIGOSOLICITADO]),
      descripcionSolicitada: toStrUpper_(row[c.SOLICITUD_DESCRIPCIONSOLICITADA]),
      ubicacionSolicitada: toStrUpper_(row[c.SOLICITUD_CODIGOSOLICITADOUBICACION]),
      estado: toStrUpper_(row[c.SOLICITUD_CODIGOESTADO]),
      fechaAtencion: row[c.SOLICITUD_FECHAATENCION] || "",
      horaAtencion: row[c.SOLICITUD_HORAATENCION] || "",
      usuarioAtencion: toStrUpper_(row[c.SOLICITUD_USUARIOATENCION])
    };
  }

  function buildRow_(record) {
    const row = new Array(CFG.WIDTH).fill("");
    const c = COL.REABASTECIMIENTO_PARTIDAS;
    row[c.ID_SOLICITUD] = toStrUpper_(record.idSolicitud);
    row[c.ID_PARTIDACONSECUTIVO] = toStr_(record.idPartidaConsecutivo);
    row[c.SOLICITUD_CODIGOSOLICITADO] = toStrUpper_(record.codigoSolicitado);
    row[c.SOLICITUD_DESCRIPCIONSOLICITADA] = toStrUpper_(record.descripcionSolicitada);
    row[c.SOLICITUD_CODIGOSOLICITADOUBICACION] = toStrUpper_(record.ubicacionSolicitada);
    row[c.SOLICITUD_CODIGOESTADO] = normalizeEnumValue_(
      record.estado || REABASTECIMIENTO_CONFIG.PARTIDA_ESTADOS.PENDIENTE,
      REABASTECIMIENTO_CONFIG.PARTIDA_ESTADOS,
      { fieldName: "SOLICITUD_CODIGOESTADO", required: true }
    );
    row[c.SOLICITUD_FECHAATENCION] = record.fechaAtencion || "";
    row[c.SOLICITUD_HORAATENCION] = record.horaAtencion || "";
    row[c.SOLICITUD_USUARIOATENCION] = toStrUpper_(record.usuarioAtencion);
    return row;
  }

  function getAll(trace) {
    if (!cache_) {
      validateContract(trace);
      cache_ = readSheetRows_(CFG.SHEET_KEY, CFG.WIDTH, trace)
        .map(function(row, index) { return normalizeRow_(row, index + 2); })
        .filter(function(item) { return Boolean(item.idSolicitud); });
    }
    return cache_.map(function(item) { return Object.assign({}, item); });
  }

  function getBySolicitud(idSolicitud, trace) {
    const id = toStrUpper_(idSolicitud);
    return getAll(trace).filter(function(item) { return item.idSolicitud === id; });
  }

  function getByKey(idSolicitud, idPartidaConsecutivo, trace) {
    const id = toStrUpper_(idSolicitud);
    const sequence = toStr_(idPartidaConsecutivo);
    const matches = getAll(trace).filter(function(item) {
      return item.idSolicitud === id && item.idPartidaConsecutivo === sequence;
    });
    if (matches.length > 1) throw new Error(CFG.LOG_PREFIX + " Clave duplicada.");
    return matches[0] || null;
  }

  function getByCodigo(idSolicitud, codigo, trace) {
    const id = toStrUpper_(idSolicitud);
    const code = toStrUpper_(codigo);
    const matches = getAll(trace).filter(function(item) {
      return item.idSolicitud === id && item.codigoSolicitado === code;
    });
    if (matches.length > 1) {
      throw new Error(CFG.LOG_PREFIX + " Código duplicado dentro de la solicitud.");
    }
    return matches[0] || null;
  }
  function appendManyUnderLock(records, trace) {
    const source = Array.isArray(records) ? records : [];
    if (!source.length) throw new Error("Se requiere al menos una partida.");
    const rows = source.map(buildRow_);
    const unique = Object.create(null);
    rows.forEach(function(row) {
      const c = COL.REABASTECIMIENTO_PARTIDAS;
      if (!row[c.ID_SOLICITUD] || !row[c.ID_PARTIDACONSECUTIVO] || !row[c.SOLICITUD_CODIGOSOLICITADO])
        throw new Error("Cada partida requiere solicitud, consecutivo y código.");
      const key = row[c.ID_SOLICITUD] + "|" + row[c.SOLICITUD_CODIGOSOLICITADO];
      if (unique[key]) {
        const error = new Error("Existe una partida duplicada en el lote.");
        error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.PARTIDA_DUPLICADA;
        throw error;
      }
      unique[key] = true;
    });
    const result = writeRowsBatch_(CFG.SHEET_KEY, rows, CFG.WIDTH, trace);
    cache_ = null;
    return { written: result.written, firstRow: result.firstRow };
  }

  function markAttendedUnderLock(idSolicitud, idPartidaConsecutivo, temporalContext, usuario, trace) {
    const current = getByKey(idSolicitud, idPartidaConsecutivo, trace);
    if (!current) {
      const error = new Error("La partida no existe.");
      error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.PARTIDA_NO_ENCONTRADA;
      throw error;
    }
    if (current.estado === REABASTECIMIENTO_CONFIG.PARTIDA_ESTADOS.ATENDIDO) {
      return { updated: false, alreadyAttended: true, rowNumber: current.numFila };
    }
    const row = readRowAt_(CFG.SHEET_KEY, current.numFila, CFG.WIDTH, trace);
    if (!row) throw new Error("No fue posible revalidar la partida.");
    const c = COL.REABASTECIMIENTO_PARTIDAS;
    row[c.SOLICITUD_CODIGOESTADO] = REABASTECIMIENTO_CONFIG.PARTIDA_ESTADOS.ATENDIDO;
    row[c.SOLICITUD_FECHAATENCION] = temporalContext.fecha;
    row[c.SOLICITUD_HORAATENCION] = temporalContext.hora;
    row[c.SOLICITUD_USUARIOATENCION] = toStrUpper_(usuario);
    writeRowAt_(CFG.SHEET_KEY, current.numFila, row, CFG.WIDTH, trace);
    cache_ = null;
    return { updated: true, alreadyAttended: false, rowNumber: current.numFila };
  }

  function clearCache() { cache_ = null; return true; }

  return Object.freeze({
    getAll,
    getBySolicitud,
    getByKey,
    getByCodigo,
    appendManyUnderLock,
    markAttendedUnderLock,
    validateContract,
    clearCache
  });
})();
