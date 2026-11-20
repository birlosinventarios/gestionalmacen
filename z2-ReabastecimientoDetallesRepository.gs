/**
 * z2-ReabastecimientoDetallesRepository.gs
 *
 * @fileoverview Persistencia de IDUNICO surtidos durante la atención de una
 * solicitud. Cada detalle se relaciona con una partida mediante ID_SOLICITUD y
 * SOLICITUD_IDUNICOESCANEADOCODIGO. No persiste ID_PARTIDACONSECUTIVO.
 *
 * Responsabilidades:
 * - Resolver dinámicamente las columnas de REABASTECIMIENTO_DETALLES por nombre
 *   de encabezado y agregar las extensiones del proceso bajo ScriptLock.
 * - Consultar detalles por solicitud y por código.
 * - Evitar IDUNICO duplicados dentro de una solicitud.
 * - Generar un consecutivo general por solicitud bajo lock externo.
 * - Persistir el surtido: cantidad surtida, saldo anterior y restante, tipo
 *   TOTAL/PARCIAL, origen e idOperacion del movimiento en Bitacora-TRASPASOS.
 *
 * Contrato de cantidad:
 * - SOLICITUD_IDUNICOESCANEADOCANTIDAD guarda las piezas surtidas.
 * - Los registros históricos sin DETALLE_TIPOSURTIDO se interpretan como
 *   escaneos previos al surtido integrado.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version REAB-DETALLES-REPOSITORY-2026-11-19-01
 */
