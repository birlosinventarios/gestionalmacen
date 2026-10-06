/**
 * GestorExcedentesService.gs
 *
 * Adaptador de compatibilidad entre EstadoActualExcedentesService y las vistas
 * legacy que consumen el contrato histórico de GestorExcedentesService.
 *
 * Responsabilidades:
 * - Delegar el cálculo del estado y del saldo consolidado al servicio canónico.
 * - Adaptar registros canónicos al shape legacy sin recalcular cantidades.
 * - Construir vistas completas, ligeras y estrictas según el consumidor.
 * - Conservar orden, nombres de propiedades y resúmenes esperados por vistas
 *   existentes y por PrototipoTraspasosService.
 * - Propagar o tolerar errores según el endpoint utilizado.
 * - Exponer métricas de rendimiento para lectura, mapeo y serialización.
 *
 * Reglas invariantes:
 * - Este adaptador no recalcula el saldo.
 * - EstadoActualExcedentesService es la única fuente del saldo consolidado.
 * - saldoActual representa CANTIDAD inicial menos la suma de SURTIDO.
 * - Los excedentes PARCIAL continúan vigentes mientras saldoActual sea mayor
 *   que cero.
 * - obtenerExcedentesConsolidados() devuelve únicamente excedentes vigentes.
 * - Los campos legacy eidUnico, ecodigo, edescripcion, esaldo, eserie y
 *   ebodegaActual deben conservarse.
 *
 * Política de errores:
 * - obtenerVistaRaw(), obtenerVistaLigeraRaw(), getResumen(),
 *   obtenerExcedentesConsolidados() y obtenerExcedentesAuditables() propagan
 *   errores operativos.
 * - obtenerVista() es tolerante y devuelve una estructura vacía compatible.
 *
 * Dependencias:
 * - EstadoActualExcedentesService.
 * - toStr_(), toStrUpper_() y toNum_().
 *
 * API pública:
 * - obtenerVista()
 * - obtenerVistaLigeraRaw()
 * - obtenerVistaRaw()
 * - obtenerExcedentesConsolidados()
 * - obtenerExcedentesAuditables()
 * - getResumen()
 * - clearCache()
 */
const GestorExcedentesService = (() => {
  "use strict";

  /** Inicia una traza de rendimiento para una operación del adaptador. */
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

  /** Registra una etapa con tiempos parcial y acumulado. */
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

  /** Finaliza, registra y devuelve la traza de rendimiento. */
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

  /**
   * Ordena por ubicación, código e IdUnico usando comparación natural.
   * @param {Array<Object>} rows Registros legacy.
   * @return {Array<Object>} Copia ordenada.
   */
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
   * Adapta un registro canónico al contrato legacy sin recalcular el saldo.
   * @param {Object} item Registro de EstadoActualExcedentesService.
   * @return {Object} Registro compatible con vistas legacy.
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

  /**
   * Adapta el resumen canónico y calcula únicamente métricas de presentación.
   * @param {Object} resumenBase Resumen del servicio canónico.
   * @return {Object} Resumen compatible con consumidores legacy.
   */
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

  /**
   * Construye la vista completa con universo, vigentes y resumen.
   * @return {{data:Array<Object>,dataCompleta:Array<Object>,resumen:Object}}
   */
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

  /**
   * Construye una respuesta ligera de vigentes y resumen sin reordenar.
   * @return {{data:Array<Object>,resumen:Object}}
   */
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
   * Devuelve la vista completa y propaga cualquier error operativo.
   * @return {Object}
   */
  function obtenerVistaRaw() {
    return _construirVista_();
  }

  /**
   * Devuelve una vista ligera tolerante para pantallas informativas.
   * @return {{data:Array<Object>,resumen:Object}}
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

  /** Devuelve la vista ligera y propaga errores al consumidor. */
  function obtenerVistaLigeraRaw() {
    return _construirVistaLigera_();
  }  

  /**
   * Adapta y ordena únicamente excedentes vigentes.
   * @return {Array<Object>} Registros legacy vigentes.
   */
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
   * Fuente operativa utilizada por PrototipoTraspasosService.
   * @return {Array<Object>} Excedentes vigentes con saldo consolidado.
   */
  function obtenerExcedentesConsolidados() {
    return _construirSoloVigentes_();
  }

  /** @return {Object} Resumen estricto de la vista completa. */
  function getResumen() {
    return obtenerVistaRaw().resumen;
  }

  /** @return {Array<Object>} Excedentes marcados como auditables. */
  function obtenerExcedentesAuditables() {
    return obtenerVistaRaw().data.filter(
      item => item.auditable === true
    );
  }

  /**
   * Invalida la caché del servicio canónico cuando está disponible.
   * @return {boolean}
   */
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

  return Object.freeze({
    obtenerVista,
    obtenerVistaLigeraRaw,
    obtenerVistaRaw,
    obtenerExcedentesConsolidados,
    obtenerExcedentesAuditables,
    getResumen,
    clearCache
  });
})();
