/**
 * GestorExcedentesService.gs
 */

const GestorExcedentesService = (() => {

  // =========================================================
  // HELPERS SEGUROS
  // =========================================================
  function _toSafeStr_(value) {
    return toStr_(value || "");
  }

  function _toSafeUpper_(value) {
    return toStrUpper_(value || "");
  }

  function _toSafeNum_(value) {
    return toNum_(value || 0);
  }

  function _ordenarVista_(rows) {
    return [...(rows || [])].sort((a, b) => {
      const ubicA = _toSafeUpper_(a.eserie || a.ubicacionActual) || "ZZZZZZ";
      const ubicB = _toSafeUpper_(b.eserie || b.ubicacionActual) || "ZZZZZZ";

      const cmpUbicacion = ubicA.localeCompare(
        ubicB,
        "es",
        { sensitivity: "base", numeric: true }
      );

      if (cmpUbicacion !== 0) return cmpUbicacion;

      const codA = _toSafeUpper_(a.ecodigo || a.codigo);
      const codB = _toSafeUpper_(b.ecodigo || b.codigo);

      return codA.localeCompare(
        codB,
        "es",
        { sensitivity: "base", numeric: true }
      );
    });
  }

  /**
   * Adapter seguro:
   * Convierte el shape de EstadoActualExcedentesService
   * al shape legacy esperado por GestorExcedentes.html
   */
  function _mapEstadoToLegacyView_(item) {
    return {
      // -----------------------------------------------------
      // SHAPE LEGACY ACTUAL
      // -----------------------------------------------------
      eidUnico: _toSafeStr_(item.idUnico),
      ecodigo: _toSafeUpper_(item.codigo),
      edescripcion: _toSafeUpper_(item.descripcion),
      esaldo: _toSafeNum_(item.saldoActual),
      eserie: _toSafeUpper_(item.ubicacionActual),
      ebodegaActual: _toSafeUpper_(item.bodegaActual),

      // -----------------------------------------------------
      // ENRIQUECIMIENTO
      // -----------------------------------------------------
      idproducto: _toSafeStr_(item.idproducto),
      estatusRegistro: _toSafeUpper_(item.estatusRegistro),
      estatusLogico: _toSafeUpper_(item.estatusLogico),

      vigente: !!item.vigente,
      pendienteUbicacion: !!item.pendienteUbicacion,
      conUbicacion: !!item.conUbicacion,
      auditable: !!item.auditable,

      saldoBase: _toSafeNum_(item.saldoBase),
      saldoActual: _toSafeNum_(item.saldoActual),
      ubicacionActual: _toSafeUpper_(item.ubicacionActual),
      bodegaActual: _toSafeUpper_(item.bodegaActual),

      ultimoMovimientoTipo: _toSafeUpper_(item.ultimoMovimientoTipo),
      ultimaSerieMovimiento: _toSafeUpper_(item.ultimaSerieMovimiento),
      ultimaUbicacionEntrada: _toSafeUpper_(item.ultimaUbicacionEntrada),
      ultimaUbicacionSalida: _toSafeUpper_(item.ultimaUbicacionSalida),
      ultimaBodegaEntrada: _toSafeUpper_(item.ultimaBodegaEntrada),
      ultimaBodegaSalida: _toSafeUpper_(item.ultimaBodegaSalida),
      ultimaFechaMovimiento: _toSafeStr_(item.ultimaFechaMovimiento),
      ultimaHoraMovimiento: _toSafeStr_(item.ultimaHoraMovimiento),

      fechaBase: _toSafeStr_(item.fechaBase),
      horaBase: _toSafeStr_(item.horaBase)
    };
  }

  function _mapResumen_(resumenBase) {
    const r = resumenBase || {};

    const idsUnicosVigentes = _toSafeNum_(r.vigentes);
    const idsUnicosConUbicacion = _toSafeNum_(r.conUbicacion);
    const idsUnicosPendientes = _toSafeNum_(r.pendientesUbicacion);

    const avanceUbicacionPct = idsUnicosVigentes > 0
      ? Math.round(((idsUnicosConUbicacion / idsUnicosVigentes) * 100 + Number.EPSILON) * 100) / 100
      : 0;

    return {
      totalIdsRegistrados: _toSafeNum_(r.totalIdUnicos),
      idsUnicosVigentes: idsUnicosVigentes,
      idsUnicosPendientes: idsUnicosPendientes,
      idsUnicosConUbicacion: idsUnicosConUbicacion,
      avanceUbicacionPct: avanceUbicacionPct,
      stockTotalVigente: _toSafeNum_(r.stockTotalVigente),

      // compatibilidad semántica
      foliosVigentes: _toSafeNum_(r.vigentes),
      foliosPendientes: _toSafeNum_(r.pendientesUbicacion),
      foliosConUbicacion: _toSafeNum_(r.conUbicacion),

      // extra
      auditables: _toSafeNum_(r.auditables),
      cerrados: _toSafeNum_(r.cerrados),
      stockTotalAuditable: _toSafeNum_(r.stockTotalAuditable),
      bodegasAuditables: Array.isArray(r.bodegasAuditables) ? [...r.bodegasAuditables] : [],
      porBodega: Array.isArray(r.porBodega) ? [...r.porBodega] : []
    };
  }

  function _construirVista_() {
    console.log("[GestorExcedentesService] _construirVista_ :: INICIO");

    const estadoCompleto = EstadoActualExcedentesService.getAll();
    const vigentes = EstadoActualExcedentesService.getVigentes();
    const resumenBase = EstadoActualExcedentesService.getResumen();

    console.log("[GestorExcedentesService] _construirVista_ :: estadoCompleto", estadoCompleto.length);
    console.log("[GestorExcedentesService] _construirVista_ :: vigentes", vigentes.length);
    console.log("[GestorExcedentesService] _construirVista_ :: resumenBase", resumenBase);

    const dataCompleta = _ordenarVista_(
      (estadoCompleto || []).map(_mapEstadoToLegacyView_)
    );

    const data = _ordenarVista_(
      (vigentes || []).map(_mapEstadoToLegacyView_)
    );

    const resumen = _mapResumen_(resumenBase);

    console.log("[GestorExcedentesService] _construirVista_ :: data", data.length);
    console.log("[GestorExcedentesService] _construirVista_ :: dataCompleta", dataCompleta.length);
    console.log("[GestorExcedentesService] _construirVista_ :: resumen", resumen);
    console.log("[GestorExcedentesService] _construirVista_ :: FIN");

    return {
      data,
      dataCompleta,
      resumen
    };
  }

  /**
   * RAW:
   * sin esconder excepción
   */
  function obtenerVistaRaw() {
    return _construirVista_();
  }

  /**
   * Seguro:
   * mantiene fallback pero ya loguea el error real
   */
function obtenerVista() {
  try {
    const result = _construirVista_();

    console.log("[GestorExcedentesService] obtenerVista :: OK", {
      data: result.data.length,
      dataCompleta: result.dataCompleta.length,
      resumen: result.resumen
    });

    return result;

  } catch (error) {

      console.error("❌ Error GestorExcedentesService.obtenerVista :: message", error && error.message);
      console.error("❌ Error GestorExcedentesService.obtenerVista :: stack", error && error.stack);
      console.error("❌ Error GestorExcedentesService.obtenerVista :: raw", error);

      return {
        data: [],
        dataCompleta: [],
        resumen: {
          totalIdsRegistrados: 0,
          idsUnicosVigentes: 0,
          idsUnicosPendientes: 0,
          idsUnicosConUbicacion: 0,
          stockTotalVigente: 0,
          foliosVigentes: 0,
          foliosPendientes: 0,
          foliosConUbicacion: 0,
          avanceUbicacionPct: 0,
          auditables: 0,
          cerrados: 0,
          stockTotalAuditable: 0,
          bodegasAuditables: [],
          porBodega: []
        }
      };
    }
  }

  function obtenerExcedentesConsolidados() {
    return obtenerVistaRaw().data;
  }

  function getResumen() {
    return obtenerVistaRaw().resumen;
  }

  function clearCache() {
    if (
      typeof EstadoActualExcedentesService !== "undefined" &&
      EstadoActualExcedentesService &&
      typeof EstadoActualExcedentesService.clearCache === "function"
    ) {
      EstadoActualExcedentesService.clearCache();
    }

    console.log("[CACHE] GestorExcedentesService -> EstadoActualExcedentesService limpio");
    return true;
  }

  return {
    obtenerVista,
    obtenerVistaRaw,
    obtenerExcedentesConsolidados,
    getResumen,
    clearCache
  };

})();


