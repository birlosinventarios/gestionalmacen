/**
 * VerificacionEntradaService.gs
 *
 * Reglas de negocio del módulo Verificación de entrada.
 * Versión optimizada para captura continua y registro por micro-lotes.
 *
 * Optimizaciones principales:
 * - registrarCajas acepta y valida varias cajas en una sola llamada.
 * - Una sola lectura de sesión, perfil, equivalencias, detalle y cajas por lote.
 * - Una sola escritura de cajas y eventos por lote.
 * - Un solo recálculo de estado por lote.
 * - Solo actualiza en VE_DETALLE los SKU afectados por el lote.
 * - Mantiene conciliación completa desde VE_CAJAS para integridad.
 */
const VerificacionEntradaService = (() => {
  "use strict";

  const DOMAIN = VERIFICACION_ENTRADA;
  const REPOSITORY = VerificacionEntradaRepository;
  const CANCELADA = DOMAIN.ESTADOS_CAJA.CANCELADA;

  let perfilesCache_ = null;

  function _str_(value) {
    return toStr_(value);
  }

  function _upper_(value) {
    return toStrUpper_(value);
  }

  function _num_(value) {
    return toNum_(value);
  }

  function _round_(value) {
    return round2_(value);
  }

  function _normalizeRfc_(value) {
    return _upper_(value).replace(/[\s-]+/g, "");
  }

  function _normalizeCode_(value) {
    return _upper_(value).replace(/\s+/g, " ").trim();
  }

  function _normalizeUnit_(value) {
    const unit = _upper_(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (["KGM", "KG", "KILOGRAMO", "KILOGRAMOS"].includes(unit)) {
      return "KG";
    }

    if (["H87", "PIEZA", "PIEZAS", "PZA", "PZAS"].includes(unit)) {
      return "PIEZA";
    }

    if (["XBX", "CAJA", "CAJAS"].includes(unit)) {
      return "CAJA";
    }

    return unit;
  }

  function _publicError_(code, message, metadata) {
    const error = new Error(message || code || "Error de operación.");
    error.code = String(code || "VE_ERROR");
    error.publicMetadata = metadata || {};
    return error;
  }

  function _assert_(condition, code, message, metadata) {
    if (!condition) {
      throw _publicError_(code, message, metadata);
    }
  }

  function _uuidToken_(prefix) {
    return String(prefix || "VE") + "-" +
      Utilities.getUuid().replace(/-/g, "").slice(0, 20).toUpperCase();
  }

  function _isHexHash_(value) {
    return /^[A-F0-9]{64}$/.test(_upper_(value));
  }

  function _safeObservation_(value) {
    const text = _str_(value);
    const maxLength = Number(DOMAIN.LIMITES.OBSERVACION_MAX_LENGTH || 1000);

    _assert_(
      text.length <= maxLength,
      "VE_OBSERVACION_EXCEDE_LIMITE",
      "La observación excede la longitud permitida."
    );

    return text;
  }

  function _currentUser_(context) {
    const source = context || {};

    return {
      usuario:
        _str_(source.usuario) ||
        _str_(source.nombreUsuario) ||
        _str_(source.email) ||
        "USUARIO_NO_IDENTIFICADO",
      rol:
        _upper_(source.rolUsuario || source.rol) ||
        "OPERADOR"
    };
  }

  function _profileMap_() {
    if (perfilesCache_ !== null) {
      return perfilesCache_;
    }

    perfilesCache_ = Object.keys(
      VERIFICACION_ENTRADA_PROVEEDORES || {}
    ).reduce(function(output, rfcKey) {
      const rfc = _normalizeRfc_(rfcKey);
      const profile = VERIFICACION_ENTRADA_PROVEEDORES[rfcKey];

      if (rfc && profile) {
        output[rfc] = profile;
      }

      return output;
    }, {});

    return perfilesCache_;
  }

  function _getProfileByRfc_(rfcEmisor, trace) {
    const startedAt = Date.now();
    const rfc = _normalizeRfc_(rfcEmisor);
    const profile = _profileMap_()[rfc] || null;

    perfMark_(trace, "VE_PROVIDER_PROFILE_RESOLVED", {
      elapsedMs: Date.now() - startedAt,
      hasRfc: Boolean(rfc),
      found: Boolean(profile),
      active: Boolean(profile && profile.activo === true)
    });

    _assert_(rfc, "VE_RFC_EMISOR_REQUERIDO", "El CFDI no contiene un RFC emisor válido.");
    _assert_(profile, "VE_PROVEEDOR_SIN_PERFIL", "El proveedor no tiene un perfil de entrada configurado.");
    _assert_(profile.activo === true, "VE_PROVEEDOR_INACTIVO", "El proveedor no está habilitado para Verificación de entrada.");
    _assert_(_upper_(profile.estrategiaEtiqueta), "VE_ESTRATEGIA_ETIQUETA_REQUERIDA", "El proveedor no tiene una estrategia de etiquetas configurada.");

    return { rfc: rfc, profile: profile };
  }

  function _assertDocument_(documento, trace) {
    const startedAt = Date.now();
    const source = documento || {};
    const version = _str_(source.versionCfdi || source.version);
    const tipo = _upper_(source.tipoComprobante || source.tipoDeComprobante);
    const rfc = _normalizeRfc_(source.rfcEmisor || (source.emisor && source.emisor.rfc));
    const hash = _upper_(source.hashXml);
    const uuid = _upper_(source.uuidCfdi || source.uuid);

    _assert_(version === "4.0", "VE_VERSION_CFDI_NO_SOPORTADA", "Solo se admite CFDI versión 4.0.");
    _assert_(tipo === DOMAIN.TIPOS_COMPROBANTE.INGRESO, "VE_TIPO_COMPROBANTE_NO_APLICABLE", "El XML no corresponde a un CFDI de ingreso apto para recepción física.");
    _assert_(rfc, "VE_RFC_EMISOR_REQUERIDO", "No se encontró el RFC emisor.");
    _assert_(hash && _isHexHash_(hash), "VE_HASH_XML_INVALIDO", "La huella SHA-256 del XML es inválida.");
    _assert_(uuid, "VE_UUID_CFDI_REQUERIDO", "El CFDI no contiene UUID.");

    perfMark_(trace, "VE_DOCUMENT_VALIDATED", {
      elapsedMs: Date.now() - startedAt,
      version: version,
      type: tipo,
      hasRfc: true,
      hasHash: true,
      hasUuid: true
    });

    return {
      versionCfdi: version,
      tipoComprobante: tipo,
      rfcEmisor: rfc,
      hashXml: hash,
      uuidCfdi: uuid,
      nombreEmisor: _str_(source.nombreEmisor || (source.emisor && source.emisor.nombre)),
      serie: _upper_(source.serie),
      folio: _str_(source.folio),
      fechaCfdi: source.fechaCfdi || source.fecha || "",
      moneda: _upper_(source.moneda),
      nombreArchivo: _str_(source.nombreArchivo)
    };
  }

  function _normalizeConcepts_(conceptos, rfcEmisor, trace) {
    const startedAt = Date.now();
    const source = Array.isArray(conceptos) ? conceptos : [];

    _assert_(source.length > 0, "VE_CONCEPTOS_REQUERIDOS", "El CFDI no contiene conceptos para analizar.");
    _assert_(source.length <= Number(DOMAIN.LIMITES.XML_MAX_CONCEPTOS || 1000), "VE_LIMITE_CONCEPTOS_EXCEDIDO", "El CFDI excede el número máximo de conceptos permitido.");

    const normalized = source.map(function(item, index) {
      const row = item || {};
      const code = _normalizeCode_(row.codigoProveedorXml || row.noIdentificacion || row.codigoProveedor);
      const quantity = Math.abs(_num_(row.cantidadXml !== undefined ? row.cantidadXml : row.cantidad));

      _assert_(quantity > 0, "VE_CANTIDAD_XML_INVALIDA", "Existe un concepto con cantidad inválida.", { row: index + 1 });

      return {
        sourceIndex: index,
        rfcEmisor: rfcEmisor,
        codigoProveedorXml: code,
        descripcionXml: _str_(row.descripcionXml || row.descripcion),
        claveProdServ: _upper_(row.claveProdServ),
        claveUnidadXml: _upper_(row.claveUnidadXml || row.claveUnidad),
        unidadXml: _upper_(row.unidadXml || row.unidad),
        cantidadXml: quantity,
        renglonesOriginales: Array.isArray(row.renglonesOriginales)
          ? row.renglonesOriginales.slice()
          : [index + 1]
      };
    });

    perfMark_(trace, "VE_CONCEPTS_NORMALIZED", {
      elapsedMs: Date.now() - startedAt,
      rows: normalized.length,
      withoutOperationalCode: normalized.filter(function(item) {
        return !item.codigoProveedorXml;
      }).length
    });

    return normalized;
  }

  function _equivalenceIndexes_(equivalencias) {
    return (equivalencias || []).reduce(function(indexes, item) {
      const xmlCode = _normalizeCode_(item.codigoProveedorXml);
      const labelCode = _normalizeCode_(item.codigoEtiqueta);

      if (xmlCode) {
        if (!indexes.byXml[xmlCode]) indexes.byXml[xmlCode] = [];
        indexes.byXml[xmlCode].push(item);
      }

      if (labelCode) {
        if (!indexes.byLabel[labelCode]) indexes.byLabel[labelCode] = [];
        indexes.byLabel[labelCode].push(item);
      }

      return indexes;
    }, { byXml: {}, byLabel: {} });
  }

function _detailIndexes_(details) {
  return (details || []).reduce(function(indexes, item) {
    const id = _str_(item.idDetalle);
    const internal = _normalizeCode_(item.codigoInterno);
    const xml = _normalizeCode_(item.codigoProveedorXml);
    const product = _str_(item.idProducto);

    if (id) indexes.byId[id] = item;
    if (internal) indexes.byInternal[internal] = item;
    if (xml) indexes.byXml[xml] = item;
    if (product) indexes.byProduct[product] = item;

    return indexes;
  }, {
    byId: {},
    byInternal: {},
    byXml: {},
    byProduct: {}
  });
}

  function _isCountableType_(type) {
    return _upper_(type) === DOMAIN.CLASIFICACION_CONCEPTO.PRODUCTO;
  }

  function _selectUniqueEquivalence_(items, code, sourceName) {
    const candidates = Array.isArray(items) ? items : [];

    _assert_(
      candidates.length <= 1,
      "VE_EQUIVALENCIA_AMBIGUA",
      "Existe más de una equivalencia activa para el mismo código.",
      { source: sourceName, code: code, candidates: candidates.length }
    );

    return candidates.length === 1 ? candidates[0] : null;
  }

  function _applyEquivalences_(conceptos, equivalencias, trace) {
    const startedAt = Date.now();
    const indexes = _equivalenceIndexes_(equivalencias);

    const result = conceptos.map(function(concepto) {
      const code = _normalizeCode_(concepto.codigoProveedorXml);
      const equivalencia = code
        ? _selectUniqueEquivalence_(indexes.byXml[code], code, "XML")
        : null;

      if (!equivalencia) {
        return Object.assign({}, concepto, {
          codigoEtiqueta: "",
          codigoInterno: "",
          idProducto: "",
          descripcionInterna: "",
          unidadInterna: "",
          factorConversion: 1,
          cantidadEsperada: concepto.cantidadXml,
          clasificacion: DOMAIN.CLASIFICACION_CONCEPTO.REQUIERE_REVISION,
          incluirEnConteo: false,
          confianzaClasificacion: "BAJA",
          motivoExclusion: "SIN_EQUIVALENCIA_ACTIVA",
          requiereRevision: true
        });
      }

      const factor = _num_(equivalencia.factorConversion);
      const classification = _upper_(equivalencia.tipoConcepto) ||
        DOMAIN.CLASIFICACION_CONCEPTO.REQUIERE_REVISION;
      const internalCode = _normalizeCode_(equivalencia.codigoInterno);
      const productId = _str_(equivalencia.idProducto);
      const isProduct = _isCountableType_(classification);
      const complete = Boolean(internalCode && productId && factor > 0);
      const countable = Boolean(isProduct && complete);

      return Object.assign({}, concepto, {
        codigoEtiqueta: _normalizeCode_(equivalencia.codigoEtiqueta),
        codigoInterno: internalCode,
        idProducto: productId,
        descripcionInterna: _str_(equivalencia.descripcionInterna),
        unidadInterna: _upper_(equivalencia.unidadInterna),
        factorConversion: factor > 0 ? factor : 1,
        cantidadEsperada: _round_(concepto.cantidadXml * (factor > 0 ? factor : 1)),
        clasificacion: classification,
        incluirEnConteo: countable,
        confianzaClasificacion: _upper_(equivalencia.nivelConfianza) || "MEDIA",
        motivoExclusion: countable ? "" : isProduct ? "EQUIVALENCIA_INCOMPLETA" : classification,
        requiereRevision: !countable && (
          isProduct ||
          classification === DOMAIN.CLASIFICACION_CONCEPTO.REQUIERE_REVISION
        )
      });
    });

    perfMark_(trace, "VE_EQUIVALENCES_APPLIED", {
      elapsedMs: Date.now() - startedAt,
      concepts: result.length,
      countable: result.filter(function(item) { return item.incluirEnConteo; }).length,
      reviewRequired: result.filter(function(item) { return item.requiereRevision; }).length
    });

    return result;
  }

  function _consolidateConcepts_(conceptos, trace) {
    const startedAt = Date.now();
    const map = {};

    (conceptos || []).forEach(function(item) {
      const key = [
        item.codigoProveedorXml || "SIN_CODIGO",
        item.claveUnidadXml || "SIN_UNIDAD",
        item.clasificacion || "SIN_CLASIFICACION",
        item.codigoInterno || "SIN_INTERNO"
      ].join("|");

      if (!map[key]) {
        map[key] = Object.assign({}, item, {
          cantidadXml: 0,
          cantidadEsperada: 0,
          renglonesOriginales: []
        });
      }

      map[key].cantidadXml = _round_(map[key].cantidadXml + item.cantidadXml);
      map[key].cantidadEsperada = _round_(map[key].cantidadEsperada + item.cantidadEsperada);
      map[key].renglonesOriginales = map[key].renglonesOriginales.concat(item.renglonesOriginales || []);
    });

    const result = Object.keys(map).map(function(key) { return map[key]; });

    perfMark_(trace, "VE_CONCEPTS_CONSOLIDATED", {
      elapsedMs: Date.now() - startedAt,
      sourceRows: (conceptos || []).length,
      rows: result.length
    });

    return result;
  }

  function _newEvent_(type, data, userContext) {
    const temporal = getTemporalContext_();
    const payload = data || {};
    const user = userContext || _currentUser_({});

    return {
      idEvento: _uuidToken_("VE-EVT"),
      idSesion: _str_(payload.idSesion),
      tipoEvento: _upper_(type),
      idUnicoCaja: _str_(payload.idUnicoCaja),
      idDetalle: _str_(payload.idDetalle),
      codigoInterno: _normalizeCode_(payload.codigoInterno),
      cantidad: _num_(payload.cantidad),
      estadoAnterior: _upper_(payload.estadoAnterior),
      estadoNuevo: _upper_(payload.estadoNuevo),
      resultado: _upper_(payload.resultado),
      codigoMotivo: _upper_(payload.codigoMotivo),
      mensaje: _str_(payload.mensaje),
      usuario: user.usuario,
      rolUsuario: user.rol,
      fecha: temporal.fecha,
      hora: temporal.hora,
      timestampMs: temporal.ahora.getTime(),
      metadataJson: payload.metadata || {},
      creadoEn: temporal.ahora
    };
  }

  function _sessionStateAllowedForCapture_(state) {
    return [
      DOMAIN.ESTADOS_SESION.EN_CAPTURA,
      DOMAIN.ESTADOS_SESION.CON_DIFERENCIAS,
      DOMAIN.ESTADOS_SESION.COMPLETA
    ].includes(_upper_(state));
  }

  function _summaryFromState_(detalle, cajas) {
    const activeBoxes = (cajas || []).filter(function(box) {
      return box.estadoCaja !== CANCELADA;
    });

    const boxesByDetail = activeBoxes.reduce(function(index, box) {
      if (!index[box.idDetalle]) index[box.idDetalle] = [];
      index[box.idDetalle].push(box);
      return index;
    }, {});

    const detailSummary = (detalle || []).map(function(item) {
      const boxes = boxesByDetail[item.idDetalle] || [];
      const captured = _round_(boxes.reduce(function(total, box) {
        return total + Math.abs(_num_(box.cantidadCaja));
      }, 0));
      const expected = item.incluirEnConteo ? Math.abs(_num_(item.cantidadEsperada)) : 0;
      const missing = item.incluirEnConteo ? _round_(Math.max(0, expected - captured)) : 0;
      const over = item.incluirEnConteo ? _round_(Math.max(0, captured - expected)) : 0;
      let state = item.estadoSku;

      if (item.incluirEnConteo) {
        if (over > 0) state = DOMAIN.ESTADOS_SKU.SOBRANTE;
        else if (missing === 0 && expected > 0) state = DOMAIN.ESTADOS_SKU.COMPLETO;
        else if (captured > 0) state = DOMAIN.ESTADOS_SKU.PARCIAL;
        else state = DOMAIN.ESTADOS_SKU.PENDIENTE;
      } else if (item.requiereRevision) {
        state = DOMAIN.ESTADOS_SKU.REQUIERE_REVISION;
      }

      return Object.assign({}, item, {
        cantidadCapturada: captured,
        cantidadFaltante: missing,
        cantidadSobrante: over,
        totalCajas: boxes.length,
        estadoSku: state
      });
    });

    const countable = detailSummary.filter(function(item) { return item.incluirEnConteo; });
    const expectedTotal = _round_(countable.reduce(function(total, item) { return total + item.cantidadEsperada; }, 0));
    const capturedTotal = _round_(countable.reduce(function(total, item) { return total + item.cantidadCapturada; }, 0));
    const missingTotal = _round_(countable.reduce(function(total, item) { return total + item.cantidadFaltante; }, 0));
    const overTotal = _round_(countable.reduce(function(total, item) { return total + item.cantidadSobrante; }, 0));
    const requiresReview = detailSummary.some(function(item) { return item.requiereRevision; });

    let sessionState = DOMAIN.ESTADOS_SESION.EN_CAPTURA;
    if (missingTotal === 0 && overTotal === 0 && !requiresReview) {
      sessionState = DOMAIN.ESTADOS_SESION.COMPLETA;
    } else if (capturedTotal > 0 || overTotal > 0) {
      sessionState = DOMAIN.ESTADOS_SESION.CON_DIFERENCIAS;
    }

    return {
      detalle: detailSummary,
      cajasActivas: activeBoxes,
      cantidadEsperada: expectedTotal,
      cantidadCapturada: capturedTotal,
      cantidadFaltante: missingTotal,
      cantidadSobrante: overTotal,
      totalCajas: activeBoxes.length,
      requiereRevision: requiresReview,
      estadoSesion: sessionState
    };
  }

  /**
   * Actualiza únicamente los SKU afectados por el lote y una vez la sesión.
   * La conciliación se calcula contra todas las cajas activas para conservar integridad.
   */
function _updateDerivedState_(
  session,
  summary,
  affectedDetailIds,
  trace
) {
  const startedAt = Date.now();
  const temporal = getTemporalContext_();
  const affected = affectedDetailIds || {};
  const filterAffected = Object.keys(affected).length > 0;

  const rowsToUpdate = (summary.detalle || []).filter(function(item) {
    return !filterAffected || affected[item.idDetalle] === true;
  });

  const detailWriteStartedAt = Date.now();

  if (rowsToUpdate.length > 0) {
    REPOSITORY.actualizarDetallesPorLote(
      rowsToUpdate.map(function(item) {
        return {
          idDetalle: item.idDetalle,
          rowNumber: item.rowNumber,
          patch: {
            cantidadCapturada: item.cantidadCapturada,
            cantidadFaltante: item.cantidadFaltante,
            cantidadSobrante: item.cantidadSobrante,
            totalCajas: item.totalCajas,
            estadoSku: item.estadoSku,
            actualizadoEn: temporal.ahora
          }
        };
      }),
      trace
    );
  }

  perfMark_(trace, "VE_DETAILS_UPDATED", {
    elapsedMs: Date.now() - detailWriteStartedAt,
    detailRowsTotal: summary.detalle.length,
    detailRowsUpdated: rowsToUpdate.length
  });

  const sessionPatch = {
    estadoSesion: summary.estadoSesion,
    cantidadCapturada: summary.cantidadCapturada,
    cantidadFaltante: summary.cantidadFaltante,
    cantidadSobrante: summary.cantidadSobrante,
    totalCajas: summary.totalCajas,
    actualizadoEn: temporal.ahora
  };

  const sessionWriteStartedAt = Date.now();
  const canUseKnownRow = Boolean(
    Number.isInteger(Number(session && session.rowNumber)) &&
    Number(session.rowNumber) >= 2 &&
    typeof REPOSITORY.actualizarSesionPorFila === "function"
  );

  if (canUseKnownRow) {
    REPOSITORY.actualizarSesionPorFila(
      Number(session.rowNumber),
      sessionPatch,
      trace
    );
  } else {
    REPOSITORY.actualizarSesion(
      session.idSesion,
      sessionPatch,
      trace
    );
  }

  perfMark_(trace, "VE_SESSION_UPDATED", {
    elapsedMs: Date.now() - sessionWriteStartedAt,
    usedKnownRow: canUseKnownRow
  });

  perfMark_(trace, "VE_DERIVED_STATE_UPDATED", {
    elapsedMs: Date.now() - startedAt,
    detailRowsTotal: summary.detalle.length,
    detailRowsUpdated: rowsToUpdate.length,
    boxes: summary.totalCajas
  });
}

  function _getSessionBundle_(idSesion, trace) {
    const session = REPOSITORY.getSesionPorId(idSesion, trace);
    _assert_(session, "VE_SESION_NO_ENCONTRADA", "No se encontró la sesión de entrada.");

    const detail = REPOSITORY.getDetallePorSesion(idSesion, trace);
    const boxes = REPOSITORY.getCajasPorSesion(idSesion, trace);
    const events = REPOSITORY.getEventosPorSesion(idSesion, trace);
    const summary = _summaryFromState_(detail, boxes);

    return {
      sesion: session,
      detalle: summary.detalle,
      cajas: boxes,
      eventos: events,
      resumen: {
        cantidadEsperada: summary.cantidadEsperada,
        cantidadCapturada: summary.cantidadCapturada,
        cantidadFaltante: summary.cantidadFaltante,
        cantidadSobrante: summary.cantidadSobrante,
        totalCajas: summary.totalCajas,
        requiereRevision: summary.requiereRevision,
        estadoCalculado: summary.estadoSesion
      }
    };
  }

  function getBootstrap(rfcEmisor, context, trace) {
    const ownTrace = trace || perfStart_("VE_SERVICE_BOOTSTRAP", {
      hasRfc: Boolean(_normalizeRfc_(rfcEmisor))
    });

    try {
      REPOSITORY.assertConfiguration(ownTrace);
      let provider = null;
      let equivalences = [];

      if (_normalizeRfc_(rfcEmisor)) {
        provider = _getProfileByRfc_(rfcEmisor, ownTrace);
        equivalences = REPOSITORY.getEquivalenciasPorRfc(provider.rfc, ownTrace);
      }

      const result = {
        version: DOMAIN.VERSION,
        usuario: _currentUser_(context),
        proveedor: provider ? {
          rfc: provider.rfc,
          idProveedor: _str_(provider.profile.idProveedor),
          nombre: _str_(provider.profile.nombre),
          estrategiaEtiqueta: _upper_(provider.profile.estrategiaEtiqueta),
          versionPerfil: _str_(provider.profile.versionPerfil),
          configuracionEtiqueta: provider.profile.configuracionEtiqueta || {}
        } : null,
        equivalencias: equivalences,
        estados: {
          sesion: DOMAIN.ESTADOS_SESION,
          sku: DOMAIN.ESTADOS_SKU,
          caja: DOMAIN.ESTADOS_CAJA
        }
      };

      perfMark_(ownTrace, "VE_BOOTSTRAP_READY", {
        hasProvider: Boolean(provider),
        equivalences: equivalences.length,
        responseChars: perfMeasureJsonChars_(result)
      });

      if (!trace) perfEnd_(ownTrace, "ok", { equivalences: equivalences.length });
      return result;
    } catch (error) {
      if (!trace) perfFail_(ownTrace, error);
      throw error;
    }
  }

  function crearSesion(payload, context, trace) {
    const ownTrace = trace || perfStart_("VE_SERVICE_CREATE_SESSION", {
      concepts: Array.isArray(payload && payload.conceptos) ? payload.conceptos.length : 0
    });

    try {
      const source = payload || {};
      const document = _assertDocument_(source.documento || source, ownTrace);
      const provider = _getProfileByRfc_(document.rfcEmisor, ownTrace);
      const normalizedConcepts = _normalizeConcepts_(source.conceptos, provider.rfc, ownTrace);
      const equivalences = REPOSITORY.getEquivalenciasPorRfc(provider.rfc, ownTrace);
      const applied = _applyEquivalences_(normalizedConcepts, equivalences, ownTrace);
      const consolidated = _consolidateConcepts_(applied, ownTrace);
      const countable = consolidated.filter(function(item) { return item.incluirEnConteo; });

      _assert_(countable.length > 0, "VE_SIN_PRODUCTOS_VERIFICABLES", "El CFDI no contiene productos catalogados aptos para conteo.");
      _assert_(countable.length <= Number(DOMAIN.LIMITES.MAX_SKUS_POR_SESION), "VE_LIMITE_SKUS_EXCEDIDO", "La sesión excede el número máximo de SKU permitido.");

      const user = _currentUser_(context);
      const idSesion = _uuidToken_("VE-SES");
      const temporal = getTemporalContext_();
      const strategy = _upper_(provider.profile.estrategiaEtiqueta);
      const expectedTotal = _round_(countable.reduce(function(total, item) {
        return total + item.cantidadEsperada;
      }, 0));
      const excluded = consolidated.filter(function(item) {
        return !item.incluirEnConteo && !item.requiereRevision;
      }).length;

      const session = {
        idSesion: idSesion,
        hashXml: document.hashXml,
        uuidCfdi: document.uuidCfdi,
        rfcEmisor: provider.rfc,
        nombreEmisor: document.nombreEmisor,
        serie: document.serie,
        folio: document.folio,
        fechaCfdi: document.fechaCfdi,
        versionCfdi: document.versionCfdi,
        tipoComprobante: document.tipoComprobante,
        moneda: document.moneda,
        nombreArchivo: document.nombreArchivo,
        estrategiaEtiqueta: strategy,
        estadoSesion: DOMAIN.ESTADOS_SESION.EN_CAPTURA,
        totalSkus: countable.length,
        totalConceptos: normalizedConcepts.length,
        conceptosExcluidos: excluded,
        cantidadEsperada: expectedTotal,
        cantidadCapturada: 0,
        cantidadFaltante: expectedTotal,
        cantidadSobrante: 0,
        totalCajas: 0,
        iniciadaPor: user.usuario,
        fechaInicio: temporal.fecha,
        horaInicio: temporal.hora,
        fechaCierre: "",
        horaCierre: "",
        cerradaPor: "",
        segundosActivos: 0,
        segundosPausados: 0,
        observacionCierre: "",
        resultadoFinal: "",
        versionPerfil: _str_(provider.profile.versionPerfil),
        creadoEn: temporal.ahora,
        actualizadoEn: temporal.ahora
      };

      const details = consolidated.map(function(item) {
        return {
          idDetalle: _uuidToken_("VE-DET"),
          idSesion: idSesion,
          rfcEmisor: provider.rfc,
          codigoProveedorXml: item.codigoProveedorXml,
          codigoInterno: item.codigoInterno,
          idProducto: item.idProducto,
          descripcionXml: item.descripcionXml,
          descripcionInterna: item.descripcionInterna,
          claveProdServ: item.claveProdServ,
          claveUnidadXml: item.claveUnidadXml,
          unidadXml: item.unidadXml,
          unidadInterna: item.unidadInterna,
          factorConversion: item.factorConversion,
          cantidadXml: item.cantidadXml,
          cantidadEsperada: item.incluirEnConteo ? item.cantidadEsperada : 0,
          cantidadCapturada: 0,
          cantidadFaltante: item.incluirEnConteo ? item.cantidadEsperada : 0,
          cantidadSobrante: 0,
          totalCajas: 0,
          estadoSku: item.requiereRevision
            ? DOMAIN.ESTADOS_SKU.REQUIERE_REVISION
            : DOMAIN.ESTADOS_SKU.PENDIENTE,
          clasificacion: item.clasificacion,
          incluirEnConteo: item.incluirEnConteo,
          confianzaClasificacion: item.confianzaClasificacion,
          motivoExclusion: item.motivoExclusion,
          renglonesOriginales: item.renglonesOriginales,
          requiereRevision: item.requiereRevision,
          observacion: "",
          creadoEn: temporal.ahora,
          actualizadoEn: temporal.ahora
        };
      });

      const initialEvent = _newEvent_(
        DOMAIN.TIPOS_EVENTO.SESION_CREADA,
        {
          idSesion: idSesion,
          estadoNuevo: DOMAIN.ESTADOS_SESION.EN_CAPTURA,
          resultado: "OK",
          codigoMotivo: "SESION_CREADA",
          mensaje: "Sesión de Verificación de entrada creada.",
          metadata: {
            totalSkus: countable.length,
            totalConceptos: normalizedConcepts.length,
            conceptosExcluidos: excluded,
            requiereRevision: consolidated.some(function(item) {
              return item.requiereRevision;
            })
          }
        },
        user
      );

      const persisted = withScriptLock_(
        "VE_CREATE_SESSION",
        function() {
          const duplicateStartedAt = Date.now();
          const duplicates = REPOSITORY.getSesionDuplicada(
            document.hashXml,
            document.uuidCfdi,
            ownTrace
          );

          _assert_(
            !duplicates.byHash,
            "VE_XML_DUPLICADO",
            "Este archivo XML ya fue registrado en una sesión."
          );

          _assert_(
            !duplicates.byUuid,
            "VE_UUID_DUPLICADO",
            "Este CFDI ya fue registrado en una sesión."
          );

          perfMark_(ownTrace, "VE_DUPLICATES_CHECKED", {
            elapsedMs: Date.now() - duplicateStartedAt,
            hashFound: Boolean(duplicates.byHash),
            uuidFound: Boolean(duplicates.byUuid)
          });

          return REPOSITORY.crearSesionConDetalle(session, details, [initialEvent], ownTrace);
        },
        30000,
        ownTrace
      );

      const result = {
        sesion: session,
        detalle: details,
        resumen: {
          cantidadEsperada: expectedTotal,
          cantidadCapturada: 0,
          cantidadFaltante: expectedTotal,
          cantidadSobrante: 0,
          totalCajas: 0,
          estadoCalculado: DOMAIN.ESTADOS_SESION.EN_CAPTURA
        },
        persistencia: {
          sesionEscrita: Boolean(persisted && persisted.sesion),
          detallesEscritos: details.length,
          eventosEscritos: 1
        }
      };

      perfMark_(ownTrace, "VE_CREATE_SESSION_RESPONSE_READY", {
        detailRows: details.length,
        responseChars: perfMeasureJsonChars_(result)
      });

      if (!trace) perfEnd_(ownTrace, "ok", {
        detailRows: details.length,
        countableSkus: countable.length
      });

      return result;
    } catch (error) {
      if (!trace) perfFail_(ownTrace, error);
      throw error;
    }
  }

  function obtenerSesion(idSesion, trace) {
    const ownTrace = trace || perfStart_("VE_SERVICE_GET_SESSION", {
      hasSessionId: Boolean(_str_(idSesion))
    });

    try {
      const result = _getSessionBundle_(_str_(idSesion), ownTrace);
      perfMark_(ownTrace, "VE_SESSION_BUNDLE_READY", {
        detailRows: result.detalle.length,
        boxes: result.cajas.length,
        events: result.eventos.length,
        responseChars: perfMeasureJsonChars_(result)
      });
      if (!trace) perfEnd_(ownTrace, "ok", {
        detailRows: result.detalle.length,
        boxes: result.cajas.length
      });
      return result;
    } catch (error) {
      if (!trace) perfFail_(ownTrace, error);
      throw error;
    }
  }

  function _resolveDetailForBox_(
    box,
    detailIndexes,
    equivalenceIndexes
  ) {
    const source = box || {};
    const idDetalle = _str_(source.idDetalle);
    const internalCode = _normalizeCode_(source.codigoInterno);
    const xmlCode = _normalizeCode_(source.codigoProveedorXml);
    const labelCode = _normalizeCode_(source.codigoEtiqueta);

    if (idDetalle && detailIndexes.byId[idDetalle]) {
      return detailIndexes.byId[idDetalle];
    }

    if (internalCode && detailIndexes.byInternal[internalCode]) {
      return detailIndexes.byInternal[internalCode];
    }

    if (xmlCode && detailIndexes.byXml[xmlCode]) {
      return detailIndexes.byXml[xmlCode];
    }

    if (!labelCode) {
      return null;
    }

    const equivalence = _selectUniqueEquivalence_(
      equivalenceIndexes.byLabel[labelCode],
      labelCode,
      "ETIQUETA"
    );

    if (!equivalence) {
      return detailIndexes.byXml[labelCode] || null;
    }

    const equivalenceXml = _normalizeCode_(
      equivalence.codigoProveedorXml
    );
    const equivalenceInternal = _normalizeCode_(
      equivalence.codigoInterno
    );
    const equivalenceProduct = _str_(equivalence.idProducto);

    const detail =
      detailIndexes.byXml[equivalenceXml] ||
      detailIndexes.byInternal[equivalenceInternal] ||
      detailIndexes.byProduct[equivalenceProduct] ||
      null;

    if (!detail) {
      return null;
    }

    const xmlMatches = equivalenceXml &&
      _normalizeCode_(detail.codigoProveedorXml) === equivalenceXml;
    const internalMatches = equivalenceInternal &&
      _normalizeCode_(detail.codigoInterno) === equivalenceInternal;
    const productMatches = equivalenceProduct &&
      _str_(detail.idProducto) === equivalenceProduct;

    return xmlMatches && (internalMatches || productMatches)
      ? detail
      : null;
  }

  function _validateProviderBoxRules_(input, detail, profileResult) {
    const profile = profileResult.profile || {};
    const config = profile.configuracionEtiqueta || {};
    const sequence = _str_(input.consecutivoProveedor);
    const readUnit = _normalizeUnit_(input.unidadLeida);
    const expectedUnit = _normalizeUnit_(
      detail.unidadInterna || detail.claveUnidadXml || detail.unidadXml
    );

    if (config.requiereSegundaLectura === true) {
      _assert_(sequence, "VE_IDENTIFICADOR_SECUNDARIO_REQUERIDO", "La etiqueta requiere el segundo código de barras.");

      const secondaryPatternText = config.segundaLectura && config.segundaLectura.patron
        ? _str_(config.segundaLectura.patron)
        : "";

      if (secondaryPatternText) {
        _assert_(
          new RegExp(secondaryPatternText).test(sequence),
          "VE_IDENTIFICADOR_SECUNDARIO_INVALIDO",
          "El segundo código de barras no cumple el formato del proveedor."
        );
      }
    }

    _assert_(
      !readUnit || !expectedUnit || readUnit === expectedUnit,
      "VE_UNIDAD_LECTURA_NO_COMPATIBLE",
      "La unidad de la etiqueta no coincide con la unidad esperada del producto.",
      { unidadLeida: readUnit, unidadEsperada: expectedUnit }
    );

    return {
      sequence: sequence,
      readUnit: readUnit,
      expectedUnit: expectedUnit
    };
  }

  function _normalizeBoxInput_(input, session, detail, user, temporal, profileResult) {
    const quantity = Math.abs(_num_(input.cantidadCaja));
    const fingerprint = _upper_(input.huellaLectura);
    const labelCode = _normalizeCode_(input.codigoEtiqueta);

    _assert_(quantity > 0, "VE_CANTIDAD_CAJA_INVALIDA", "La cantidad de la caja debe ser mayor que cero.");

    const profileConfig = profileResult.profile.configuracionEtiqueta || {};
    const configuredMax = Number(profileConfig.cantidadMaxima || 100000000);

    _assert_(quantity <= configuredMax, "VE_CANTIDAD_CAJA_EXCEDE_LIMITE", "La cantidad de la caja excede el límite permitido.");
    _assert_(detail && detail.incluirEnConteo === true, "VE_SKU_NO_VERIFICABLE", "La etiqueta no corresponde a un producto verificable de la sesión.");
    _assert_(labelCode, "VE_CODIGO_ETIQUETA_REQUERIDO", "La lectura no contiene un código de producto válido.");
    _assert_(fingerprint && _isHexHash_(fingerprint), "VE_HUELLA_LECTURA_INVALIDA", "La lectura no contiene una huella SHA-256 válida.");

    const providerValidation = _validateProviderBoxRules_(input, detail, profileResult);
    const unit = providerValidation.expectedUnit ||
      providerValidation.readUnit ||
      _upper_(detail.unidadInterna || detail.unidadXml);

    return {
      idUnicoCaja: _uuidToken_("VE-CAJ"),
      idSesion: session.idSesion,
      idDetalle: detail.idDetalle,
      rfcEmisor: session.rfcEmisor,
      codigoProveedorXml: detail.codigoProveedorXml,
      codigoEtiqueta: labelCode,
      codigoInterno: detail.codigoInterno,
      idProducto: detail.idProducto,
      cantidadCaja: quantity,
      unidad: unit,
      consecutivoProveedor: providerValidation.sequence,
      estrategiaEtiqueta: session.estrategiaEtiqueta,
      huellaLectura: fingerprint,
      longitudLectura: Math.max(0, _num_(input.longitudLectura)),
      estadoCaja: DOMAIN.ESTADOS_CAJA.CAPTURADA,
      resultadoValidacion: "ACEPTADA",
      advertencias: Array.isArray(input.advertencias) ? input.advertencias.slice(0, 20) : [],
      capturadaPor: user.usuario,
      fechaCaptura: temporal.fecha,
      horaCaptura: temporal.hora,
      canceladaPor: "",
      fechaCancelacion: "",
      horaCancelacion: "",
      motivoCancelacion: "",
      observacion: _safeObservation_(input.observacion),
      creadoEn: temporal.ahora
    };
  }

  function obtenerSesionLigera(idSesion, trace) {
  const ownTrace = trace || perfStart_(
    "VE_SERVICE_GET_SESSION_LIGHT",
    {
      hasSessionId: Boolean(_str_(idSesion))
    }
  );

  try {
    const normalizedId = _str_(idSesion);
    const session = REPOSITORY.getSesionPorId(
      normalizedId,
      ownTrace
    );

    _assert_(
      session,
      "VE_SESION_NO_ENCONTRADA",
      "No se encontró la sesión de entrada."
    );

    const detail = REPOSITORY.getDetallePorSesion(
      normalizedId,
      ownTrace
    );
    const boxes = REPOSITORY.getCajasPorSesion(
      normalizedId,
      ownTrace
    );
    const summary = _summaryFromState_(detail, boxes);

    const result = {
      sesion: session,
      detalle: summary.detalle,
      cajas: [],
      eventos: [],
      resumen: {
        cantidadEsperada: summary.cantidadEsperada,
        cantidadCapturada: summary.cantidadCapturada,
        cantidadFaltante: summary.cantidadFaltante,
        cantidadSobrante: summary.cantidadSobrante,
        totalCajas: summary.totalCajas,
        requiereRevision: summary.requiereRevision,
        estadoCalculado: summary.estadoSesion
      }
    };

    perfMark_(ownTrace, "VE_SESSION_LIGHT_READY", {
      detailRows: result.detalle.length,
      boxesRead: boxes.length
    });

    if (!trace) perfEnd_(ownTrace, "ok");
    return result;
  } catch (error) {
    if (!trace) perfFail_(ownTrace, error);
    throw error;
  }
}

  /**
   * Registra un micro-lote de cajas bajo un único ScriptLock.
   * Recomendación de frontend: 2 a 10 cajas por llamada.
   */
  function registrarCajas(payload, context, trace) {
  const inputs = Array.isArray(payload && payload.cajas)
    ? payload.cajas
    : [];

  const ownTrace = trace || perfStart_("VE_SERVICE_REGISTER_BOXES", {
    boxes: inputs.length
  });

  try {
    const inputValidationStartedAt = Date.now();
    const idSesion = _str_(payload && payload.idSesion);

    _assert_(
      idSesion,
      "VE_ID_SESION_REQUERIDO",
      "Se requiere el identificador de sesión."
    );
    _assert_(
      inputs.length > 0,
      "VE_CAJAS_REQUERIDAS",
      "No se recibieron cajas para registrar."
    );
    _assert_(
      inputs.length <= 200,
      "VE_LOTE_CAJAS_EXCEDE_LIMITE",
      "El lote de cajas excede el límite permitido."
    );

    perfMark_(ownTrace, "VE_SERVICE_INPUT_VALIDATED", {
      elapsedMs: Date.now() - inputValidationStartedAt,
      boxes: inputs.length
    });

    const user = _currentUser_(context);
    const lockWaitStartedAt = Date.now();

    perfMark_(ownTrace, "VE_LOCK_WAIT_STARTED", {
      boxes: inputs.length
    });

    const result = withScriptLock_(
      "VE_REGISTER_BOXES",
      function() {
        perfMark_(ownTrace, "VE_LOCK_ACQUIRED", {
          elapsedMs: Date.now() - lockWaitStartedAt
        });

        let startedAt = Date.now();
        const session = REPOSITORY.getSesionPorId(idSesion, ownTrace);
        perfMark_(ownTrace, "VE_SESSION_READ", {
          elapsedMs: Date.now() - startedAt,
          found: Boolean(session)
        });

        _assert_(
          session,
          "VE_SESION_NO_ENCONTRADA",
          "No se encontró la sesión de entrada."
        );
        _assert_(
          _sessionStateAllowedForCapture_(session.estadoSesion),
          "VE_SESION_NO_CAPTURABLE",
          "La sesión no admite nuevas cajas en su estado actual."
        );

        startedAt = Date.now();
        const profileResult = _getProfileByRfc_(
          session.rfcEmisor,
          ownTrace
        );
        perfMark_(ownTrace, "VE_PROFILE_RESOLVED", {
          elapsedMs: Date.now() - startedAt
        });

        startedAt = Date.now();

        _assert_(
          typeof REPOSITORY.getEquivalenciasPorEtiquetas === "function",
          "VE_REPOSITORY_EQUIVALENCIAS_ETIQUETAS_NO_DISPONIBLE",
          "El Repository no expone la búsqueda optimizada por etiquetas."
        );

        const requestedLabelCodes = Array.from(new Set(
          inputs.map(function(item) {
            return _normalizeCode_(item && item.codigoEtiqueta);
          }).filter(Boolean)
        ));

        _assert_(
          requestedLabelCodes.length > 0,
          "VE_CODIGOS_ETIQUETA_REQUERIDOS",
          "El lote no contiene códigos de etiqueta válidos."
        );

        const equivalences = REPOSITORY.getEquivalenciasPorEtiquetas(
          session.rfcEmisor,
          requestedLabelCodes,
          ownTrace
        );
        const equivalenceIndexes = _equivalenceIndexes_(equivalences);

        perfMark_(ownTrace, "VE_EQUIVALENCES_READ", {
          elapsedMs: Date.now() - startedAt,
          requestedLabels: requestedLabelCodes.length,
          rows: equivalences.length,
          strategy: "LABELS_ONLY"
        });

        startedAt = Date.now();
        const details = REPOSITORY.getDetallePorSesion(
          idSesion,
          ownTrace
        );
        const detailIndexes = _detailIndexes_(details);
        perfMark_(ownTrace, "VE_DETAILS_READ", {
          elapsedMs: Date.now() - startedAt,
          rows: details.length
        });

        startedAt = Date.now();
        const existingBoxes = REPOSITORY.getCajasPorSesion(
          idSesion,
          ownTrace
        );
        perfMark_(ownTrace, "VE_EXISTING_BOXES_READ", {
          elapsedMs: Date.now() - startedAt,
          rows: existingBoxes.length
        });

        const activeFingerprints = existingBoxes.reduce(
          function(index, box) {
            if (box.estadoCaja !== CANCELADA && box.huellaLectura) {
              index[_upper_(box.huellaLectura)] = true;
            }
            return index;
          },
          {}
        );

        const temporal = getTemporalContext_();
        const batchFingerprints = {};
        const affectedDetailIds = {};
        const newBoxes = [];
        const events = [];

        startedAt = Date.now();

        inputs.forEach(function(input, index) {
          const source = input || {};
          const detail = _resolveDetailForBox_(
            source,
            detailIndexes,
            equivalenceIndexes
          );

          const box = _normalizeBoxInput_(
            source,
            session,
            detail,
            user,
            temporal,
            profileResult
          );

          _assert_(
            !activeFingerprints[box.huellaLectura],
            "VE_LECTURA_DUPLICADA",
            "La etiqueta ya fue registrada en esta sesión.",
            { row: index + 1 }
          );

          _assert_(
            !batchFingerprints[box.huellaLectura],
            "VE_LECTURA_DUPLICADA_EN_LOTE",
            "La misma etiqueta aparece más de una vez en el lote.",
            { row: index + 1 }
          );

          batchFingerprints[box.huellaLectura] = true;
          activeFingerprints[box.huellaLectura] = true;
          affectedDetailIds[box.idDetalle] = true;
          newBoxes.push(box);

          events.push(_newEvent_(
            DOMAIN.TIPOS_EVENTO.CAJA_CAPTURADA,
            {
              idSesion: idSesion,
              idUnicoCaja: box.idUnicoCaja,
              idDetalle: box.idDetalle,
              codigoInterno: box.codigoInterno,
              cantidad: box.cantidadCaja,
              estadoNuevo: box.estadoCaja,
              resultado: "OK",
              codigoMotivo: "CAJA_CAPTURADA",
              mensaje: "Caja capturada.",
              metadata: {
                batchSize: inputs.length,
                hasFingerprint: true,
                warnings: box.advertencias.length,
                unidad: box.unidad,
                hasSecondaryIdentifier: Boolean(
                  box.consecutivoProveedor
                )
              }
            },
            user
          ));
        });

        perfMark_(ownTrace, "VE_BOXES_NORMALIZED", {
          elapsedMs: Date.now() - startedAt,
          boxes: newBoxes.length,
          affectedDetails: Object.keys(affectedDetailIds).length
        });

        const activeExistingCount = existingBoxes.filter(function(box) {
          return box.estadoCaja !== CANCELADA;
        }).length;

        _assert_(
          activeExistingCount + newBoxes.length <=
            Number(DOMAIN.LIMITES.MAX_CAJAS_POR_SESION),
          "VE_MAX_CAJAS_EXCEDIDO",
          "La sesión excedería el máximo de cajas permitido."
        );

        perfMark_(ownTrace, "VE_DUPLICATES_VALIDATED", {
          existingActiveBoxes: activeExistingCount,
          newBoxes: newBoxes.length
        });

        startedAt = Date.now();
        const persisted = REPOSITORY.registrarCajasConEventos(
          newBoxes,
          events,
          ownTrace
        );
        perfMark_(ownTrace, "VE_BOXES_AND_EVENTS_WRITTEN", {
          elapsedMs: Date.now() - startedAt,
          boxes: newBoxes.length,
          events: events.length
        });

        startedAt = Date.now();
        const summary = _summaryFromState_(
          details,
          existingBoxes.concat(newBoxes)
        );
        perfMark_(ownTrace, "VE_SUMMARY_CALCULATED", {
          elapsedMs: Date.now() - startedAt,
          detailRows: summary.detalle.length,
          activeBoxes: summary.totalCajas
        });

        _updateDerivedState_(
          session,
          summary,
          affectedDetailIds,
          ownTrace
        );

        return {
          cajasRegistradas: newBoxes.map(function(box) {
            return {
              idUnicoCaja: box.idUnicoCaja,
              idDetalle: box.idDetalle,
              cantidadCaja: box.cantidadCaja,
              estadoCaja: box.estadoCaja
            };
          }),
          resumen: {
            cantidadEsperada: summary.cantidadEsperada,
            cantidadCapturada: summary.cantidadCapturada,
            cantidadFaltante: summary.cantidadFaltante,
            cantidadSobrante: summary.cantidadSobrante,
            totalCajas: summary.totalCajas,
            requiereRevision: summary.requiereRevision,
            estadoCalculado: summary.estadoSesion
          },
          detalle: summary.detalle,
          rendimiento: {
            cajasProcesadas: newBoxes.length,
            skusAfectados: Object.keys(affectedDetailIds).length,
            cajasEscritas: Number(
              persisted && persisted.cajas && persisted.cajas.written ||
              newBoxes.length
            ),
            eventosEscritos: Number(
              persisted && persisted.eventos && persisted.eventos.written ||
              events.length
            )
          }
        };
      },
      30000,
      ownTrace
    );

    perfMark_(ownTrace, "VE_SERVICE_RESPONSE_READY", {
      boxes: result.cajasRegistradas.length,
      affectedDetails: result.rendimiento.skusAfectados
    });

    if (!trace) {
      perfEnd_(ownTrace, "ok", {
        boxes: result.cajasRegistradas.length,
        affectedDetails: result.rendimiento.skusAfectados
      });
    }

    return result;
  } catch (error) {
    if (!trace) perfFail_(ownTrace, error);
    throw error;
  }
}

  function cancelarCaja(payload, context, trace) {
    const ownTrace = trace || perfStart_("VE_SERVICE_CANCEL_BOX", {
      hasBoxId: Boolean(_str_(payload && payload.idUnicoCaja))
    });

    try {
      const idSesion = _str_(payload && payload.idSesion);
      const idUnicoCaja = _str_(payload && payload.idUnicoCaja);
      const reason = _safeObservation_(payload && payload.motivoCancelacion);
      const user = _currentUser_(context);

      _assert_(idSesion, "VE_ID_SESION_REQUERIDO", "Se requiere la sesión.");
      _assert_(idUnicoCaja, "VE_ID_CAJA_REQUERIDO", "Se requiere la caja.");
      _assert_(reason, "VE_MOTIVO_CANCELACION_REQUERIDO", "Se requiere un motivo de cancelación.");

      const result = withScriptLock_(
        "VE_CANCEL_BOX",
        function() {
          const session = REPOSITORY.getSesionPorId(idSesion, ownTrace);
          const box = REPOSITORY.getCajaPorId(idUnicoCaja, ownTrace);

          _assert_(session, "VE_SESION_NO_ENCONTRADA", "No se encontró la sesión.");
          _assert_(box, "VE_CAJA_NO_ENCONTRADA", "No se encontró la caja.");
          _assert_(box.idSesion === idSesion, "VE_CAJA_NO_PERTENECE_SESION", "La caja no pertenece a la sesión.");
          _assert_(session.estadoSesion !== DOMAIN.ESTADOS_SESION.CERRADA && session.estadoSesion !== DOMAIN.ESTADOS_SESION.CANCELADA, "VE_SESION_NO_MODIFICABLE", "La sesión ya no admite modificaciones.");
          _assert_(box.estadoCaja !== CANCELADA, "VE_CAJA_YA_CANCELADA", "La caja ya estaba cancelada.");

          const temporal = getTemporalContext_();

          REPOSITORY.actualizarCaja(idUnicoCaja, {
            estadoCaja: CANCELADA,
            resultadoValidacion: "CANCELADA",
            canceladaPor: user.usuario,
            fechaCancelacion: temporal.fecha,
            horaCancelacion: temporal.hora,
            motivoCancelacion: reason
          }, ownTrace);

          REPOSITORY.insertarEventos([
            _newEvent_(DOMAIN.TIPOS_EVENTO.CAJA_CANCELADA, {
              idSesion: idSesion,
              idUnicoCaja: idUnicoCaja,
              idDetalle: box.idDetalle,
              codigoInterno: box.codigoInterno,
              cantidad: box.cantidadCaja,
              estadoAnterior: box.estadoCaja,
              estadoNuevo: CANCELADA,
              resultado: "OK",
              codigoMotivo: "CAJA_CANCELADA",
              mensaje: "Caja cancelada.",
              metadata: { reasonProvided: true }
            }, user)
          ], ownTrace);

          const details = REPOSITORY.getDetallePorSesion(idSesion, ownTrace);
          const boxes = REPOSITORY.getCajasPorSesion(idSesion, ownTrace).map(function(item) {
            return item.idUnicoCaja === idUnicoCaja
              ? Object.assign({}, item, { estadoCaja: CANCELADA })
              : item;
          });
          const summary = _summaryFromState_(details, boxes);
          const affected = {};
          affected[box.idDetalle] = true;
          _updateDerivedState_(session, summary, affected, ownTrace);

          return {
            idUnicoCaja: idUnicoCaja,
            estadoCaja: CANCELADA,
            resumen: {
              cantidadEsperada: summary.cantidadEsperada,
              cantidadCapturada: summary.cantidadCapturada,
              cantidadFaltante: summary.cantidadFaltante,
              cantidadSobrante: summary.cantidadSobrante,
              totalCajas: summary.totalCajas,
              estadoCalculado: summary.estadoSesion
            },
            detalle: summary.detalle
          };
        },
        30000,
        ownTrace
      );

      perfMark_(ownTrace, "VE_CANCEL_BOX_RESPONSE_READY", {
        responseChars: perfMeasureJsonChars_(result)
      });
      if (!trace) perfEnd_(ownTrace, "ok");
      return result;
    } catch (error) {
      if (!trace) perfFail_(ownTrace, error);
      throw error;
    }
  }

  function _changeSessionState_(
    idSesion,
    targetState,
    eventType,
    context,
    trace
  ) {
    const user = _currentUser_(context);

    return withScriptLock_(
      "VE_CHANGE_SESSION_STATE",
      function() {
        const session = REPOSITORY.getSesionPorId(idSesion, trace);

        _assert_(
          session,
          "VE_SESION_NO_ENCONTRADA",
          "No se encontró la sesión."
        );
        _assert_(
          session.estadoSesion !== DOMAIN.ESTADOS_SESION.CERRADA &&
          session.estadoSesion !== DOMAIN.ESTADOS_SESION.CANCELADA,
          "VE_SESION_NO_MODIFICABLE",
          "La sesión ya no admite cambios de estado."
        );

        const temporal = getTemporalContext_();
        const patch = {
          estadoSesion: targetState,
          actualizadoEn: temporal.ahora
        };

        if (
          Number.isInteger(Number(session.rowNumber)) &&
          Number(session.rowNumber) >= 2 &&
          typeof REPOSITORY.actualizarSesionPorFila === "function"
        ) {
          REPOSITORY.actualizarSesionPorFila(
            Number(session.rowNumber),
            patch,
            trace
          );
        } else {
          REPOSITORY.actualizarSesion(
            idSesion,
            patch,
            trace
          );
        }

        REPOSITORY.insertarEventos([
          _newEvent_(
            eventType,
            {
              idSesion: idSesion,
              estadoAnterior: session.estadoSesion,
              estadoNuevo: targetState,
              resultado: "OK",
              codigoMotivo: eventType,
              mensaje: "Estado de sesión actualizado."
            },
            user
          )
        ], trace);

        return {
          idSesion: idSesion,
          estadoAnterior: session.estadoSesion,
          estadoSesion: targetState
        };
      },
      30000,
      trace
    );
  }

  function pausarSesion(idSesion, context, trace) {
    const ownTrace = trace || perfStart_("VE_SERVICE_PAUSE_SESSION", {
      hasSessionId: Boolean(_str_(idSesion))
    });
    try {
      const result = _changeSessionState_(_str_(idSesion), DOMAIN.ESTADOS_SESION.PAUSADA, DOMAIN.TIPOS_EVENTO.SESION_PAUSADA, context, ownTrace);
      if (!trace) perfEnd_(ownTrace, "ok");
      return result;
    } catch (error) {
      if (!trace) perfFail_(ownTrace, error);
      throw error;
    }
  }

  function reanudarSesion(idSesion, context, trace) {
    const ownTrace = trace || perfStart_("VE_SERVICE_RESUME_SESSION", {
      hasSessionId: Boolean(_str_(idSesion))
    });
    try {
      const session = REPOSITORY.getSesionPorId(idSesion, ownTrace);
      _assert_(session, "VE_SESION_NO_ENCONTRADA", "No se encontró la sesión.");
      _assert_(session.estadoSesion === DOMAIN.ESTADOS_SESION.PAUSADA, "VE_SESION_NO_PAUSADA", "La sesión no se encuentra pausada.");

      const details = REPOSITORY.getDetallePorSesion(idSesion, ownTrace);
      const boxes = REPOSITORY.getCajasPorSesion(idSesion, ownTrace);
      const summary = _summaryFromState_(details, boxes);
      const result = _changeSessionState_(_str_(idSesion), summary.estadoSesion, DOMAIN.TIPOS_EVENTO.SESION_REANUDADA, context, ownTrace);

      if (!trace) perfEnd_(ownTrace, "ok");
      return result;
    } catch (error) {
      if (!trace) perfFail_(ownTrace, error);
      throw error;
    }
  }

  function cerrarSesion(payload, context, trace) {
  const ownTrace = trace || perfStart_("VE_SERVICE_CLOSE_SESSION", {
    hasSessionId: Boolean(_str_(payload && payload.idSesion))
  });

  try {
    const idSesion = _str_(payload && payload.idSesion);
    const observation = _safeObservation_(
      payload && payload.observacionCierre
    );
    const user = _currentUser_(context);

    _assert_(
      idSesion,
      "VE_ID_SESION_REQUERIDO",
      "Se requiere la sesión."
    );

    const lockWaitStartedAt = Date.now();
    perfMark_(ownTrace, "VE_CLOSE_LOCK_WAIT_STARTED", {});

    const result = withScriptLock_(
      "VE_CLOSE_SESSION",
      function() {
        perfMark_(ownTrace, "VE_CLOSE_LOCK_ACQUIRED", {
          elapsedMs: Date.now() - lockWaitStartedAt
        });

        let startedAt = Date.now();
        const session = REPOSITORY.getSesionPorId(
          idSesion,
          ownTrace
        );

        perfMark_(ownTrace, "VE_CLOSE_SESSION_READ", {
          elapsedMs: Date.now() - startedAt,
          found: Boolean(session)
        });

        _assert_(
          session,
          "VE_SESION_NO_ENCONTRADA",
          "No se encontró la sesión."
        );
        _assert_(
          session.estadoSesion !== DOMAIN.ESTADOS_SESION.CERRADA &&
          session.estadoSesion !== DOMAIN.ESTADOS_SESION.CANCELADA,
          "VE_SESION_NO_CERRABLE",
          "La sesión ya fue cerrada o cancelada."
        );

        startedAt = Date.now();
        const details = REPOSITORY.getDetallePorSesion(
          idSesion,
          ownTrace
        );

        perfMark_(ownTrace, "VE_CLOSE_DETAILS_READ", {
          elapsedMs: Date.now() - startedAt,
          rows: details.length
        });

        startedAt = Date.now();
        const boxes = REPOSITORY.getCajasPorSesion(
          idSesion,
          ownTrace
        );

        perfMark_(ownTrace, "VE_CLOSE_BOXES_READ", {
          elapsedMs: Date.now() - startedAt,
          rows: boxes.length
        });

        startedAt = Date.now();
        const summary = _summaryFromState_(details, boxes);

        perfMark_(ownTrace, "VE_CLOSE_SUMMARY_CALCULATED", {
          elapsedMs: Date.now() - startedAt,
          detailRows: summary.detalle.length,
          activeBoxes: summary.totalCajas
        });

        const hasDifferences =
          summary.cantidadFaltante > 0 ||
          summary.cantidadSobrante > 0 ||
          summary.requiereRevision;

        _assert_(
          !hasDifferences || Boolean(observation),
          "VE_OBSERVACION_CIERRE_REQUERIDA",
          "Se requiere una observación para cerrar con diferencias o revisiones pendientes."
        );

        const resultFinal = summary.requiereRevision
          ? "CERRADA_CON_REVISION"
          : summary.cantidadSobrante > 0 &&
            summary.cantidadFaltante > 0
            ? "CERRADA_CON_FALTANTE_Y_SOBRANTE"
            : summary.cantidadSobrante > 0
              ? "CERRADA_CON_SOBRANTE"
              : summary.cantidadFaltante > 0
                ? "CERRADA_CON_FALTANTE"
                : "CERRADA_COMPLETA";

        const temporal = getTemporalContext_();
        const createdAt = session.creadoEn instanceof Date
          ? session.creadoEn.getTime()
          : temporal.ahora.getTime();
        const elapsedSeconds = Math.max(
          0,
          Math.floor(
            (temporal.ahora.getTime() - createdAt) / 1000
          )
        );
        const activeSeconds = Math.max(
          0,
          elapsedSeconds - Math.max(
            0,
            _num_(session.segundosPausados)
          )
        );

        startedAt = Date.now();

        REPOSITORY.actualizarDetallesPorLote(
          summary.detalle.map(function(item) {
            return {
              idDetalle: item.idDetalle,
              rowNumber: item.rowNumber,
              patch: {
                cantidadCapturada: item.cantidadCapturada,
                cantidadFaltante: item.cantidadFaltante,
                cantidadSobrante: item.cantidadSobrante,
                totalCajas: item.totalCajas,
                estadoSku: item.estadoSku,
                actualizadoEn: temporal.ahora
              }
            };
          }),
          ownTrace
        );

        perfMark_(ownTrace, "VE_CLOSE_DETAILS_UPDATED", {
          elapsedMs: Date.now() - startedAt,
          rows: summary.detalle.length
        });

        const sessionPatch = {
          estadoSesion: DOMAIN.ESTADOS_SESION.CERRADA,
          cantidadCapturada: summary.cantidadCapturada,
          cantidadFaltante: summary.cantidadFaltante,
          cantidadSobrante: summary.cantidadSobrante,
          totalCajas: summary.totalCajas,
          fechaCierre: temporal.fecha,
          horaCierre: temporal.hora,
          cerradaPor: user.usuario,
          segundosActivos: activeSeconds,
          observacionCierre: observation,
          resultadoFinal: resultFinal,
          actualizadoEn: temporal.ahora
        };

        startedAt = Date.now();

        if (
          Number.isInteger(Number(session.rowNumber)) &&
          Number(session.rowNumber) >= 2 &&
          typeof REPOSITORY.actualizarSesionPorFila === "function"
        ) {
          REPOSITORY.actualizarSesionPorFila(
            Number(session.rowNumber),
            sessionPatch,
            ownTrace
          );
        } else {
          REPOSITORY.actualizarSesion(
            idSesion,
            sessionPatch,
            ownTrace
          );
        }

        perfMark_(ownTrace, "VE_CLOSE_SESSION_UPDATED", {
          elapsedMs: Date.now() - startedAt,
          usedKnownRow: Boolean(
            Number.isInteger(Number(session.rowNumber)) &&
            Number(session.rowNumber) >= 2 &&
            typeof REPOSITORY.actualizarSesionPorFila === "function"
          )
        });

        startedAt = Date.now();

        REPOSITORY.insertarEventos([
          _newEvent_(
            DOMAIN.TIPOS_EVENTO.SESION_CERRADA,
            {
              idSesion: idSesion,
              estadoAnterior: session.estadoSesion,
              estadoNuevo: DOMAIN.ESTADOS_SESION.CERRADA,
              resultado: resultFinal,
              codigoMotivo: "SESION_CERRADA",
              mensaje: "Sesión cerrada.",
              metadata: {
                cantidadEsperada: summary.cantidadEsperada,
                cantidadCapturada: summary.cantidadCapturada,
                cantidadFaltante: summary.cantidadFaltante,
                cantidadSobrante: summary.cantidadSobrante,
                totalCajas: summary.totalCajas,
                requiereRevision: summary.requiereRevision
              }
            },
            user
          )
        ], ownTrace);

        perfMark_(ownTrace, "VE_CLOSE_EVENT_WRITTEN", {
          elapsedMs: Date.now() - startedAt
        });

        return {
          idSesion: idSesion,
          estadoSesion: DOMAIN.ESTADOS_SESION.CERRADA,
          resultadoFinal: resultFinal,
          resumen: {
            cantidadEsperada: summary.cantidadEsperada,
            cantidadCapturada: summary.cantidadCapturada,
            cantidadFaltante: summary.cantidadFaltante,
            cantidadSobrante: summary.cantidadSobrante,
            totalCajas: summary.totalCajas,
            requiereRevision: summary.requiereRevision
          },
          detalle: summary.detalle
        };
      },
      30000,
      ownTrace
    );

    perfMark_(ownTrace, "VE_CLOSE_SESSION_RESPONSE_READY", {
      result: result.resultadoFinal,
      detailRows: result.detalle.length
    });

    if (!trace) {
      perfEnd_(ownTrace, "ok", {
        result: result.resultadoFinal
      });
    }

    return result;
  } catch (error) {
    if (!trace) perfFail_(ownTrace, error);
    throw error;
  }
}

  function clearCache() {
    perfilesCache_ = null;
    console.log("[CACHE] VerificacionEntradaService limpio");
    return true;
  }

  return Object.freeze({
    getBootstrap: getBootstrap,
    crearSesion: crearSesion,
    obtenerSesion: obtenerSesion,
    registrarCajas: registrarCajas,
    cancelarCaja: cancelarCaja,
    obtenerSesionLigera: obtenerSesionLigera,
    pausarSesion: pausarSesion,
    reanudarSesion: reanudarSesion,
    cerrarSesion: cerrarSesion,
    clearCache: clearCache
  });
})();

/** Prueba pública de lectura. */
function testVerificacionEntradaServiceLectura() {
  return VerificacionEntradaService.getBootstrap("", {
    usuario: "PRUEBA",
    rol: "ADMINISTRADOR"
  });
}

/** Prueba pública del perfil y equivalencias de MAXITOR. */
function testVerificacionEntradaServiceMaxitor() {
  const result = VerificacionEntradaService.getBootstrap(
    "MAX110907KV1",
    { usuario: "PRUEBA", rol: "ADMINISTRADOR" }
  );

  const targetCodes = ["5400600000", "5400800000", "5400900000"];

  return {
    ok: true,
    proveedor: result.proveedor,
    totalEquivalencias: result.equivalencias.length,
    codigosObjetivo: targetCodes,
    encontrados: result.equivalencias.filter(function(item) {
      return targetCodes.includes(item.codigoProveedorXml);
    }).map(function(item) {
      return {
        codigoProveedorXml: item.codigoProveedorXml,
        codigoEtiqueta: item.codigoEtiqueta,
        codigoInterno: item.codigoInterno,
        idProducto: item.idProducto,
        activo: item.activo,
        nivelConfianza: item.nivelConfianza
      };
    })
  };
}

/** Limpia cachés del Repository y del Service. */
function limpiarCachesVerificacionEntrada() {
  const result = {
    repository: false,
    service: false,
    errors: []
  };

  try {
    if (typeof VerificacionEntradaRepository.clearCache !== "function") {
      throw new Error("VerificacionEntradaRepository.clearCache no está disponible.");
    }
    result.repository = VerificacionEntradaRepository.clearCache() === true;
  } catch (error) {
    result.errors.push({
      component: "VerificacionEntradaRepository",
      message: error && error.message ? error.message : String(error)
    });
  }

  try {
    result.service = VerificacionEntradaService.clearCache() === true;
  } catch (error) {
    result.errors.push({
      component: "VerificacionEntradaService",
      message: error && error.message ? error.message : String(error)
    });
  }

  result.ok = result.repository && result.service && result.errors.length === 0;

  console.log("[CACHE][VERIFICACION_ENTRADA] " + JSON.stringify(result));

  if (!result.ok) {
    throw new Error(
      "No fue posible limpiar todas las cachés. " +
      JSON.stringify(result.errors)
    );
  }

  return result;
}
