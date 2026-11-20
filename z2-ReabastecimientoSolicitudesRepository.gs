/**
 * z2-ReabastecimientoSolicitudesRepository.gs
 *
 * @fileoverview Persistencia de cabeceras de solicitudes de Reabastecimiento.
 * Una fila representa un ticket. El estado operativo no se persiste; el Service
 * lo deriva a partir de marcas de inicio, cierre y el estado de sus partidas.
 *
 * Responsabilidades:
 * - Resolver dinámicamente las columnas de REABASTECIMIENTO_SOLICITUDES por
 *   nombre de encabezado (fila 1). La posición física no es un contrato.
 * - Agregar al final de la fila 1 los encabezados de extensión del proceso
 *   REABASTECIMIENTO-v1 durante la primera escritura bajo ScriptLock.
 * - Normalizar filas físicas a objetos de dominio.
 * - Consultar solicitudes por folio y calcular el consecutivo diario.
 * - Insertar cabeceras y actualizar campos de atención o cierre.
 *
 * Dependencias globales:
 * - REABASTECIMIENTO_CONFIG, REABASTECIMIENTO_HEADERS,
 *   REABASTECIMIENTO_HEADERS_EXTENSION.
 * - createHeaderLayoutAccessor_(), readSheetRows_(), readRowAt_(),
 *   writeRowsBatch_(), writeRowAt_(), deleteRowsByTextColumnUnderLock_().
 * - toStr_(), toStrUpper_(), toNum_(), padPositiveInteger_(),
 *   buildReabastecimientoFolio_() y perfMark_().
 *
 * Política de concurrencia:
 * - Los métodos cuyo nombre termina en UnderLock no adquieren un candado.
 * - El Service ejecuta la transacción completa dentro de withScriptLock_().
 *
 * Seguridad y observabilidad:
 * - No registra folios, códigos, ubicaciones, IDUNICO ni nombres de usuario.
 * - El Repository no confía en números de fila proporcionados por el navegador.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version REAB-SOLICITUDES-REPOSITORY-2026-11-19-01
 */
