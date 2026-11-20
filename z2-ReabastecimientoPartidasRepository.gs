/**
 * z2-ReabastecimientoPartidasRepository.gs
 *
 * @fileoverview Persistencia de partidas de Reabastecimiento. Una partida
 * representa un SKU solicitado para una ubicación de consumo dentro de un ticket.
 *
 * Responsabilidades:
 * - Resolver dinámicamente las columnas de REABASTECIMIENTO_PARTIDAS por nombre
 *   de encabezado y agregar las extensiones del proceso bajo ScriptLock.
 * - Consultar partidas por solicitud, consecutivo y código.
 * - Insertar lotes y garantizar un solo registro por código dentro del ticket.
 * - Aplicar transiciones de estado PENDIENTE → EN_ATENCION → ATENDIDO /
 *   ATENDIDO_PARCIAL según REABASTECIMIENTO_CONFIG.TRANSICIONES_PARTIDA.
 * - Conservar fecha, hora y usuario de la primera atención y registrar fecha,
 *   hora y usuario de la conclusión.
 *
 * Política de concurrencia:
 * - Los métodos cuyo nombre termina en UnderLock no adquieren un candado.
 * - El Service ejecuta la transacción completa dentro de withScriptLock_().
 *
 * @author Sigifredo de la Cruz Ramos
 * @version REAB-PARTIDAS-REPOSITORY-2026-11-19-01
 */