const ReabastecimientoDetallesRepository = (() => {
  "use strict";

  const CFG = Object.freeze({
    SHEET_KEY: REABASTECIMIENTO_CONFIG.SHEET_KEYS.DETALLES,
    FIRST_DATA_ROW: 2,
    LOG_PREFIX: "[ReabastecimientoDetallesRepository]"
  });

  const H = Object.freeze({
    idSolicitud: "ID_SOLICITUD",
    idDetalleConsecutivo: "ID_DETALLECONSECUTIVO",
    idUnico: "SOLICITUD_IDUNICOESCANEADO",
    codigo: "SOLICITUD_IDUNICOESCANEADOCODIGO",
    descripcion: "SOLICITUD_IDUNICOESCANEADODESCRIPCION",
    cantidad: "SOLICITUD_IDUNICOESCANEADOCANTIDAD",
    fechaEscaneo: "SOLICITUD_IDUNICOESCANEADOFECHAESCANEO",
    horaEscaneo: "SOLICITUD_IDUNICOESCANEADOHORAESCANEO",
    usuarioResponsable: "SOLICITUD_USUARIORESPONSABLE",
    saldoAnterior: "DETALLE_SALDOANTERIOR",
    saldoRestante: "DETALLE_SALDORESTANTE",
    tipoSurtido: "DETALLE_TIPOSURTIDO",
    bodegaOrigen: "DETALLE_BODEGAORIGEN",
    ubicacionOrigen: "DETALLE_UBICACIONORIGEN",
    idOperacion: "DETALLE_IDOPERACION"
  });

  const layout = createHeaderLayoutAccessor_(
    CFG.SHEET_KEY,
    REABASTECIMIENTO_HEADERS.DETALLES,
    REABASTECIMIENTO_HEADERS_EXTENSION.DETALLES,
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
    const saldoRestante = read("saldoRestante");
    const saldoAnterior = read("saldoAnterior");
    return {
      numFila: Number(rowNumber || 0),
      idSolicitud: toStrUpper_(read("idSolicitud")),
      idDetalleConsecutivo: toStr_(read("idDetalleConsecutivo")),
      idUnico: toStr_(read("idUnico")),
      codigo: toStrUpper_(read("codigo")),
      descripcion: toStrUpper_(read("descripcion")),
      cantidad: toNum_(read("cantidad")),
      fechaEscaneo: read("fechaEscaneo") || "",
      horaEscaneo: read("horaEscaneo") || "",
      usuarioResponsable: toStrUpper_(read("usuarioResponsable")),
      saldoAnterior: saldoAnterior === "" ? null : toNum_(saldoAnterior),
      saldoRestante: saldoRestante === "" ? null : toNum_(saldoRestante),
      tipoSurtido: toStrUpper_(read("tipoSurtido")),
      bodegaOrigen: toStrUpper_(read("bodegaOrigen")),
      ubicacionOrigen: toStrUpper_(read("ubicacionOrigen")),
      idOperacion: toStr_(read("idOperacion"))
    };
  }

  function buildRow_(record, current) {
    const row = layout.blankRow(current);
    const put = function(field, value) {
      if (current.index[H[field]] === undefined) return;
      layout.write(row, current, H[field], value);
    };
    put("idSolicitud", toStrUpper_(record.idSolicitud));
    put("idDetalleConsecutivo", toStr_(record.idDetalleConsecutivo));
    put("idUnico", toStr_(record.idUnico));
    put("codigo", toStrUpper_(record.codigo));
    put("descripcion", toStrUpper_(record.descripcion));
    put("cantidad", toNum_(record.cantidad));
    put("fechaEscaneo", record.fechaEscaneo || "");
    put("horaEscaneo", record.horaEscaneo || "");
    put("usuarioResponsable", toStrUpper_(record.usuarioResponsable));
    put("saldoAnterior", record.saldoAnterior == null ? "" : toNum_(record.saldoAnterior));
    put("saldoRestante", record.saldoRestante == null ? "" : toNum_(record.saldoRestante));
    put("tipoSurtido", toStrUpper_(record.tipoSurtido));
    put("bodegaOrigen", toStrUpper_(record.bodegaOrigen));
    put("ubicacionOrigen", toStrUpper_(record.ubicacionOrigen));
    put("idOperacion", toStr_(record.idOperacion));
    return row;
  }

  function getAll(trace) {
    if (!cache_) {
      // Encabezados y datos en una sola llamada.
      const table = layout.readTable(trace);
      const current = table.layout;
      cache_ = table.rows
        .map(function(row, index) {
          return normalizeRow_(row, index + CFG.FIRST_DATA_ROW, current);
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

  /** Agrupa todos los detalles por folio en una sola lectura. */
  function getGroupedBySolicitud(trace) {
    return getAll(trace).reduce(function(map, item) {
      if (!map[item.idSolicitud]) map[item.idSolicitud] = [];
      map[item.idSolicitud].push(item);
      return map;
    }, Object.create(null));
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
    const token = toStrUpper_(idUnico);
    return getAll(trace).some(function(item) {
      return item.idSolicitud === id && toStrUpper_(item.idUnico) === token;
    });
  }

  function nextDetailConsecutiveUnderLock(idSolicitud, trace) {
    let maximum = 0;
    getBySolicitud(idSolicitud, trace).forEach(function(item) {
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
    const source = record || {};
    if (
      !toStrUpper_(source.idSolicitud) ||
      !toStr_(source.idDetalleConsecutivo) ||
      !toStr_(source.idUnico) ||
      !toStrUpper_(source.codigo)
    ) {
      throw new Error("Solicitud, consecutivo, IDUNICO y código son obligatorios.");
    }
    if (toNum_(source.cantidad) <= 0) {
      throw new Error("La cantidad surtida debe ser mayor que cero.");
    }
    if (hasIdUnicoInSolicitud(source.idSolicitud, source.idUnico, trace)) {
      const error = new Error("El IDUNICO ya fue registrado en la solicitud.");
      error.code = REABASTECIMIENTO_CONFIG.ERROR_CODES.IDUNICO_DUPLICADO;
      throw error;
    }
    const current = layout.get(trace, true);
    const row = buildRow_(source, current);
    const result = writeRowsBatch_(CFG.SHEET_KEY, [row], current.width, trace);
    layout.recordWrite(result.firstRow, [row]);
    // La fila nueva se agrega a la caché de la ejecución: el detalle que se
    // devuelve tras REGISTRAR no necesita releer la hoja.
    if (cache_ && result.written === 1 && result.firstRow) {
      const item = normalizeRow_(row, result.firstRow, current);
      if (item.idSolicitud && item.idUnico) cache_.push(item); else cache_ = null;
    } else {
      cache_ = null;
    }
    return { created: result.written === 1, rowNumber: result.firstRow };
  }

  function countUniqueBoxes(idSolicitud, trace) {
    const unique = Object.create(null);
    getBySolicitud(idSolicitud, trace).forEach(function(item) {
      unique[toStrUpper_(item.idUnico)] = true;
    });
    return Object.keys(unique).length;
  }

  /**
   * Vacía la fila de un detalle (Administración de excedentes, al revertir un
   * surtido que vino de Reabastecimiento). El Service DEBE tener el ScriptLock.
   *
   * Se vacía el contenido en lugar de eliminar la fila para no desplazar los
   * números de fila que otras ejecuciones puedan tener en memoria. Las filas
   * vacías se ignoran al leer (requieren ID_SOLICITUD e IDUNICO).
   *
   * @param {number} rowNumber Fila física del detalle.
   * @param {{idSolicitud:string, idUnico:string, idOperacion?:string}} expected
   *     Identidad esperada; si la fila ya no coincide, no se toca.
   * @param {Object=} trace Traza opcional.
   * @return {{cleared:boolean, respaldo:?Array<*>}} respaldo: valores previos.
   */
  function clearRowUnderLock(rowNumber, expected, trace) {
    const sheetLayout = layout.get(trace, true);
    const row = readRowAt_(CFG.SHEET_KEY, rowNumber, sheetLayout.width, trace);
    if (!row) return { cleared: false, respaldo: null };
    const sameRequest = toStrUpper_(layout.read(row, sheetLayout, H.idSolicitud)) === toStrUpper_(expected && expected.idSolicitud);
    const sameBox = toStrUpper_(layout.read(row, sheetLayout, H.idUnico)) === toStrUpper_(expected && expected.idUnico);
    const expectedOperation = toStr_(expected && expected.idOperacion);
    const sameOperation = !expectedOperation || toStr_(layout.read(row, sheetLayout, H.idOperacion)) === expectedOperation;
    if (!sameRequest || !sameBox || !sameOperation) {
      throw new Error("El detalle de Reabastecimiento de la fila " + rowNumber + " cambió. Vuelve a consultar.");
    }
    const blank = layout.blankRow(sheetLayout);
    writeRowAt_(CFG.SHEET_KEY, rowNumber, blank, sheetLayout.width, trace);
    layout.recordWrite(rowNumber, [blank]);
    if (cache_) {
      cache_ = cache_.filter(function(item) { return item.numFila !== rowNumber; });
    }
    return { cleared: true, respaldo: row.slice() };
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
    getByCodigo,
    hasIdUnicoInSolicitud,
    nextDetailConsecutiveUnderLock,
    appendUnderLock,
    clearRowUnderLock,
    countUniqueBoxes,
    validateContract,
    clearCache
  });
})();
