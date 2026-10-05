/**
 * GestorExcedentesService.gs
 * Adaptador de EstadoActualExcedentesService para las vistas legacy.
 *
 * Reglas:
 * - No recalcula el saldo.
 * - EstadoActualExcedentesService es la fuente unica del saldo consolidado.
 * - saldoActual debe representar:
 *   cantidad inicial de BD-EXCEDENTES menos la suma de SURTIDO.
 * - Los excedentes PARCIAL permanecen vigentes mientras saldoActual sea mayor a cero.
 */
const GestorExcedentesService = (() => {
  "use strict";

function _perfGestorStart_(operation, metadata) {
    const now = Date.now();

    return {
      operation: String(operation || "GESTOR_OPERATION"),
      startedAt: now,
      lastAt: now,
      metadata: metadata || {},
      marks: []
    };
  }

  function _perfGestorMark_(trace, stage, metadata) {
    if (!trace) return;

    const now = Date.now();

    trace.marks.push({
      stage: String(stage || "MARK"),
      segmentMs: now - trace.lastAt,
      totalMs: now - trace.startedAt,
      metadata: metadata || {}
    });

    trace.lastAt = now;
  }

  function _perfGestorEnd_(trace, status, metadata) {
    if (!trace) return null;

    const result = {
      operation: trace.operation,
      status: String(status || "ok"),
      totalMs: Date.now() - trace.startedAt,
      metadata: Object.assign({}, trace.metadata, metadata || {}),
      marks: trace.marks.slice()
    };

    console.log(
      "[APPALMACEN][GESTOR_BACKEND_PERF] " +
      JSON.stringify(result)
    );

    return result;
  }

  // =========================================================
  // HELPERS DE VISTA
  // =========================================================

  function _ordenarVista_(rows) {
    return [...(rows || [])].sort((a, b) => {
      const ubicacionA =
        toStrUpper_(a.eserie || a.ubicacionActual) ||
        "ZZZZZZ";

      const ubicacionB =
        toStrUpper_(b.eserie || b.ubicacionActual) ||
        "ZZZZZZ";

      const comparacionUbicacion = ubicacionA.localeCompare(
        ubicacionB,
        "es",
        {
          sensitivity: "base",
          numeric: true
        }
      );

      if (comparacionUbicacion !== 0) {
        return comparacionUbicacion;
      }

      const codigoA = toStrUpper_(
        a.ecodigo || a.codigo
      );

      const codigoB = toStrUpper_(
        b.ecodigo || b.codigo
      );

      const comparacionCodigo = codigoA.localeCompare(
        codigoB,
        "es",
        {
          sensitivity: "base",
          numeric: true
        }
      );

      if (comparacionCodigo !== 0) {
        return comparacionCodigo;
      }

      return toStr_(a.eidUnico || a.idUnico).localeCompare(
        toStr_(b.eidUnico || b.idUnico),
        "es",
        {
          sensitivity: "base",
          numeric: true
        }
      );
    });
  }

  /**
   * Convierte el modelo de EstadoActualExcedentesService
   * al modelo legacy utilizado por GestorExcedentes.html
   * y PrototipoTraspasosService.
   */
  function _mapEstadoToLegacyView_(item) {
    const cantidadInicial = toNum_(
      item.cantidadInicial != null
        ? item.cantidadInicial
        : item.saldoBase
    );

    const saldoActual = toNum_(item.saldoActual);
    const totalSurtido = toNum_(item.totalSurtido);

    return {
      // -----------------------------------------------------
      // SHAPE LEGACY
      // -----------------------------------------------------
      eidUnico: toStr_(item.idUnico),
      ecodigo: toStrUpper_(item.codigo),
      edescripcion: toStrUpper_(item.descripcion),
      esaldo: saldoActual,
      eserie: toStrUpper_(item.ubicacionActual),
      ebodegaActual: toStrUpper_(item.bodegaActual),

      // -----------------------------------------------------
      // IDENTIFICACION Y ESTADO
      // -----------------------------------------------------
      idUnico: toStr_(item.idUnico),
      idproducto: toStr_(item.idproducto),
      estatusRegistro: toStrUpper_(item.estatusRegistro),
      estatusLogico: toStrUpper_(item.estatusLogico),

      vigente: item.vigente === true,
      pendienteUbicacion: item.pendienteUbicacion === true,
      conUbicacion: item.conUbicacion === true,
      auditable: item.auditable === true,

      // -----------------------------------------------------
      // TRAZABILIDAD CUANTITATIVA
      // -----------------------------------------------------
      cantidadInicial: cantidadInicial,
      saldoBase: cantidadInicial,
      saldoActual: saldoActual,
      totalSurtido: totalSurtido,
      cantidadSurtidos: toNum_(item.cantidadSurtidos),
      cantidadAcomodos: toNum_(item.cantidadAcomodos),

      // -----------------------------------------------------
      // UBICACION ACTUAL
      // -----------------------------------------------------
      ubicacionActual: toStrUpper_(item.ubicacionActual),
      bodegaActual: toStrUpper_(item.bodegaActual),

      // -----------------------------------------------------
      // ULTIMO MOVIMIENTO
      // -----------------------------------------------------
      ultimoMovimientoTipo: toStrUpper_(
        item.ultimoMovimientoTipo
      ),
      ultimaSerieMovimiento: toStrUpper_(
        item.ultimaSerieMovimiento
      ),
      ultimaUbicacionEntrada: toStrUpper_(
        item.ultimaUbicacionEntrada
      ),
      ultimaUbicacionSalida: toStrUpper_(
        item.ultimaUbicacionSalida
      ),
      ultimaBodegaEntrada: toStrUpper_(
        item.ultimaBodegaEntrada
      ),
      ultimaBodegaSalida: toStrUpper_(
        item.ultimaBodegaSalida
      ),
      ultimaFechaMovimiento: toStr_(
        item.ultimaFechaMovimiento
      ),
      ultimaHoraMovimiento: toStr_(
        item.ultimaHoraMovimiento
      ),

      // -----------------------------------------------------
      // ORIGEN BD-EXCEDENTES
      // -----------------------------------------------------
      fechaBase: toStr_(item.fechaBase),
      horaBase: toStr_(item.horaBase)
    };
  }

  function _mapResumen_(resumenBase) {
    const resumen = resumenBase || {};

    const idsUnicosVigentes = toNum_(resumen.vigentes);
    const idsUnicosConUbicacion = toNum_(
      resumen.conUbicacion
    );
    const idsUnicosPendientes = toNum_(
      resumen.pendientesUbicacion
    );

    const avanceUbicacionPct = idsUnicosVigentes > 0
      ? Math.round(
          (
            (
              idsUnicosConUbicacion /
              idsUnicosVigentes
            ) *
            100 +
            Number.EPSILON
          ) *
          100
        ) /
        100
      : 0;

    return {
      totalIdsRegistrados: toNum_(
        resumen.totalIdUnicos
      ),
      idsUnicosVigentes: idsUnicosVigentes,
      idsUnicosPendientes: idsUnicosPendientes,
      idsUnicosConUbicacion: idsUnicosConUbicacion,
      avanceUbicacionPct: avanceUbicacionPct,
      stockTotalVigente: toNum_(
        resumen.stockTotalVigente
      ),

      // Compatibilidad semantica.
      foliosVigentes: idsUnicosVigentes,
      foliosPendientes: idsUnicosPendientes,
      foliosConUbicacion: idsUnicosConUbicacion,

      // Resumen extendido.
      auditables: toNum_(resumen.auditables),
      cerrados: toNum_(resumen.cerrados),
      stockTotalAuditable: toNum_(
        resumen.stockTotalAuditable
      ),
      bodegasAuditables: Array.isArray(
        resumen.bodegasAuditables
      )
        ? [...resumen.bodegasAuditables]
        : [],
      porBodega: Array.isArray(resumen.porBodega)
        ? [...resumen.porBodega]
        : []
    };
  }

  // =========================================================
  // CONSTRUCCION DE VISTA
  // =========================================================

  function _construirVista_() {
    const trace = _perfGestorStart_(
      "GESTOR_CONSTRUIR_VISTA"
    );

    try {
      const getAllStartedAt = Date.now();
      const estadoCompleto =
        EstadoActualExcedentesService.getAll();

      _perfGestorMark_(trace, "ESTADO_GET_ALL", {
        elapsedMs: Date.now() - getAllStartedAt,
        rows: Array.isArray(estadoCompleto)
          ? estadoCompleto.length
          : 0
      });

      const getVigentesStartedAt = Date.now();
      const vigentes =
        EstadoActualExcedentesService.getVigentes();

      _perfGestorMark_(trace, "ESTADO_GET_VIGENTES", {
        elapsedMs: Date.now() - getVigentesStartedAt,
        rows: Array.isArray(vigentes)
          ? vigentes.length
          : 0
      });

      const getResumenStartedAt = Date.now();
      const resumenBase =
        EstadoActualExcedentesService.getResumen();

      _perfGestorMark_(trace, "ESTADO_GET_RESUMEN", {
        elapsedMs: Date.now() - getResumenStartedAt
      });

      const dataCompletaStartedAt = Date.now();
      const dataCompleta = _ordenarVista_(
        (estadoCompleto || []).map(
          _mapEstadoToLegacyView_
        )
      );

      _perfGestorMark_(trace, "MAP_SORT_DATA_COMPLETA", {
        elapsedMs: Date.now() - dataCompletaStartedAt,
        rows: dataCompleta.length
      });

      const dataStartedAt = Date.now();
      const data = _ordenarVista_(
        (vigentes || []).map(
          _mapEstadoToLegacyView_
        )
      );

      _perfGestorMark_(trace, "MAP_SORT_DATA", {
        elapsedMs: Date.now() - dataStartedAt,
        rows: data.length
      });

      const resumenStartedAt = Date.now();
      const resumen = _mapResumen_(resumenBase);

      _perfGestorMark_(trace, "MAP_RESUMEN", {
        elapsedMs: Date.now() - resumenStartedAt
      });

      _perfGestorEnd_(trace, "ok", {
        estadoCompleto: estadoCompleto.length,
        vigentes: vigentes.length,
        data: data.length,
        dataCompleta: dataCompleta.length,
        stockTotalVigente: resumen.stockTotalVigente
      });

      return {
        data,
        dataCompleta,
        resumen
      };
    } catch (error) {
      _perfGestorMark_(trace, "FAILED", {
        message: error && error.message
          ? error.message
          : String(error || "")
      });

      _perfGestorEnd_(trace, "error");
      throw error;
    }
  }

  function _construirVistaLigera_() {
    const trace =
      _perfGestorStart_(
        "GESTOR_CONSTRUIR_VISTA_LIGERA"
      );

    try {
      const vigentesStartedAt =
        Date.now();

      const vigentes =
        EstadoActualExcedentesService
          .getVigentes();

      _perfGestorMark_(
        trace,
        "ESTADO_GET_VIGENTES",
        {
          elapsedMs:
            Date.now() -
            vigentesStartedAt,

          rows:
            Array.isArray(
              vigentes
            )
              ? vigentes.length
              : 0
        }
      );

      const resumenStartedAt =
        Date.now();

      const resumenBase =
        EstadoActualExcedentesService
          .getResumen();

      _perfGestorMark_(
        trace,
        "ESTADO_GET_RESUMEN",
        {
          elapsedMs:
            Date.now() -
            resumenStartedAt
        }
      );

      const mapStartedAt =
        Date.now();

      const data =
        (vigentes || []).map(
          _mapEstadoToLegacyView_
        );

      _perfGestorMark_(
        trace,
        "MAP_DATA",
        {
          elapsedMs:
            Date.now() -
            mapStartedAt,

          rows:
            data.length
        }
      );

      /*
       * EstadoActualExcedentesService ya entrega los registros
       * ordenados. getVigentes() conserva ese orden al filtrar.
       *
       * Por tanto, no es necesario ejecutar _ordenarVista_()
       * nuevamente en este endpoint.
       */

      const resumenMapStartedAt =
        Date.now();

      const resumen =
        _mapResumen_(
          resumenBase
        );

      _perfGestorMark_(
        trace,
        "MAP_RESUMEN",
        {
          elapsedMs:
            Date.now() -
            resumenMapStartedAt
        }
      );

      const result = {
        data:
          data,

        resumen:
          resumen
      };

      const serializeStartedAt =
        Date.now();

      let responseChars =
        -1;

      try {
        responseChars =
          JSON.stringify(
            result
          ).length;
      } catch (
        error
      ) {
        responseChars =
          -1;
      }

      _perfGestorMark_(
        trace,
        "RESPONSE_READY",
        {
          elapsedMs:
            Date.now() -
            serializeStartedAt,

          rows:
            data.length,

          responseChars:
            responseChars
        }
      );

      _perfGestorEnd_(
        trace,
        "ok",
        {
          data:
            data.length,

          responseChars:
            responseChars,

          stockTotalVigente:
            resumen
              .stockTotalVigente
        }
      );

      return result;
    } catch (
      error
    ) {
      _perfGestorMark_(
        trace,
        "FAILED",
        {
          message:
            error &&
            error.message
              ? error.message
              : String(
                  error || ""
                )
        }
      );

      _perfGestorEnd_(
        trace,
        "error"
      );

      throw error;
    }
  }

  // =========================================================
  // API PUBLICA
  // =========================================================

  /**
   * Version estricta. Propaga cualquier error al llamador.
   * Debe utilizarse en procesos operativos como Traspasos.
   */
  function obtenerVistaRaw() {
    return _construirVista_();
  }

  /**
   * Version tolerante para vistas informativas.
   */
  function obtenerVista() {
    try {
      const result =
        _construirVistaLigera_();

      console.log(
        "[GestorExcedentesService] " +
        "obtenerVista :: OK",
        JSON.stringify({
          data:
            result.data.length,

          resumen:
            result.resumen
        })
      );

      return result;
    } catch (
      error
    ) {
      console.error(
        "[GestorExcedentesService] " +
        "obtenerVista :: ERROR message",
        error &&
        error.message
      );

      console.error(
        "[GestorExcedentesService] " +
        "obtenerVista :: ERROR stack",
        error &&
        error.stack
      );

      return {
        data:
          [],

        resumen:
          {
            totalIdsRegistrados:
              0,

            idsUnicosVigentes:
              0,

            idsUnicosPendientes:
              0,

            idsUnicosConUbicacion:
              0,

            stockTotalVigente:
              0,

            foliosVigentes:
              0,

            foliosPendientes:
              0,

            foliosConUbicacion:
              0,

            avanceUbicacionPct:
              0,

            auditables:
              0,

            cerrados:
              0,

            stockTotalAuditable:
              0,

            bodegasAuditables:
              [],

            porBodega:
              []
          }
      };
    }
  }

  function obtenerVistaLigeraRaw() {
    return _construirVistaLigera_();
  }  

    function _construirSoloVigentes_() {
    const trace = _perfGestorStart_(
      "GESTOR_CONSTRUIR_SOLO_VIGENTES"
    );

    try {
      const getVigentesStartedAt = Date.now();
      const vigentes =
        EstadoActualExcedentesService.getVigentes();

      _perfGestorMark_(trace, "ESTADO_GET_VIGENTES", {
        elapsedMs: Date.now() - getVigentesStartedAt,
        rows: Array.isArray(vigentes)
          ? vigentes.length
          : 0
      });

      const mapStartedAt = Date.now();
      const data = _ordenarVista_(
        (vigentes || []).map(
          _mapEstadoToLegacyView_
        )
      );

      _perfGestorMark_(trace, "MAP_SORT_DATA", {
        elapsedMs: Date.now() - mapStartedAt,
        rows: data.length
      });

      _perfGestorEnd_(trace, "ok", {
        data: data.length
      });

      return data;
    } catch (error) {
      _perfGestorMark_(trace, "FAILED", {
        message: error && error.message
          ? error.message
          : String(error || "")
      });
      _perfGestorEnd_(trace, "error");
      throw error;
    }
  }

  /**
   * Fuente utilizada por PrototipoTraspasosService.
   * Solo devuelve excedentes vigentes.
   */
 function obtenerExcedentesConsolidados() {
    return _construirSoloVigentes_();
  }

  function getResumen() {
    return obtenerVistaRaw().resumen;
  }

  function obtenerExcedentesAuditables() {
    return obtenerVistaRaw().data.filter(
      item => item.auditable === true
    );
  }

  function clearCache() {
    if (
      typeof EstadoActualExcedentesService !== "undefined" &&
      EstadoActualExcedentesService &&
      typeof EstadoActualExcedentesService.clearCache === "function"
    ) {
      EstadoActualExcedentesService.clearCache();
    }

    console.log(
      "[CACHE] GestorExcedentesService: EstadoActualExcedentesService limpio"
    );

    return true;
  }

    return {
    obtenerVista,
    obtenerVistaLigeraRaw,
    obtenerVistaRaw,
    obtenerExcedentesConsolidados,
    obtenerExcedentesAuditables,
    getResumen,
    clearCache
  };
  
})();
