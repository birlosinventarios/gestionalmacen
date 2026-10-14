/**
 * z3-GestorExcedentesService
 *
 * @fileoverview Adaptador de compatibilidad entre el estado canónico de
 * excedentes y las vistas legacy que consumen el contrato histórico del gestor.
 *
 * El servicio delega todos los cálculos de saldo y vigencia a
 * EstadoActualExcedentesService. Su responsabilidad se limita a adaptar nombres,
 * ordenar resultados, construir resúmenes de presentación y ofrecer endpoints
 * estrictos o tolerantes según el consumidor.
 *
 * Responsabilidades:
 * - Delegar la consolidación de saldos al servicio canónico.
 * - Adaptar registros canónicos al contrato legacy sin recalcular cantidades.
 * - Preservar los campos eidUnico, ecodigo, edescripcion, esaldo, eserie y
 *   ebodegaActual.
 * - Construir vistas completas, ligeras y especializadas para consumidores
 *   existentes.
 * - Mantener el orden natural por ubicación, código e IdUnico.
 * - Adaptar el resumen canónico a métricas de presentación legacy.
 * - Medir lectura, mapeo, ordenamiento y serialización.
 * - Aplicar una política explícita de propagación o tolerancia de errores.
 *
 * Dependencias globales:
 * - EstadoActualExcedentesService.
 * - toStr_(value), toStrUpper_(value) y toNum_(value).
 *
 * Reglas invariantes:
 * - Este adaptador nunca recalcula saldoActual.
 * - EstadoActualExcedentesService es la única fuente del saldo consolidado.
 * - saldoActual representa cantidad inicial menos la suma de SURTIDO.
 * - Los excedentes PARCIAL siguen vigentes mientras el saldo sea mayor que cero.
 * - obtenerExcedentesConsolidados() devuelve únicamente excedentes vigentes.
 * - Los resultados legacy conservan nombres y semántica histórica.
 * - Las colecciones devueltas son nuevas estructuras y no referencias internas.
 *
 * Política de errores:
 * - obtenerVistaRaw(), obtenerVistaLigeraRaw(), getResumen(),
 *   obtenerExcedentesConsolidados() y obtenerExcedentesAuditables() propagan
 *   errores operativos.
 * - obtenerVista() es tolerante y devuelve una estructura vacía compatible.
 * - Los errores tolerados se registran sin exponer datos sensibles del proceso.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const GestorExcedentesService = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    LOCALE: "es-MX",
    SORT_FALLBACK: "ZZZZZZ",
    PERF_PREFIX: "[APPALMACEN][GESTOR_BACKEND_PERF]",
    LOG_PREFIX: "[GestorExcedentesService]"
  });

  // ==========================================================================
  // VALIDACIÓN Y UTILIDADES GENERALES
  // ==========================================================================

  /**
   * Verifica la disponibilidad del servicio canónico y utilidades globales.
   *
   * @return {void}
   * @throws {Error} Si falta una dependencia obligatoria.
   * @private
   */
  /**
   * Verifica las dependencias obligatorias del adaptador.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _assertDependencies_() {
    const functions = [
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_]
    ];
    const missingFunctions = functions
      .filter(function (dependency) {
        return dependency[1] !== "function";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingFunctions.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan utilidades globales: ` +
          `${missingFunctions.join(", ")}.`
      );
    }

    if (
      typeof EstadoActualExcedentesService === "undefined" ||
      !EstadoActualExcedentesService
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} EstadoActualExcedentesService no está disponible.`
      );
    }

    const requiredMethods = [
      "getAll",
      "getVigentes",
      "getResumen"
    ];
    const missingMethods = requiredMethods.filter(function (methodName) {
      return typeof EstadoActualExcedentesService[methodName] !== "function";
    });

    if (missingMethods.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} El servicio canónico no implementa: ` +
          `${missingMethods.join(", ")}.`
      );
    }
  }

  /**
   * Construye el resumen vacío compatible con las vistas legacy.
   *
   * @return {!Object} Resumen con métricas inicializadas en cero.
   * @private
   */
  /**
   * Construye el resumen vacío compatible con vistas legacy.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _buildEmptySummary_() {
    return {
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
    };
  }

  /**
   * Mide el tamaño JSON de una respuesta sin interrumpir la operación.
   *
   * @param {*} value Valor que se desea medir.
   * @return {number} Número de caracteres o -1 si no puede serializarse.
   * @private
   */
  /**
   * Mide el tamaño JSON de una respuesta de forma segura.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _measureJsonChars_(value) {
    try {
      return JSON.stringify(value).length;
    } catch (error) {
      console.warn(
        CFG.LOG_PREFIX + " No fue posible medir una respuesta JSON: " +
          (error && error.message ? error.message : String(error || ""))
      );
      return -1;
    }
  }

  // ==========================================================================
  // INSTRUMENTACIÓN DE RENDIMIENTO
  // ==========================================================================

  /**
   * Inicia una traza de rendimiento del adaptador.
   *
   * @param {*} operation Valor utilizado por la operación.
   * @param {*} metadata Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Inicia una traza de rendimiento del adaptador.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
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

  /**
   * Registra una etapa con tiempos parcial y acumulado.
   *
   * @param {*} trace Valor utilizado por la operación.
   * @param {*} stage Valor utilizado por la operación.
   * @param {*} metadata Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Registra una etapa con tiempos parcial y acumulado.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
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

  /**
   * Finaliza, registra y devuelve una traza de rendimiento.
   *
   * @param {*} trace Valor utilizado por la operación.
   * @param {*} status Valor utilizado por la operación.
   * @param {*} metadata Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Finaliza, registra y devuelve una traza de rendimiento.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
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
      CFG.PERF_PREFIX + " " + JSON.stringify(result)
    );

    return result;
  }

  // ==========================================================================
  // ADAPTACIÓN Y ORDENAMIENTO DE LA VISTA LEGACY
  // ==========================================================================

  /**
   * Ordena por ubicación, código e IdUnico usando comparación natural.
   * @param {Array<Object>} rows Registros legacy.
   * @return {Array<Object>} Copia ordenada.
   */
  /**
   * Ordena registros por ubicación, código e IdUnico.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _ordenarVista_(rows) {
    return [...(rows || [])].sort((a, b) => {
      const ubicacionA =
        toStrUpper_(a.eserie || a.ubicacionActual) ||
        CFG.SORT_FALLBACK;

      const ubicacionB =
        toStrUpper_(b.eserie || b.ubicacionActual) ||
        CFG.SORT_FALLBACK;

      const comparacionUbicacion = ubicacionA.localeCompare(
        ubicacionB,
        CFG.LOCALE,
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
        CFG.LOCALE,
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
        CFG.LOCALE,
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
  /**
   * Adapta un registro canónico al contrato legacy.
   *
   * @return {*} Resultado de la operación.
   * @private
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
  /**
   * Adapta el resumen canónico a métricas de presentación.
   *
   * @return {*} Resultado de la operación.
   * @private
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

  // ==========================================================================
  // CONSTRUCCIÓN DE RESPUESTAS
  // ==========================================================================

  /**
   * Construye la vista completa con universo, vigentes y resumen.
   * @return {{data:Array<Object>,dataCompleta:Array<Object>,resumen:Object}}
   */
  /**
   * Construye la vista completa con universo, vigentes y resumen.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _construirVista_() {
    _assertDependencies_();
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
  /**
   * Construye una respuesta ligera de vigentes y resumen.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _construirVistaLigera_() {
    _assertDependencies_();
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

      const serializeStartedAt = Date.now();
      const responseChars = _measureJsonChars_(result);

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

  // ==========================================================================
  // API PÚBLICA
  // ==========================================================================

  /**
   * Devuelve la vista completa y propaga cualquier error operativo.
   * @return {Object}
   */
  /**
   * Devuelve la vista completa y propaga errores.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerVistaRaw() {
    return _construirVista_();
  }

  /**
   * Devuelve una vista ligera tolerante para pantallas informativas.
   * @return {{data:Array<Object>,resumen:Object}}
   */
  /**
   * Devuelve una vista ligera tolerante para pantallas informativas.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerVista() {
    try {
      const result =
        _construirVistaLigera_();

      console.log(
        CFG.LOG_PREFIX + " obtenerVista :: OK",
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
        CFG.LOG_PREFIX + " obtenerVista :: ERROR message",
        error &&
        error.message
      );

      console.error(
        CFG.LOG_PREFIX + " obtenerVista :: ERROR stack",
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

  /**
   * Devuelve la vista ligera y propaga errores.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Devuelve la vista ligera y propaga errores.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerVistaLigeraRaw() {
    return _construirVistaLigera_();
  }  

  /**
   * Adapta y ordena únicamente excedentes vigentes.
   * @return {Array<Object>} Registros legacy vigentes.
   */
  /**
   * Adapta y ordena únicamente excedentes vigentes.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _construirSoloVigentes_() {
    _assertDependencies_();
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
  /**
   * Devuelve excedentes vigentes para procesos operativos.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerExcedentesConsolidados() {
    return _construirSoloVigentes_();
  }

  /**
   * Devuelve el resumen estricto de la vista completa.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Devuelve el resumen estricto de la vista completa.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function getResumen() {
    return obtenerVistaRaw().resumen;
  }

  /**
   * Devuelve los excedentes marcados como auditables.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Devuelve los excedentes marcados como auditables.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerExcedentesAuditables() {
    return obtenerVistaRaw().data.filter(
      item => item.auditable === true
    );
  }

  /**
   * Invalida la caché del servicio canónico cuando está disponible.
   * @return {boolean}
   */
  /**
   * Invalida la caché del servicio canónico.
   *
   * @return {*} Resultado de la operación.
   * @public
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
      CFG.LOG_PREFIX + " Caché canónica invalidada."
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
