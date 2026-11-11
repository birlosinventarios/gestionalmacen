/**
 * z2-ReabastecimientoDetallesRepository.gs
 *
 * @fileoverview Persistencia de IDUNICO escaneados durante la atención de una
 * solicitud. Cada detalle se relaciona con una partida mediante ID_SOLICITUD y
 * SOLICITUD_IDUNICOESCANEADOCODIGO. No persiste ID_PARTIDACONSECUTIVO.
 *
 * Responsabilidades:
 * - Validar el contrato físico de nueve columnas.
 * - Consultar detalles por solicitud y por código.
 * - Evitar IDUNICO duplicados dentro de una solicitud.
 * - Generar un consecutivo general por solicitud bajo lock externo.
 * - Persistir la fotografía autoritativa del excedente escaneado.
 * - Contar cajas únicas para el cierre del ticket.
 *
 * Política de concurrencia:
 * - Los métodos UnderLock no adquieren candado.
 * - El Service coordina revalidación y escritura con un único ScriptLock.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version REAB-DETALLES-REPOSITORY-2026-11-10-02
 */
const ReabastecimientoDetallesRepository = (() => {
  "use strict";

  const CFG = Object.freeze({
    SHEET_KEY: REABASTECIMIENTO_CONFIG.SHEET_KEYS.DETALLES,
    WIDTH: REABASTECIMIENTO_EXPECTED_WIDTHS.REABASTECIMIENTO_DETALLES,
    FIRST_DATA_ROW: 2,
    LOG_PREFIX: "[ReabastecimientoDetallesRepository]"
  });
  let cache_ = null;

  function validateContract(trace) {
    return assertSheetContract_(
      CFG.SHEET_KEY,
      REABASTECIMIENTO_HEADERS.DETALLES,
      trace
    );
  }

  function normalizeRow_(row, rowNumber) {
    const c = COL.REABASTECIMIENTO_DETALLES;
    return {
      numFila: Number(rowNumber || 0),
      idSolicitud: toStrUpper_(row[c.ID_SOLICITUD]),
      idDetalleConsecutivo: toStr_(row[c.ID_DETALLECONSECUTIVO]),
      idUnico: toStr_(row[c.SOLICITUD_IDUNICOESCANEADO]),
      codigo: toStrUpper_(row[c.SOLICITUD_IDUNICOESCANEADOCODIGO]),
      descripcion: toStrUpper_(row[c.SOLICITUD_IDUNICOESCANEADODESCRIPCION]),
      cantidad: toNum_(row[c.SOLICITUD_IDUNICOESCANEADOCANTIDAD]),
      fechaEscaneo: row[c.SOLICITUD_IDUNICOESCANEADOFECHAESCANEO] || "",
      horaEscaneo: row[c.SOLICITUD_IDUNICOESCANEADOHORAESCANEO] || "",
      usuarioResponsable: toStrUpper_(row[c.SOLICITUD_USUARIORESPONSABLE])
    };
  }

  function buildRow_(record) {
    const row = new Array(CFG.WIDTH).fill("");
    const c = COL.REABASTECIMIENTO_DETALLES;
    row[c.ID_SOLICITUD] = toStrUpper_(record.idSolicitud);
    row[c.ID_DETALLECONSECUTIVO] = toStr_(record.idDetalleConsecutivo);
    row[c.SOLICITUD_IDUNICOESCANEADO] = toStr_(record.idUnico);
    row[c.SOLICITUD_IDUNICOESCANEADOCODIGO] = toStrUpper_(record.codigo);
    row[c.SOLICITUD_IDUNICOESCANEADODESCRIPCION] = toStrUpper_(record.descripcion);
    row[c.SOLICITUD_IDUNICOESCANEADOCANTIDAD] = toNum_(record.cantidad);
    row[c.SOLICITUD_IDUNICOESCANEADOFECHAESCANEO] = record.fechaEscaneo || "";
    row[c.SOLICITUD_IDUNICOESCANEADOHORAESCANEO] = record.horaEscaneo || "";
    row[c.SOLICITUD_USUARIORESPONSABLE] = toStrUpper_(record.usuarioResponsable);
    return row;
  }

  function getAll(trace) {
    if (!cache_) {
      validateContract(trace);
      cache_ = readSheetRows_(CFG.SHEET_KEY, CFG.WIDTH, trace)
        .map(function(row, index) {
          return normalizeRow_(row, index + CFG.FIRST_DATA_ROW);
        })
        .filter(function(item) {
          return Boolean(item.idSolicitud && item.idUnico);
        });
    }
    return cache_.map(function(item) { return Object.assign({}, item); });
  }

  function getBySolicitud(idSolicitud, trace) {
    const id = toStrUpper_(idSolicitud);
    return getAll(trace).filter(function(item) {
      return item.idSolicitud === id;
    });
  }

  function getByCodigo(idSolicitud, codigo, trace) {
    const id = toStrUpper_(idSolicitud);
    const code = toStrUpper_(codigo);
    return getAll(trace).filter(function(item) {
      return item.idSolicitud === id && item.codigo === code;
    });
  }

  function hasIdUnicoInSolicitud(idSolicitud, idUnico, trace) {
    const id = toStrUpper_(idSolicitud);
    const token = toStr_(idUnico);
    return getAll(trace).some(function(item) {
      return item.idSolicitud === id && item.idUnico === token;
    });
  }

  function nextDetailConsecutiveUnderLock(idSolicitud, trace) {
    let maximum = 0;
    const details = getBySolicitud(idSolicitud, trace);
    details.forEach(function(item) {
      const candidate = Math.floor(Number(item.idDetalleConsecutivo || 0));
      if (candidate > maximum) maximum = candidate;
    });
    const next = maximum + 1;
    const limit = Number(
      REABASTECIMIENTO_CONFIG.LIMITES.MAX_DETALLES_POR_SOLICITUD || 999
    );
    if (next > limit) {
      const error = new Error("Se alcanzó el límite de detalles de la solicitud.");
      error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.LIMITE_DETALLES_EXCEDIDO;
      throw error;
    }
    return padPositiveInteger_(
      next,
      REABASTECIMIENTO_CONFIG.CONSECUTIVOS.DETALLE_DIGITOS,
      "ID_DETALLECONSECUTIVO"
    );
  }

  function appendUnderLock(record, trace) {
    const row = buildRow_(record);
    const c = COL.REABASTECIMIENTO_DETALLES;
    if (
      !row[c.ID_SOLICITUD] ||
      !row[c.ID_DETALLECONSECUTIVO] ||
      !row[c.SOLICITUD_IDUNICOESCANEADO] ||
      !row[c.SOLICITUD_IDUNICOESCANEADOCODIGO]
    ) {
      throw new Error(
        "Solicitud, consecutivo, IDUNICO y código son obligatorios."
      );
    }
    if (toNum_(row[c.SOLICITUD_IDUNICOESCANEADOCANTIDAD]) <= 0) {
      throw new Error("La cantidad del IDUNICO debe ser mayor que cero.");
    }
    if (
      hasIdUnicoInSolicitud(
        row[c.ID_SOLICITUD],
        row[c.SOLICITUD_IDUNICOESCANEADO],
        trace
      )
    ) {
      const error = new Error("El IDUNICO ya fue registrado en la solicitud.");
      error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.IDUNICO_DUPLICADO;
      throw error;
    }
    const result = writeRowsBatch_(CFG.SHEET_KEY, [row], CFG.WIDTH, trace);
    cache_ = null;
    return { created: result.written === 1, rowNumber: result.firstRow };
  }

  function countUniqueBoxes(idSolicitud, trace) {
    const unique = Object.create(null);
    getBySolicitud(idSolicitud, trace).forEach(function(item) {
      unique[item.idUnico] = true;
    });
    return Object.keys(unique).length;
  }

  function clearCache() {
    cache_ = null;
    return true;
  }

  return Object.freeze({
    getAll,
    getBySolicitud,
    getByCodigo,
    hasIdUnicoInSolicitud,
    nextDetailConsecutiveUnderLock,
    appendUnderLock,
    countUniqueBoxes,
    validateContract,
    clearCache
  });
})();