/**
 * Debuggers para GestorExcedentesService
 * ------------------------------------------------------------
 * Requiere:
 * - debugServiceCall_()
 */

/**
 * Prueba directa SIN wrapper externo.
 * Ideal para ver si realmente construye data, dataCompleta y resumen.
 */
function pruebaDirecta_GestorExcedentes_obtenerVista() {
  console.log("==================================================");
  console.log("[PRUEBA DIRECTA] GestorExcedentesService.obtenerVista");
  console.log("==================================================");

  try {
    const result = GestorExcedentesService.obtenerVista();

    console.log("[PRUEBA DIRECTA] tipo:", typeof result);
    console.log("[PRUEBA DIRECTA] keys:", Object.keys(result || {}));
    console.log("[PRUEBA DIRECTA] total data:", Array.isArray(result?.data) ? result.data.length : "NO ARRAY");
    console.log("[PRUEBA DIRECTA] total dataCompleta:", Array.isArray(result?.dataCompleta) ? result.dataCompleta.length : "NO ARRAY");
    console.log("[PRUEBA DIRECTA] resumen:", JSON.stringify(result?.resumen || {}, null, 2));

    if (result?.data && result.data.length > 0) {
      console.log("[PRUEBA DIRECTA] primer registro data:", JSON.stringify(result.data[0], null, 2));
    }

    if (result?.dataCompleta && result.dataCompleta.length > 0) {
      console.log("[PRUEBA DIRECTA] primer registro dataCompleta:", JSON.stringify(result.dataCompleta[0], null, 2));
    }

    console.log("==================================================");
    console.log("[PRUEBA DIRECTA] FIN OK");
    console.log("==================================================");

    return result;

  } catch (error) {
    console.error("[PRUEBA DIRECTA] ERROR message:", error && error.message);
    console.error("[PRUEBA DIRECTA] ERROR stack:", error && error.stack);
    console.error("[PRUEBA DIRECTA] ERROR raw:", error);
    throw error;
  }
}