const ReabastecimientoPartidasRepository = (() => {
  "use strict";

  const CFG = Object.freeze({
    SHEET_KEY: REABASTECIMIENTO_CONFIG.SHEET_KEYS.PARTIDAS,
    FIRST_DATA_ROW: 2,
    LOG_PREFIX: "[ReabastecimientoPartidasRepository]"
  });

  const H = Object.freeze({
    idSolicitud: "ID_SOLICITUD",
    idPartidaConsecutivo: "ID_PARTIDACONSECUTIVO",
    codigoSolicitado: "SOLICITUD_CODIGOSOLICITADO",
    descripcionSolicitada: "SOLICITUD_DESCRIPCIONSOLICITADA",
    ubicacionSolicitada: "SOLICITUD_CODIGOSOLICITADOUBICACION",
    estado: "SOLICITUD_CODIGOESTADO",
    fechaAtencion: "SOLICITUD_FECHAATENCION",
    horaAtencion: "SOLICITUD_HORAATENCION",
    usuarioAtencion: "SOLICITUD_USUARIOATENCION",
    fechaConclusion: "PARTIDA_FECHACONCLUSION",
    horaConclusion: "PARTIDA_HORACONCLUSION",
    usuarioConclusion: "PARTIDA_USUARIOCONCLUSION"
  });

  const STATES = REABASTECIMIENTO_CONFIG.PARTIDA_ESTADOS;

  const layout = createHeaderLayoutAccessor_(
    CFG.SHEET_KEY,
    REABASTECIMIENTO_HEADERS.PARTIDAS,
    REABASTECIMIENTO_HEADERS_EXTENSION.PARTIDAS,
    {
      persistentCache: {
        keyPrefix: REABASTECIMIENTO_CONFIG.REVISION.TABLE_CACHE_PREFIX,
        ttlSeconds: REABASTECIMIENTO_CONFIG.REVISION.TABLE_CACHE_TTL_SECONDS,
        /** Revisión vigente de ESTA hoja (null = no usar la copia). */
        revision: function() {
          return typeof reabTableRevisionRead_ === "function" ? reabTableRevisionRead_(CFG.SHEET_KEY) : null;
        }
      }
    }
  );
  let cache_ = null;

  function validateContract(trace) {
    const current = layout.get(trace, false);
    return {
      sheetKey: CFG.SHEET_KEY,
      width: current.width,
      headersOk: true,
      extensionesPendientes: current.missing.slice()
    };
  }

  function normalizeRow_(row, rowNumber, current) {
    const read = function(field) { return layout.read(row, current, H[field]); };
    return {
      numFila: Number(rowNumber || 0),
      idSolicitud: toStrUpper_(read("idSolicitud")),
      idPartidaConsecutivo: toStr_(read("idPartidaConsecutivo")),
      codigoSolicitado: toStrUpper_(read("codigoSolicitado")),
      descripcionSolicitada: toStrUpper_(read("descripcionSolicitada")),
      ubicacionSolicitada: toStrUpper_(read("ubicacionSolicitada")),
      estado: toStrUpper_(read("estado")) || STATES.PENDIENTE,
      fechaAtencion: read("fechaAtencion") || "",
      horaAtencion: read("horaAtencion") || "",
      usuarioAtencion: toStrUpper_(read("usuarioAtencion")),
      fechaConclusion: read("fechaConclusion") || "",
      horaConclusion: read("horaConclusion") || "",
      usuarioConclusion: toStrUpper_(read("usuarioConclusion"))
    };
  }

  function buildRow_(record, current) {
    const row = layout.blankRow(current);
    const put = function(field, value) {
      if (current.index[H[field]] === undefined) return;
      layout.write(row, current, H[field], value);
    };
    put("idSolicitud", toStrUpper_(record.idSolicitud));
    put("idPartidaConsecutivo", toStr_(record.idPartidaConsecutivo));
    put("codigoSolicitado", toStrUpper_(record.codigoSolicitado));
    put("descripcionSolicitada", toStrUpper_(record.descripcionSolicitada));
    put("ubicacionSolicitada", toStrUpper_(record.ubicacionSolicitada));
    put("estado", normalizeEnumValue_(
      record.estado || STATES.PENDIENTE,
      STATES,
      { fieldName: "SOLICITUD_CODIGOESTADO", required: true }
    ));
    put("fechaAtencion", record.fechaAtencion || "");
    put("horaAtencion", record.horaAtencion || "");
    put("usuarioAtencion", toStrUpper_(record.usuarioAtencion));
    put("fechaConclusion", record.fechaConclusion || "");
    put("horaConclusion", record.horaConclusion || "");
    put("usuarioConclusion", toStrUpper_(record.usuarioConclusion));
    return row;
  }

  function getAll(trace) {
    if (!cache_) {
      const startedAt = Date.now();
      perfMark_(trace, "PARTS_REPOSITORY_CACHE_MISS");
      // Encabezados y datos en una sola llamada.
      const table = layout.readTable(trace);
      const current = table.layout;
      cache_ = table.rows
        .map(function(row, index) {
          return normalizeRow_(row, index + CFG.FIRST_DATA_ROW, current);
        })
        .filter(function(item) { return Boolean(item.idSolicitud); });
      perfMark_(trace, "PARTS_REPOSITORY_CACHE_READY", {
        rows: cache_.length,
        elapsedMs: Date.now() - startedAt
      });
    } else {
      perfMark_(trace, "PARTS_REPOSITORY_CACHE_HIT", { rows: cache_.length });
    }
    return cache_.map(function(item) { return Object.assign({}, item); });
  }

  function getBySolicitud(idSolicitud, trace) {
    const id = toStrUpper_(idSolicitud);
    return getAll(trace).filter(function(item) { return item.idSolicitud === id; });
  }

  /** Agrupa todas las partidas por folio en una sola lectura. */
  function getGroupedBySolicitud(trace) {
    return getAll(trace).reduce(function(map, item) {
      if (!map[item.idSolicitud]) map[item.idSolicitud] = [];
      map[item.idSolicitud].push(item);
      return map;
    }, Object.create(null));
  }

  function getByKey(idSolicitud, idPartidaConsecutivo, trace) {
    const id = toStrUpper_(idSolicitud);
    const sequence = toStr_(idPartidaConsecutivo);
    const matches = getAll(trace).filter(function(item) {
      return item.idSolicitud === id &&
        (item.idPartidaConsecutivo === sequence ||
          Number(item.idPartidaConsecutivo) === Number(sequence));
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
    const current = layout.get(trace, true);
    const unique = Object.create(null);
    source.forEach(function(record) {
      const id = toStrUpper_(record.idSolicitud);
      const code = toStrUpper_(record.codigoSolicitado);
      if (!id || !toStr_(record.idPartidaConsecutivo) || !code) {
        throw new Error("Cada partida requiere solicitud, consecutivo y código.");
      }
      const key = id + "|" + code;
      if (unique[key]) {
        const error = new Error("Existe una partida duplicada en el lote.");
        error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.PARTIDA_DUPLICADA;
        throw error;
      }
      unique[key] = true;
    });
    const rows = source.map(function(record) { return buildRow_(record, current); });
    const startedAt = Date.now();
    const result = writeRowsBatch_(CFG.SHEET_KEY, rows, current.width, trace);
    perfMark_(trace, "REQUEST_PARTS_PERSISTED", {
      written: result.written,
      elapsedMs: Date.now() - startedAt
    });
    layout.recordWrite(result.firstRow, rows);
    cache_ = null;
    return { written: result.written, firstRow: result.firstRow };
  }

  /**
   * Reemplaza en la caché de la ejecución la partida recién escrita (evita
   * releer la hoja completa tras ATENDER o confirmar un SKU).
   */
  function patchCache_(item) {
    if (!cache_) return;
    const position = cache_.findIndex(function(entry) { return entry.numFila === item.numFila; });
    if (
      position === -1 ||
      cache_[position].idSolicitud !== item.idSolicitud ||
      cache_[position].idPartidaConsecutivo !== item.idPartidaConsecutivo
    ) {
      cache_ = null;
      return;
    }
    cache_[position] = item;
  }

  function partNotFound_() {
    const error = new Error("La partida no existe.");
    error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.PARTIDA_NO_ENCONTRADA;
    return error;
  }

  /** Relee la fila física y confirma que sigue perteneciendo a la partida. */
  function readAuthoritative_(current, trace) {
    const sheetLayout = layout.get(trace, true);
    const row = readRowAt_(CFG.SHEET_KEY, current.numFila, sheetLayout.width, trace);
    if (!row) throw new Error("No fue posible revalidar la partida.");
    if (
      toStrUpper_(layout.read(row, sheetLayout, H.idSolicitud)) !== current.idSolicitud ||
      toStrUpper_(layout.read(row, sheetLayout, H.codigoSolicitado)) !== current.codigoSolicitado
    ) {
      throw new Error("La fila de la partida cambió durante la actualización. Reintente.");
    }
    return { row: row, sheetLayout: sheetLayout };
  }

  /**
   * Marca la partida EN_ATENCION cuando sigue PENDIENTE y conserva la primera
   * fecha, hora y usuario de atención. Es idempotente para otros estados.
   */
  function markInAttentionUnderLock(idSolicitud, idPartidaConsecutivo, temporalContext, usuario, trace) {
    const current = getByKey(idSolicitud, idPartidaConsecutivo, trace);
    if (!current) throw partNotFound_();
    if (current.estado !== STATES.PENDIENTE) {
      return { updated: false, estado: current.estado, rowNumber: current.numFila };
    }
    const target = readAuthoritative_(current, trace);
    layout.write(target.row, target.sheetLayout, H.estado, STATES.EN_ATENCION);
    layout.write(target.row, target.sheetLayout, H.fechaAtencion, temporalContext.fecha);
    layout.write(target.row, target.sheetLayout, H.horaAtencion, temporalContext.hora);
    layout.write(target.row, target.sheetLayout, H.usuarioAtencion, toStrUpper_(usuario));
    writeRowAt_(CFG.SHEET_KEY, current.numFila, target.row, target.sheetLayout.width, trace);
    layout.recordWrite(current.numFila, [target.row]);
    patchCache_(normalizeRow_(target.row, current.numFila, target.sheetLayout));
    return { updated: true, estado: STATES.EN_ATENCION, rowNumber: current.numFila };
  }

  /**
   * Registra la conclusión del SKU como ATENDIDO o ATENDIDO_PARCIAL.
   * Si la partida seguía PENDIENTE también registra la primera atención.
   */
  function concludeUnderLock(idSolicitud, idPartidaConsecutivo, finalState, temporalContext, usuario, trace) {
    const state = toStrUpper_(finalState);
    if (REABASTECIMIENTO_CONFIG.PARTIDA_ESTADOS_CONCLUIDOS.indexOf(state) === -1) {
      const error = new Error("El resultado de la partida no es válido.");
      error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.TRANSICION_INVALIDA;
      throw error;
    }
    const current = getByKey(idSolicitud, idPartidaConsecutivo, trace);
    if (!current) throw partNotFound_();
    if (current.estado === state) {
      return { updated: false, estado: state, rowNumber: current.numFila };
    }
    const target = readAuthoritative_(current, trace);
    if (current.estado === STATES.PENDIENTE) {
      layout.write(target.row, target.sheetLayout, H.fechaAtencion, temporalContext.fecha);
      layout.write(target.row, target.sheetLayout, H.horaAtencion, temporalContext.hora);
      layout.write(target.row, target.sheetLayout, H.usuarioAtencion, toStrUpper_(usuario));
    }
    layout.write(target.row, target.sheetLayout, H.estado, state);
    layout.write(target.row, target.sheetLayout, H.fechaConclusion, temporalContext.fecha);
    layout.write(target.row, target.sheetLayout, H.horaConclusion, temporalContext.hora);
    layout.write(target.row, target.sheetLayout, H.usuarioConclusion, toStrUpper_(usuario));
    writeRowAt_(CFG.SHEET_KEY, current.numFila, target.row, target.sheetLayout.width, trace);
    layout.recordWrite(current.numFila, [target.row]);
    patchCache_(normalizeRow_(target.row, current.numFila, target.sheetLayout));
    return { updated: true, estado: state, rowNumber: current.numFila };
  }

  /** Alias histórico: concluye como ATENDIDO. */
  function markAttendedUnderLock(idSolicitud, idPartidaConsecutivo, temporalContext, usuario, trace) {
    const result = concludeUnderLock(
      idSolicitud,
      idPartidaConsecutivo,
      STATES.ATENDIDO,
      temporalContext,
      usuario,
      trace
    );
    return {
      updated: result.updated,
      alreadyAttended: !result.updated,
      rowNumber: result.rowNumber
    };
  }

  /**
   * Elimina todas las partidas de un folio durante una compensación.
   * El Service debe mantener adquirido el ScriptLock.
   */
  function deleteBySolicitudUnderLock(idSolicitud, trace) {
    const id = toStrUpper_(idSolicitud);
    if (!id) return { deleted: 0, rowNumbers: [] };
    const current = layout.get(trace, false);
    const result = deleteRowsByTextColumnUnderLock_(
      CFG.SHEET_KEY,
      current.width,
      layout.columnIndex(current, H.idSolicitud),
      id,
      trace
    );
    // Un borrado desplaza filas: no se refleja en el espejo, se descarta.
    layout.markDirty();
    layout.invalidateMirror();
    cache_ = null;
    return result;
  }

  function clearCache() {
    cache_ = null;
    layout.reset();
    return true;
  }

  return Object.freeze({
    /**
     * Publicación de la copia en caché (fase 4). El Service, bajo el candado y
     * después de subir la revisión, consulta hasPendingWrites() y llama
     * publishSnapshot(revisionNueva). preferSheet() fuerza leer la hoja en la
     * ejecución actual (botón "Actualizar" del listado).
     */
    sheetKey: CFG.SHEET_KEY,
    hasPendingWrites: layout.isDirty,
    publishSnapshot: layout.publish,
    preferSheet: layout.preferSheet,
    getAll,
    getBySolicitud,
    getGroupedBySolicitud,
    getByKey,
    getByCodigo,
    appendManyUnderLock,
    deleteBySolicitudUnderLock,
    markInAttentionUnderLock,
    concludeUnderLock,
    markAttendedUnderLock,
    validateContract,
    clearCache
  });
})();
