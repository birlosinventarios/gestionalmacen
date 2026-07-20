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

  function obtenerExcedentesAuditables() {
    return obtenerVistaRaw().data.filter(item => item.auditable === true);
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