/**
 * Prueba RAW
 * No usa fallback del método seguro.
 */
function debugGestorExcedentesService_obtenerVistaRaw() {
  return debugServiceCall_(
    "GestorExcedentesService.obtenerVistaRaw",
    {},
    () => GestorExcedentesService.obtenerVistaRaw(),
    { limit: 10 }
  );
}

/**
 * Prueba segura
 * Usa obtenerVista() con try/catch interno.
 */
function debugGestorExcedentesService_obtenerVista() {
  return debugServiceCall_(
    "GestorExcedentesService.obtenerVista",
    {},
    () => GestorExcedentesService.obtenerVista(),
    { limit: 10 }
  );
}

/**
 * Solo data vigente
 */
function debugGestorExcedentesService_obtenerExcedentesConsolidados() {
  return debugServiceCall_(
    "GestorExcedentesService.obtenerExcedentesConsolidados",
    {},
    () => GestorExcedentesService.obtenerExcedentesConsolidados(),
    { limit: 10 }
  );
}

/**
 * Solo resumen
 */
function debugGestorExcedentesService_getResumen() {
  return debugServiceCall_(
    "GestorExcedentesService.getResumen",
    {},
    () => GestorExcedentesService.getResumen(),
    { limit: 10 }
  );
}

/**
 * Limpieza de cache
 */
function debugGestorExcedentesService_clearCache() {
  return debugServiceCall_(
    "GestorExcedentesService.clearCache",
    {},
    () => {
      const ok = GestorExcedentesService.clearCache();
      return {
        ok: !!ok,
        mensaje: ok ? "Cache limpiado correctamente" : "No se pudo limpiar cache"
      };
    },
    { limit: 10 }
  );
}

/**
 * Valida que el service base sí traiga data
 */
function debugGestorExcedentesService_verificarBase() {
  return debugServiceCall_(
    "GestorExcedentesService.verificarBase",
    {},
    () => {
      const all = EstadoActualExcedentesService.getAll();
      const vigentes = EstadoActualExcedentesService.getVigentes();
      const resumen = EstadoActualExcedentesService.getResumen();

      return {
        totalAll: Array.isArray(all) ? all.length : -1,
        totalVigentes: Array.isArray(vigentes) ? vigentes.length : -1,
        resumen
      };
    },
    { limit: 10 }
  );
}

/**
 * Debug maestro
 */
function debugGestorExcedentesService() {
  console.log("==================================================");
  console.log("[DEBUG MASTER] GestorExcedentesService");
  console.log("==================================================");

  debugGestorExcedentesService_clearCache();
  debugGestorExcedentesService_verificarBase();
  debugGestorExcedentesService_obtenerVistaRaw();
  debugGestorExcedentesService_obtenerVista();
  debugGestorExcedentesService_obtenerExcedentesConsolidados();
  debugGestorExcedentesService_getResumen();

  console.log("==================================================");
  console.log("[DEBUG MASTER] FIN GestorExcedentesService");
  console.log("==================================================");
}