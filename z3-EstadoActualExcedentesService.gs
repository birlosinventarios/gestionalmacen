/**
 * z3-EstadoActualExcedentesService
 *
 * @fileoverview Servicio canónico para calcular el estado operativo vigente de
 * cada IdUnico de excedentes.
 *
 * Integra la cantidad inicial registrada en BD-EXCEDENTES con el historial de
 * Bitacora-TRASPASOS. A partir de ambas fuentes calcula saldo, ubicación, bodega,
 * vigencia, auditabilidad y estado lógico para consultas, auditorías y procesos
 * operativos.
 *
 * Responsabilidades:
 * - Seleccionar el registro base más reciente de cada IdUnico.
 * - Consolidar movimientos de ACOMODO y SURTIDO por identificador.
 * - Determinar el último movimiento mediante fecha, hora y fila física.
 * - Calcular saldo, ubicación, bodega, vigencia y estado lógico.
 * - Construir filtros globales o por bodega para auditoría.
 * - Generar métricas globales y agrupadas por bodega.
 * - Mantener una caché local durante la ejecución actual.
 * - Exponer trazas de rendimiento de las etapas de consolidación.
 * - Devolver copias defensivas para proteger la caché interna.
 *
 * Dependencias globales:
 * - ExcedentesRepository y TraspasosRepository.
 * - toStr_(value), toStrUpper_(value), toNum_(value), round2_(value) y
 *   compareEs_(left, right).
 *
 * Reglas invariantes:
 * - BD-EXCEDENTES.CANTIDAD permanece como cantidad inicial histórica.
 * - saldoActual = cantidadInicial - suma absoluta de movimientos SURTIDO.
 * - El saldo nunca se devuelve por debajo de cero.
 * - ACOMODO no reduce el saldo, solo participa en ubicación y trazabilidad.
 * - Un excedente es vigente cuando existe en BD, su STATUS es válido y el saldo
 *   es mayor que cero.
 * - Un excedente es auditable cuando está vigente y tiene ubicación física.
 * - La ubicación vigente depende del último movimiento y del saldo actual.
 * - Las consultas con criterios vacíos devuelven [] o el universo completo según
 *   el contrato documentado de cada método.
 *
 * Estrategia de caché:
 * - La consolidación se conserva únicamente durante la ejecución actual.
 * - clearCache() obliga a reconstruir el estado en la siguiente consulta.
 * - Los resultados públicos se clonan antes de salir del servicio.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const EstadoActualExcedentesService = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    LOCALE: "es-MX",
    PERF_PREFIX: "[APPALMACEN][ESTADO_BACKEND_PERF]",
    LOG_PREFIX: "[EstadoActualExcedentesService]"
  });

  // ==========================================================================
  // VALIDACIÓN E INSTRUMENTACIÓN
  // ==========================================================================

  /**
   * Verifica la disponibilidad de repositorios y utilidades obligatorias.
   *
   * @return {void}
   * @throws {Error} Si falta alguna dependencia global.
   * @private
   */
  /**
   * Verifica la disponibilidad de repositorios y utilidades obligatorias.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _assertDependencies_() {
    const functions = [
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_],
      ["round2_", typeof round2_],
      ["compareEs_", typeof compareEs_]
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

    const repositories = [
      ["ExcedentesRepository", typeof ExcedentesRepository],
      ["TraspasosRepository", typeof TraspasosRepository]
    ];
    const missingRepositories = repositories
      .filter(function (dependency) {
        return dependency[1] === "undefined";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingRepositories.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan repositorios obligatorios: ` +
          `${missingRepositories.join(", ")}.`
      );
    }
  }

  /**
   * Inicia una traza de rendimiento para la consolidación.
   *
   * @param {*} operation Valor utilizado por la operación.
   * @param {*} metadata Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Inicia una traza de rendimiento para la consolidación.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _perfEstadoStart_(operation, metadata) {
    const now = Date.now();
    return {
      operation: String(operation || "ESTADO_OPERATION"),
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
  function _perfEstadoMark_(trace, stage, metadata) {
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
   * Finaliza, registra y devuelve la traza de rendimiento.
   *
   * @param {*} trace Valor utilizado por la operación.
   * @param {*} status Valor utilizado por la operación.
   * @param {*} metadata Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Finaliza, registra y devuelve la traza de rendimiento.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _perfEstadoEnd_(trace, status, metadata) {
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

  /** Constantes inmutables y clasificaciones del dominio. */
  const DOMAIN = Object.freeze({
    TIPO_AUDITORIA: Object.freeze({
      GLOBAL: "GLOBAL",
      POR_BODEGA: "POR_BODEGA"
    }),
    VALOR_TODAS: "TODAS",
    BODEGA_FALLBACK: "PENDIENTE DE UBICACIÓN",
    ESTATUS_LOGICOS: Object.freeze({
      UBICADO: "UBICADO",
      PENDIENTE_UBICACION: "PENDIENTE_UBICACION",
      FUERA_DE_AUDITORIA: "FUERA_DE_AUDITORIA",
      INVALIDO_BD: "INVALIDO_BD",
      SIN_REGISTRO_BD: "SIN_REGISTRO_BD",
      SIN_TRASPASOS: "SIN_TRASPASOS",
      DESCONOCIDO: "DESCONOCIDO"
    }),
    STATUS_BD_VALIDOS: Object.freeze([
      "",
      "ACOMODADO",
      "DISPONIBLE",
      "PARCIAL",
      "PENDIENTE",
      "SIN UBICACION",
      "SIN UBICACIÓN"
    ]),
    STATUS_BD_INVALIDOS: Object.freeze([
      "SURTIDO",
      "CERRADO",
      "CANCELADO",
      "ELIMINADO",
      "BAJA",
      "INACTIVO"
    ])
  });

  // ==========================================================================
  // NORMALIZACIÓN Y UTILIDADES TEMPORALES
  // ==========================================================================

  /**
   * Normaliza de forma segura un valor textual.
   *
   * @param {*} value Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Normaliza de forma segura un valor textual.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _toSafeStr_(value) {
    return toStr_(value || "");
  }

  /**
   * Normaliza un texto en mayúsculas.
   *
   * @param {*} value Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Normaliza un texto en mayúsculas.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _toSafeUpper_(value) {
    return toStrUpper_(value || "");
  }

  /**
   * Normaliza un valor numérico.
   *
   * @param {*} value Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Normaliza un valor numérico.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _toSafeNum_(value) {
    return toNum_(value || 0);
  }

  /**
   * Genera una copia defensiva serializable.
   *
   * @param {*} obj Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Genera una copia defensiva serializable.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _clone_(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Construye una marca temporal desde un excedente.
   *
   * @param {*} row Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Construye una marca temporal desde un excedente.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _timestampFromExcedente_(row) {
    const fecha = row.fechaexcedente instanceof Date
      ? row.fechaexcedente.getTime()
      : 0;

    let horaMs = 0;

    if (row.horaexcedente instanceof Date) {
      horaMs =
        row.horaexcedente.getHours() * 3600000 +
        row.horaexcedente.getMinutes() * 60000 +
        row.horaexcedente.getSeconds() * 1000;
    }

    return fecha + horaMs;
  }

  /**
   * Formatea una fecha válida como dd/MM/yyyy.
   *
   * @param {*} value Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Formatea una fecha válida como dd/MM/yyyy.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _formatDateFast_(value) {
    if (!(value instanceof Date) || isNaN(value.getTime())) return "";
    const day = String(value.getDate()).padStart(2, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    return day + "/" + month + "/" + value.getFullYear();
  }

  /**
   * Formatea una hora válida como HH:mm:ss.
   *
   * @param {*} value Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Formatea una hora válida como HH:mm:ss.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _formatTimeFast_(value) {
    if (!(value instanceof Date) || isNaN(value.getTime())) return "";
    return [
      String(value.getHours()).padStart(2, "0"),
      String(value.getMinutes()).padStart(2, "0"),
      String(value.getSeconds()).padStart(2, "0")
    ].join(":");
  }

  /**
   * Construye una marca temporal desde un movimiento.
   *
   * @param {*} movimiento Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Construye una marca temporal desde un movimiento.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _timestampFromMovimiento_(movimiento) {
    const fecha = movimiento.fechatraspaso instanceof Date
      ? movimiento.fechatraspaso.getTime()
      : 0;

    let horaMs = 0;

    if (movimiento.horatraspaso instanceof Date) {
      horaMs =
        movimiento.horatraspaso.getHours() * 3600000 +
        movimiento.horatraspaso.getMinutes() * 60000 +
        movimiento.horatraspaso.getSeconds() * 1000;
    }

    return fecha + horaMs;
  }

  /**
   * Determina si un valor representa una ubicación física conocida.
   *
   * @param {*} valor Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Determina si un valor representa una ubicación física conocida.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _esUbicacionFisica_(valor) {
    const value = _toSafeUpper_(valor);

    if (!value) return false;

    return (
      value.startsWith("B1") ||
      value.startsWith("B2") ||
      value.startsWith("B3") ||
      value.startsWith("BM") ||
      value.startsWith("CB1") ||
      value.startsWith("CB2") ||
      value.startsWith("P1-") ||
      value.startsWith("A1-") ||
      value.startsWith("A2-") ||
      value.startsWith("A3-") ||
      value.startsWith("E1-") ||
      value.startsWith("CU") ||
      value.startsWith("MO")
    );
  }

  /**
   * Infiere la bodega a partir del prefijo de ubicación.
   *
   * @param {*} serie Valor utilizado por la operación.
   * @param {*} fallback = DOMAIN.BODEGA_FALLBACK Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Infiere la bodega a partir del prefijo de ubicación.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _obtenerNombreBodegaPorSerie_(
    serie,
    fallback = DOMAIN.BODEGA_FALLBACK
  ) {
    const value = _toSafeUpper_(serie);

    if (!value) return fallback;
    if (value.startsWith("B1")) return "BODEGA 1";
    if (value.startsWith("B2")) return "BODEGA 2";
    if (value.startsWith("B3")) return "BODEGA 3";
    if (value.startsWith("BM")) return "BODEGA MOSTRADOR";
    if (value.startsWith("CB1")) return "CASA BLANCA 1";

    if (
      value.startsWith("CB2") ||
      value.startsWith("P1-") ||
      value.startsWith("A1-") ||
      value.startsWith("A2-") ||
      value.startsWith("A3-") ||
      value.startsWith("E1-")
    ) {
      return "CASA BLANCA 2";
    }

    if (value.startsWith("CU")) return "CUARTO ALTO RIESGO";
    if (value.startsWith("MO")) return "MOSTRADOR";

    return _toSafeUpper_(fallback) || DOMAIN.BODEGA_FALLBACK;
  }

  /**
   * Normaliza el alcance global o por bodega.
   *
   * @param {*} config Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Normaliza el alcance global o por bodega.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _normalizarConfigAuditoria_(config) {
    if (typeof config === "string") {
      const bodega = _toSafeUpper_(config);

      if (!bodega || bodega === DOMAIN.VALOR_TODAS) {
        return {
          tipoAuditoria: DOMAIN.TIPO_AUDITORIA.GLOBAL,
          bodegaObjetivo: DOMAIN.VALOR_TODAS
        };
      }

      return {
        tipoAuditoria: DOMAIN.TIPO_AUDITORIA.POR_BODEGA,
        bodegaObjetivo: bodega
      };
    }

    const tipoAuditoria = _toSafeUpper_(
      config && config.tipoAuditoria
    );
    const bodegaObjetivo = _toSafeUpper_(
      config && config.bodegaObjetivo
    );

    if (!tipoAuditoria && !bodegaObjetivo) {
      return {
        tipoAuditoria: DOMAIN.TIPO_AUDITORIA.GLOBAL,
        bodegaObjetivo: DOMAIN.VALOR_TODAS
      };
    }

    if (
      tipoAuditoria === DOMAIN.TIPO_AUDITORIA.GLOBAL ||
      bodegaObjetivo === DOMAIN.VALOR_TODAS
    ) {
      return {
        tipoAuditoria: DOMAIN.TIPO_AUDITORIA.GLOBAL,
        bodegaObjetivo: DOMAIN.VALOR_TODAS
      };
    }

    return {
      tipoAuditoria: DOMAIN.TIPO_AUDITORIA.POR_BODEGA,
      bodegaObjetivo: bodegaObjetivo || DOMAIN.VALOR_TODAS
    };
  }

  /**
   * Determina si STATUS permite participación operativa.
   *
   * @param {*} status Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Determina si STATUS permite participación operativa.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _esStatusBDValido_(status) {
    const value = _toSafeUpper_(status);

    if (DOMAIN.STATUS_BD_INVALIDOS.includes(value)) {
      return false;
    }

    return DOMAIN.STATUS_BD_VALIDOS.includes(value);
  }

  // ==========================================================================
  // INDEXACIÓN DE FUENTES
  // ==========================================================================

  /**
   * Selecciona el registro base más reciente de cada IdUnico.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Selecciona el registro base más reciente de cada IdUnico.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _indexarExcedentesPorIdUnico_() {
    const rows =
          typeof ExcedentesRepository.getAllForEstado === "function"
            ? ExcedentesRepository.getAllForEstado()
            : (
                ExcedentesRepository.getAllRaw
                  ? ExcedentesRepository.getAllRaw()
                  : ExcedentesRepository.getAll()
              ).filter(item => _toSafeStr_(item.idunico));

    return rows.reduce((acc, row) => {
      const id =
      _toSafeUpper_(
        row.idunico
      );
      const timestamp = _timestampFromExcedente_(row);

      if (!acc[id] || timestamp >= acc[id]._timestamp) {
        acc[id] = {
          idUnico: id,
          codigo: _toSafeUpper_(row.codigo),
          descripcion: _toSafeUpper_(row.descripcion),
          cantidadInicial: Math.abs(_toSafeNum_(row.cantidad)),
          saldoBase: Math.abs(_toSafeNum_(row.cantidad)),
          estatusRegistro: _toSafeUpper_(row.status),
          idproducto: _toSafeStr_(row.idproducto),
          fechaBase: _formatDateFast_(row.fechaexcedente),
          horaBase: _formatTimeFast_(row.horaexcedente),
          validoBD: _esStatusBDValido_(row.status),
          _timestamp: timestamp
        };
      }

      return acc;
    }, {});
  }

  /**
   * Obtiene movimientos optimizados para consolidación.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Obtiene movimientos optimizados para consolidación.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _obtenerMovimientos_() {
    if (
      typeof TraspasosRepository.getAllForEstado === "function"
    ) {
      return TraspasosRepository.getAllForEstado();
    }

    return (
      TraspasosRepository.getAllRaw
        ? TraspasosRepository.getAllRaw()
        : TraspasosRepository.getAll()
    ).filter(item => _toSafeStr_(item.idunico));
  }

  /**
   * Indexa el último movimiento por fecha, hora y fila.
   *
   * @param {*} movimientos Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Indexa el último movimiento por fecha, hora y fila.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _indexarUltimoMovimientoPorIdUnico_(
    movimientos
  ) {
    return (
      movimientos || []
    ).reduce(
      (
        acc,
        movimiento
      ) => {
        const id =
          _toSafeUpper_(
            movimiento.idunico
          );

        const timestamp =
          _timestampFromMovimiento_(
            movimiento
          );

        const fila =
          _toSafeNum_(
            movimiento.fila || 0
          );

        if (
          !acc[id] ||
          timestamp >
            acc[id]._timestamp ||
          (
            timestamp ===
              acc[id]._timestamp &&
            fila >=
              _toSafeNum_(
                acc[id]._fila || 0
              )
          )
        ) {
          acc[id] = {
            idUnico:
              id,

            ultimoTipo:
              _toSafeUpper_(
                movimiento.tipomovimiento
              ),

            ultimaSerie:
              _toSafeUpper_(
                movimiento.serie
              ),

            ultimaUbicacionEntrada:
              _toSafeUpper_(
                movimiento
                  .ubicacionentrada
              ),

            ultimaUbicacionSalida:
              _toSafeUpper_(
                movimiento
                  .ubicacionsalida
              ),

            ultimaBodegaEntrada:
              _toSafeUpper_(
                movimiento
                  .bodegaentrada
              ),

            ultimaBodegaSalida:
              _toSafeUpper_(
                movimiento
                  .bodegasalida
              ),

            cantidadMovimiento:
              _toSafeNum_(
                movimiento.cantidad
              ),

            codigoMovimiento:
              _toSafeUpper_(
                movimiento.codigo
              ),

            descripcionMovimiento:
              _toSafeUpper_(
                movimiento.descripcion
              ),

            idOperacion:
              _toSafeStr_(
                movimiento.folio
              ),

            _fechaRaw:
              movimiento.fechatraspaso,

            _horaRaw:
              movimiento.horatraspaso,

            _timestamp:
              timestamp,

            _fila:
              fila
          };
        }

        return acc;
      },
      {}
    );
  }

  /**
   * Acumula cantidades y conteos por IdUnico.
   *
   * @param {*} movimientos Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Acumula cantidades y conteos por IdUnico.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _indexarResumenMovimientosPorIdUnico_(movimientos) {
    return (movimientos || []).reduce((acc, movimiento) => {
      const id =
        _toSafeUpper_(
          movimiento.idunico
        );

      if (!acc[id]) {
        acc[id] = {
          idUnico: id,
          totalAcomodo: 0,
          totalSurtido: 0,
          cantidadMovimientos: 0,
          cantidadAcomodos: 0,
          cantidadSurtidos: 0
        };
      }

      const tipo = _toSafeUpper_(movimiento.tipomovimiento);
      const cantidad = Math.abs(
        _toSafeNum_(movimiento.cantidad)
      );

      acc[id].cantidadMovimientos += 1;

      if (tipo === "ACOMODO") {
        acc[id].totalAcomodo = round2_(
          acc[id].totalAcomodo + cantidad
        );
        acc[id].cantidadAcomodos += 1;
      }

      if (tipo === "SURTIDO") {
        acc[id].totalSurtido = round2_(
          acc[id].totalSurtido + cantidad
        );
        acc[id].cantidadSurtidos += 1;
      }

      return acc;
    }, {});
  }

  // ==========================================================================
  // RESOLUCIÓN DEL ESTADO CANÓNICO
  // ==========================================================================

  /**
   * Calcula el saldo vigente sin valores negativos.
   *
   * @param {*} base Valor utilizado por la operación.
   * @param {*} resumenMovimientos Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Calcula el saldo vigente sin valores negativos.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _resolverSaldoActual_(base, resumenMovimientos) {
    const cantidadInicial = Math.abs(
      _toSafeNum_(base ? base.cantidadInicial : 0)
    );

    const totalSurtido = Math.abs(
      _toSafeNum_(
        resumenMovimientos
          ? resumenMovimientos.totalSurtido
          : 0
      )
    );

    return Math.max(
      0,
      round2_(cantidadInicial - totalSurtido)
    );
  }

  /**
   * Resuelve la ubicación actual desde el último movimiento.
   *
   * @param {*} ultimoMovimiento Valor utilizado por la operación.
   * @param {*} saldoActual Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Resuelve la ubicación actual desde el último movimiento.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _resolverUbicacionActualDesdeTraspasos_(
    ultimoMovimiento,
    saldoActual
  ) {
    const tipo = _toSafeUpper_(
      ultimoMovimiento ? ultimoMovimiento.ultimoTipo : ""
    );
    const entrada = _toSafeUpper_(
      ultimoMovimiento
        ? ultimoMovimiento.ultimaUbicacionEntrada
        : ""
    );
    const salida = _toSafeUpper_(
      ultimoMovimiento
        ? ultimoMovimiento.ultimaUbicacionSalida
        : ""
    );
    const serie = _toSafeUpper_(
      ultimoMovimiento ? ultimoMovimiento.ultimaSerie : ""
    );

    if (tipo === "ACOMODO" || tipo === "CAMBIO DE BODEGA") {
      if (_esUbicacionFisica_(entrada)) return entrada;
      if (_esUbicacionFisica_(serie)) return serie;
      return "";
    }

    if (tipo === "SURTIDO") {
      if (_toSafeNum_(saldoActual) > 0) {
        if (_esUbicacionFisica_(salida)) return salida;
        if (_esUbicacionFisica_(serie)) return serie;
      }

      return "";
    }

    if (_esUbicacionFisica_(entrada)) return entrada;
    if (_esUbicacionFisica_(serie)) return serie;
    if (_esUbicacionFisica_(salida)) return salida;

    return "";
  }

  /**
   * Resuelve la bodega actual desde ubicación y movimiento.
   *
   * @param {*} ubicacionActual Valor utilizado por la operación.
   * @param {*} ultimoMovimiento Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Resuelve la bodega actual desde ubicación y movimiento.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _resolverBodegaActual_(ubicacionActual, ultimoMovimiento) {
    const ubicacion = _toSafeUpper_(ubicacionActual);

    if (_esUbicacionFisica_(ubicacion)) {
      return _obtenerNombreBodegaPorSerie_(
        ubicacion,
        DOMAIN.BODEGA_FALLBACK
      );
    }

    const entrada = _toSafeUpper_(
      ultimoMovimiento
        ? ultimoMovimiento.ultimaBodegaEntrada
        : ""
    );
    const salida = _toSafeUpper_(
      ultimoMovimiento
        ? ultimoMovimiento.ultimaBodegaSalida
        : ""
    );

    if (entrada && entrada !== "1 - ALMACEN BIRLOS") {
      return entrada;
    }

    if (salida && salida !== "1 - ALMACEN BIRLOS") {
      return salida;
    }

    return DOMAIN.BODEGA_FALLBACK;
  }

  /**
   * Clasifica el estado lógico consolidado.
   *
   * @param {*} base Valor utilizado por la operación.
   * @param {*} ultimoMovimiento Valor utilizado por la operación.
   * @param {*} ubicacionActual Valor utilizado por la operación.
   * @param {*} saldoActual Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Clasifica el estado lógico consolidado.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _resolverEstatusLogico_(
    base,
    ultimoMovimiento,
    ubicacionActual,
    saldoActual
  ) {
    if (!base) {
      return DOMAIN.ESTATUS_LOGICOS.SIN_REGISTRO_BD;
    }

    if (base.validoBD !== true) {
      return DOMAIN.ESTATUS_LOGICOS.INVALIDO_BD;
    }

    if (_toSafeNum_(saldoActual) <= 0) {
      return DOMAIN.ESTATUS_LOGICOS.FUERA_DE_AUDITORIA;
    }

    if (!ultimoMovimiento) {
      return DOMAIN.ESTATUS_LOGICOS.SIN_TRASPASOS;
    }

    if (_esUbicacionFisica_(ubicacionActual)) {
      return DOMAIN.ESTATUS_LOGICOS.UBICADO;
    }

    return DOMAIN.ESTATUS_LOGICOS.PENDIENTE_UBICACION;
  }

  /**
   * Construye, clasifica y ordena el universo consolidado.
   *
   * @param {*} trace Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Construye, clasifica y ordena el universo consolidado.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _construirEstado_(trace) {
    _assertDependencies_();
    const baseStartedAt = Date.now();
    const mapaBase = _indexarExcedentesPorIdUnico_();
    _perfEstadoMark_(trace, "INDEXAR_EXCEDENTES", {
      elapsedMs: Date.now() - baseStartedAt,
      ids: Object.keys(mapaBase).length
    });

    const movimientosStartedAt = Date.now();
    const movimientos = _obtenerMovimientos_();
    _perfEstadoMark_(trace, "OBTENER_MOVIMIENTOS", {
      elapsedMs: Date.now() - movimientosStartedAt,
      rows: Array.isArray(movimientos) ? movimientos.length : 0
    });

    const ultimoStartedAt = Date.now();
    const mapaUltimoMovimiento =
      _indexarUltimoMovimientoPorIdUnico_(movimientos);
    _perfEstadoMark_(trace, "INDEXAR_ULTIMO_MOVIMIENTO", {
      elapsedMs: Date.now() - ultimoStartedAt,
      ids: Object.keys(mapaUltimoMovimiento).length
    });

    const resumenStartedAt = Date.now();
    const mapaResumenMovimientos =
      _indexarResumenMovimientosPorIdUnico_(movimientos);
    _perfEstadoMark_(trace, "INDEXAR_RESUMEN_MOVIMIENTOS", {
      elapsedMs: Date.now() - resumenStartedAt,
      ids: Object.keys(mapaResumenMovimientos).length
    });

    const idsStartedAt = Date.now();
    const ids = Array.from(
      new Set([
        ...Object.keys(mapaUltimoMovimiento),
        ...Object.keys(mapaBase)
      ])
    );
    _perfEstadoMark_(trace, "UNIR_IDS", {
      elapsedMs: Date.now() - idsStartedAt,
      ids: ids.length
    });

    const buildStartedAt = Date.now();
    const estado = ids.map(id => {
      const base = mapaBase[id] || null;
      const ultimoMovimiento = mapaUltimoMovimiento[id] || null;
      const resumenMovimientos = mapaResumenMovimientos[id] || null;

      const saldoActual = _resolverSaldoActual_(base, resumenMovimientos);
      const ubicacionActual = _resolverUbicacionActualDesdeTraspasos_(
        ultimoMovimiento,
        saldoActual
      );
      const bodegaActual = _resolverBodegaActual_(
        ubicacionActual,
        ultimoMovimiento
      );
      const estatusLogico = _resolverEstatusLogico_(
        base,
        ultimoMovimiento,
        ubicacionActual,
        saldoActual
      );

      const existeBD = !!base;
      const validoBD = base ? base.validoBD === true : false;
      const vigente = existeBD && validoBD && saldoActual > 0;
      const conUbicacion = _esUbicacionFisica_(ubicacionActual);
      const pendienteUbicacion = vigente && !conUbicacion;
      const auditable = vigente && conUbicacion;

      return {
        idUnico: id,
        codigo: base
          ? base.codigo
          : _toSafeUpper_(ultimoMovimiento ? ultimoMovimiento.codigoMovimiento : ""),
        descripcion: base
          ? base.descripcion
          : _toSafeUpper_(ultimoMovimiento ? ultimoMovimiento.descripcionMovimiento : ""),
        idproducto: base ? base.idproducto : "",
        existeBD,
        estatusRegistro: base ? base.estatusRegistro : "",
        validoBD,
        vigente,
        cantidadInicial: base ? base.cantidadInicial : 0,
        saldoBase: base ? base.cantidadInicial : 0,
        totalSurtido: resumenMovimientos ? resumenMovimientos.totalSurtido : 0,
        cantidadSurtidos: resumenMovimientos ? resumenMovimientos.cantidadSurtidos : 0,
        cantidadAcomodos: resumenMovimientos ? resumenMovimientos.cantidadAcomodos : 0,
        saldoActual,
        ubicacionActual,
        bodegaActual,
        estatusLogico,
        conUbicacion,
        pendienteUbicacion,
        auditable,
        fechaBase: base ? base.fechaBase : "",
        horaBase: base ? base.horaBase : "",
        ultimoMovimientoTipo: ultimoMovimiento ? ultimoMovimiento.ultimoTipo : "",
        ultimaSerieMovimiento: ultimoMovimiento ? ultimoMovimiento.ultimaSerie : "",
        ultimaUbicacionEntrada: ultimoMovimiento ? ultimoMovimiento.ultimaUbicacionEntrada : "",
        ultimaUbicacionSalida: ultimoMovimiento ? ultimoMovimiento.ultimaUbicacionSalida : "",
        ultimaBodegaEntrada: ultimoMovimiento ? ultimoMovimiento.ultimaBodegaEntrada : "",
        ultimaBodegaSalida: ultimoMovimiento ? ultimoMovimiento.ultimaBodegaSalida : "",
        ultimaFechaMovimiento: ultimoMovimiento ? _formatDateFast_( ultimoMovimiento._fechaRaw ) : "",
        ultimaHoraMovimiento: ultimoMovimiento ? _formatTimeFast_( ultimoMovimiento._horaRaw ) : "",
        ultimaIdOperacion: ultimoMovimiento ? ultimoMovimiento.idOperacion : ""
      };
    });
    _perfEstadoMark_(trace, "CONSTRUIR_ESTADO", {
      elapsedMs: Date.now() - buildStartedAt,
      rows: estado.length
    });

    const sortStartedAt = Date.now();
    estado.sort((a, b) => {
      const ubicacionA = _toSafeUpper_(a.ubicacionActual) || "ZZZZZZ";
      const ubicacionB = _toSafeUpper_(b.ubicacionActual) || "ZZZZZZ";
      const comparacionUbicacion = ubicacionA.localeCompare(
        ubicacionB,
        CFG.LOCALE,
        { sensitivity: "base", numeric: true }
      );
      if (comparacionUbicacion !== 0) return comparacionUbicacion;

      const comparacionCodigo = _toSafeUpper_(a.codigo).localeCompare(
        _toSafeUpper_(b.codigo),
        CFG.LOCALE,
        { sensitivity: "base", numeric: true }
      );
      if (comparacionCodigo !== 0) return comparacionCodigo;

      return _toSafeStr_(a.idUnico).localeCompare(
        _toSafeStr_(b.idUnico),
        CFG.LOCALE,
        { sensitivity: "base", numeric: true }
      );
    });
    _perfEstadoMark_(trace, "ORDENAR_ESTADO", {
      elapsedMs: Date.now() - sortStartedAt,
      rows: estado.length
    });

    return estado;
  }

  // ==========================================================================
  // CACHÉ Y API PÚBLICA
  // ==========================================================================

  /** @type {Array<Object>|null} Caché consolidada de la ejecución actual. */
  let cacheEstado_ = null;

  /**
   * Obtiene la consolidación desde caché o la construye.
   *
   * @param {*} trace Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  /**
   * Obtiene la consolidación desde caché o la construye.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _getEstado_(trace) {
    if (cacheEstado_ === null) {
      const buildStartedAt = Date.now();
      cacheEstado_ = _construirEstado_(trace);
      _perfEstadoMark_(trace, "MEMORY_CACHE_BUILT", {
        elapsedMs: Date.now() - buildStartedAt,
        total: cacheEstado_.length
      });
    } else {
      _perfEstadoMark_(trace, "MEMORY_CACHE_HIT", {
        total: cacheEstado_.length
      });
    }

    return cacheEstado_;
  }

  /**
   * Devuelve una copia completa del estado consolidado.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Devuelve una copia completa del estado consolidado.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function getAll() {
    return _clone_(_getEstado_());
  }

  /**
   * Devuelve excedentes vigentes con saldo positivo.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Devuelve excedentes vigentes con saldo positivo.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function getVigentes() {
    const trace =
      _perfEstadoStart_(
        "ESTADO_GET_VIGENTES"
      );

    try {
      const estado =
        _getEstado_(trace);

      const filterStartedAt =
        Date.now();

      const vigentes =
        estado.filter(
          item =>
            item.vigente === true
        );

      _perfEstadoMark_(
        trace,
        "FILTRAR_VIGENTES",
        {
          elapsedMs:
            Date.now() -
            filterStartedAt,

          sourceRows:
            estado.length,

          rows:
            vigentes.length
        }
      );

      const cloneStartedAt =
        Date.now();

      const result =
        _clone_(vigentes);

      _perfEstadoMark_(
        trace,
        "CLONAR_VIGENTES",
        {
          elapsedMs:
            Date.now() -
            cloneStartedAt,

          rows:
            result.length
        }
      );

      _perfEstadoEnd_(
        trace,
        "ok",
        {
          sourceRows:
            estado.length,

          rows:
            result.length
        }
      );

      return result;
    } catch (error) {
      _perfEstadoMark_(
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

      _perfEstadoEnd_(
        trace,
        "error"
      );

      throw error;
    }
  }

  /**
   * Filtra excedentes auditables por alcance.
   *
   * @param {*} config Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Filtra excedentes auditables por alcance.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function getAuditables(config) {
    const cfg = _normalizarConfigAuditoria_(config);
    let output = _getEstado_().filter(item => item.auditable);

    if (
      cfg.tipoAuditoria === DOMAIN.TIPO_AUDITORIA.POR_BODEGA &&
      cfg.bodegaObjetivo &&
      cfg.bodegaObjetivo !== DOMAIN.VALOR_TODAS
    ) {
      output = output.filter(
        item =>
          _toSafeUpper_(item.bodegaActual) ===
          cfg.bodegaObjetivo
      );
    }

    return _clone_(output);
  }

  /**
   * Busca coincidencias por IdUnico normalizado.
   *
   * @param {*} idUnico Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Busca coincidencias por IdUnico normalizado.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function getPorIdUnico(idUnico) {
    const id =
      _toSafeUpper_(
        idUnico
      );

    return _clone_(
      _getEstado_().filter(
        function(item) {
          return (
            _toSafeUpper_(
              item.idUnico
            ) ===
            id
          );
        }
      )
    );
  }


  /**
   * Devuelve la primera coincidencia o null.
   *
   * @param {*} idUnico Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Devuelve la primera coincidencia o null.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function getUnoPorIdUnico(idUnico) {
    return getPorIdUnico(idUnico)[0] || null;
  }

  /**
   * Busca excedentes por ubicación actual.
   *
   * @param {*} ubicacion Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Busca excedentes por ubicación actual.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function getPorUbicacion(ubicacion) {
    const value = _toSafeUpper_(ubicacion);

    return _clone_(
      _getEstado_().filter(
        item =>
          _toSafeUpper_(item.ubicacionActual) === value
      )
    );
  }

  /**
   * Busca excedentes por bodega actual.
   *
   * @param {*} bodega Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Busca excedentes por bodega actual.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function getPorBodega(bodega) {
    const value = _toSafeUpper_(bodega);

    if (!value || value === DOMAIN.VALOR_TODAS) {
      return getAll();
    }

    return _clone_(
      _getEstado_().filter(
        item => _toSafeUpper_(item.bodegaActual) === value
      )
    );
  }

  /**
   * Construye métricas globales y por bodega.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Construye métricas globales y por bodega.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function getResumen() {
    const all = _getEstado_();
    const vigentes = all.filter(item => item.vigente);
    const auditables = all.filter(item => item.auditable);
    const pendientesUbicacion = all.filter(
      item => item.pendienteUbicacion
    );
    const invalidosBD = all.filter(
      item =>
        item.estatusLogico ===
        DOMAIN.ESTATUS_LOGICOS.INVALIDO_BD
    );
    const sinRegistroBD = all.filter(
      item =>
        item.estatusLogico ===
        DOMAIN.ESTATUS_LOGICOS.SIN_REGISTRO_BD
    );

    const porBodega = auditables.reduce((acc, item) => {
      const bodega =
        _toSafeUpper_(item.bodegaActual) ||
        DOMAIN.BODEGA_FALLBACK;

      if (!acc[bodega]) {
        acc[bodega] = {
          bodega,
          totalIdUnicos: 0,
          stockTotal: 0
        };
      }

      acc[bodega].totalIdUnicos += 1;
      acc[bodega].stockTotal = round2_(
        acc[bodega].stockTotal +
        _toSafeNum_(item.saldoActual)
      );

      return acc;
    }, {});

    return {
      totalIdUnicos: all.length,
      vigentes: vigentes.length,
      invalidosBD: invalidosBD.length,
      sinRegistroBD: sinRegistroBD.length,
      conUbicacion: all.filter(item => item.conUbicacion).length,
      pendientesUbicacion: pendientesUbicacion.length,
      auditables: auditables.length,
      cerrados: all.filter(
        item => item.saldoActual <= 0
      ).length,
      stockTotalVigente: round2_(
        vigentes.reduce(
          (total, item) =>
            total + _toSafeNum_(item.saldoActual),
          0
        )
      ),
      stockTotalAuditable: round2_(
        auditables.reduce(
          (total, item) =>
            total + _toSafeNum_(item.saldoActual),
          0
        )
      ),
      bodegasAuditables: Object.keys(porBodega).sort(
        compareEs_
      ),
      porBodega: Object.keys(porBodega)
        .sort(compareEs_)
        .map(key => porBodega[key])
    };
  }

  /**
   * Invalida la consolidación local.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  /**
   * Invalida la consolidación local.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function clearCache() {
    cacheEstado_ = null;
    console.log(
      CFG.LOG_PREFIX + " Caché invalidada."
    );
    return true;
  }

  return Object.freeze({
    getAll,
    getVigentes,
    getAuditables,
    getPorIdUnico,
    getUnoPorIdUnico,
    getPorUbicacion,
    getPorBodega,
    getResumen,
    clearCache
  });
})();