const ReabastecimientoSolicitudesRepository = (() => {
  "use strict";

  const CFG = Object.freeze({
    SHEET_KEY: REABASTECIMIENTO_CONFIG.SHEET_KEYS.SOLICITUDES,
    FIRST_DATA_ROW: 2,
    LOG_PREFIX: "[ReabastecimientoSolicitudesRepository]"
  });

  /** Nombre de encabezado por propiedad de dominio. */
  const H = Object.freeze({
    idSolicitud: "ID_SOLICITUD",
    idSolicitudConsecutivo: "ID_SOLICITUDCONSECUTIVO",
    fechaCreacion: "SOLICITUD_FECHACREACION",
    horaCreacion: "SOLICITUD_HORACREACION",
    solicitante: "SOLICITUD_SOLICITANTE",
    bodega: "SOLICITUD_BODEGA",
    skusSolicitados: "SOLICITUD_SKUSOLICITADOS",
    fechaInicioAtencion: "SOLICITUD_FECHAINICIOATENCION",
    horaInicioAtencion: "SOLICITUD_HORAINICIOATENCION",
    fechaCierreAtencion: "SOLICITUD_FECHACIERREATENCION",
    horaCierreAtencion: "SOLICITUD_HORACIERREATENCION",
    cajasInvolucradas: "CAJASINVOLUCRADAS",
    areaSuministro: "SOLICITUD_AREASUMINISTRO",
    usuarioInicioAtencion: "SOLICITUD_USUARIOINICIOATENCION",
    auxiliares: "SOLICITUD_AUXILIARES",
    usuarioCierre: "SOLICITUD_USUARIOCIERRE",
    cierreConPendientes: "SOLICITUD_CIERRECONPENDIENTES",
    motivoCierre: "SOLICITUD_MOTIVOCIERRE"
  });

  /** Campos que admiten actualización posterior a la creación. */
  const UPDATABLE = Object.freeze([
    "fechaInicioAtencion",
    "horaInicioAtencion",
    "fechaCierreAtencion",
    "horaCierreAtencion",
    "cajasInvolucradas",
    "usuarioInicioAtencion",
    "auxiliares",
    "usuarioCierre",
    "cierreConPendientes",
    "motivoCierre"
  ]);

  const layout = createHeaderLayoutAccessor_(
    CFG.SHEET_KEY,
    REABASTECIMIENTO_HEADERS.SOLICITUDES,
    REABASTECIMIENTO_HEADERS_EXTENSION.SOLICITUDES,
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
      idSolicitudConsecutivo: toStr_(read("idSolicitudConsecutivo")),
      fechaCreacion: read("fechaCreacion") || "",
      horaCreacion: read("horaCreacion") || "",
      solicitante: toStrUpper_(read("solicitante")),
      bodega: toStrUpper_(read("bodega")),
      skusSolicitados: toNum_(read("skusSolicitados")),
      fechaInicioAtencion: read("fechaInicioAtencion") || "",
      horaInicioAtencion: read("horaInicioAtencion") || "",
      fechaCierreAtencion: read("fechaCierreAtencion") || "",
      horaCierreAtencion: read("horaCierreAtencion") || "",
      cajasInvolucradas: toNum_(read("cajasInvolucradas")),
      areaSuministro: toStrUpper_(read("areaSuministro")),
      usuarioInicioAtencion: toStrUpper_(read("usuarioInicioAtencion")),
      auxiliares: splitUsers_(read("auxiliares")),
      usuarioCierre: toStrUpper_(read("usuarioCierre")),
      cierreConPendientes: toStrUpper_(read("cierreConPendientes")) === "SI",
      motivoCierre: toStr_(read("motivoCierre"))
    };
  }

  /** Convierte la lista persistida de auxiliares en arreglo único. */
  function splitUsers_(value) {
    const seen = Object.create(null);
    return toStr_(value)
      .split(",")
      .map(toStrUpper_)
      .filter(function(name) {
        if (!name || seen[name]) return false;
        seen[name] = true;
        return true;
      });
  }

  function serializeField_(field, value) {
    if (field === "cajasInvolucradas" || field === "skusSolicitados") {
      return value === "" || value == null ? "" : Math.floor(toNum_(value));
    }
    if (field === "auxiliares") {
      return (Array.isArray(value) ? value : splitUsers_(value)).join(", ");
    }
    if (field === "cierreConPendientes") {
      if (value === "" || value == null) return "";
      return value === true || toStrUpper_(value) === "SI" ? "SI" : "NO";
    }
    if (field === "motivoCierre" || field === "idSolicitudConsecutivo") {
      return toStr_(value);
    }
    if (/^(fecha|hora)/.test(field)) return value || "";
    return toStrUpper_(value);
  }

  function buildRow_(record, current) {
    const row = layout.blankRow(current);
    Object.keys(H).forEach(function(field) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) return;
      if (current.index[H[field]] === undefined) return;
      layout.write(row, current, H[field], serializeField_(field, record[field]));
    });
    return row;
  }

  /** Lee encabezados y datos en una sola llamada (ver createHeaderLayoutAccessor_.readTable). */
  function readAll_(trace) {
    const table = layout.readTable(trace);
    const current = table.layout;
    return table.rows
      .map(function(row, index) {
        return normalizeRow_(row, index + CFG.FIRST_DATA_ROW, current);
      })
      .filter(function(item) { return Boolean(item.idSolicitud); });
  }

  /**
   * Reemplaza en la caché de la ejecución la fila recién escrita, para no
   * releer la hoja completa después de una actualización propia.
   */
  function patchCache_(item) {
    if (!cache_) return;
    const position = cache_.findIndex(function(entry) { return entry.numFila === item.numFila; });
    if (position === -1 || cache_[position].idSolicitud !== item.idSolicitud) {
      cache_ = null;
      return;
    }
    cache_[position] = item;
  }

  function copy_(item) {
    return Object.assign({}, item, { auxiliares: item.auxiliares.slice() });
  }

  function getAll(trace) {
    if (!cache_) {
      const startedAt = Date.now();
      perfMark_(trace, "REQUESTS_REPOSITORY_CACHE_MISS");
      cache_ = readAll_(trace);
      perfMark_(trace, "REQUESTS_REPOSITORY_CACHE_READY", {
        rows: cache_.length,
        elapsedMs: Date.now() - startedAt
      });
    } else {
      perfMark_(trace, "REQUESTS_REPOSITORY_CACHE_HIT", { rows: cache_.length });
    }
    return cache_.map(copy_);
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
      const itemDate = item.fechaCreacion instanceof Date
        ? Utilities.formatDate(item.fechaCreacion, getScriptTz_(), REABASTECIMIENTO_CONFIG.FORMATOS.FECHA)
        : toStr_(item.fechaCreacion);
      if (itemDate !== dateText) return;
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
    const current = layout.get(trace, true);
    const id = toStrUpper_(record && record.idSolicitud);
    if (!id) throw new Error("ID_SOLICITUD es obligatorio.");
    if (getById(id, trace)) {
      const error = new Error("La solicitud ya existe.");
      error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_DUPLICADA;
      throw error;
    }
    const row = buildRow_(record, current);
    const startedAt = Date.now();
    const result = writeRowsBatch_(CFG.SHEET_KEY, [row], current.width, trace);
    perfMark_(trace, "REQUEST_HEADER_PERSISTED", {
      written: result.written,
      elapsedMs: Date.now() - startedAt
    });
    // Refleja la fila nueva en el espejo de la tabla (publicación posterior).
    layout.recordWrite(result.firstRow, [row]);
    cache_ = null;
    return {
      created: result.written === 1,
      rowNumber: result.firstRow,
      idSolicitud: id
    };
  }

  /**
   * Actualiza campos operativos permitidos sobre la fila autoritativa.
   * Conserva intactas las columnas no administradas por este Repository.
   */
  function updateFieldsUnderLock(idSolicitud, patch, trace) {
    const current = getById(idSolicitud, trace);
    if (!current) {
      const error = new Error("La solicitud no existe.");
      error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.SOLICITUD_NO_ENCONTRADA;
      throw error;
    }
    const sheetLayout = layout.get(trace, true);
    const authoritative = readRowAt_(CFG.SHEET_KEY, current.numFila, sheetLayout.width, trace);
    if (!authoritative) throw new Error("No fue posible revalidar la solicitud.");
    if (toStrUpper_(layout.read(authoritative, sheetLayout, H.idSolicitud)) !== current.idSolicitud) {
      throw new Error("La fila de la solicitud cambió durante la actualización. Reintente.");
    }
    const normalizedPatch = patch || {};
    UPDATABLE.forEach(function(field) {
      if (!Object.prototype.hasOwnProperty.call(normalizedPatch, field)) return;
      layout.write(authoritative, sheetLayout, H[field], serializeField_(field, normalizedPatch[field]));
    });
    writeRowAt_(CFG.SHEET_KEY, current.numFila, authoritative, sheetLayout.width, trace);
    layout.recordWrite(current.numFila, [authoritative]);
    patchCache_(normalizeRow_(authoritative, current.numFila, sheetLayout));
    return { updated: true, rowNumber: current.numFila };
  }

  /** Alias histórico. */
  function updateTemporalFieldsUnderLock(idSolicitud, patch, trace) {
    return updateFieldsUnderLock(idSolicitud, patch, trace);
  }

  /**
   * Elimina la cabecera de un folio durante una compensación transaccional.
   * El Service debe mantener adquirido el ScriptLock.
   */
  function deleteByIdUnderLock(idSolicitud, trace) {
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
    getById,
    validateContract,
    nextDailyConsecutiveUnderLock,
    createIdentityUnderLock,
    appendUnderLock,
    deleteByIdUnderLock,
    updateFieldsUnderLock,
    updateTemporalFieldsUnderLock,
    clearCache
  });
})();
