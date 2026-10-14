/**
 * z3-AuditoriaExcedentesService
 *
 * @fileoverview Servicio principal de aplicación para administrar auditorías de
 * excedentes, sus métricas, estado operativo y respuestas para la interfaz.
 *
 * Coordina la apertura y cierre de auditorías, delega operaciones de ubicación
 * al servicio de detalle, calcula indicadores deduplicados, construye el estado
 * operativo en vivo y normaliza todos los resultados antes de enviarlos al
 * navegador mediante google.script.run.
 *
 * Responsabilidades:
 * - Administrar el ciclo de vida completo de una auditoría.
 * - Construir el universo esperado según el alcance global o por bodega.
 * - Calcular métricas maestras a partir del detalle persistido.
 * - Medir confiabilidad, progreso, ritmo y tiempo estimado restante.
 * - Construir el detalle completo y el pulso operativo en vivo.
 * - Reconciliar opcionalmente AuditoriaExcedentesLiveCache con Sheets.
 * - Delegar la apertura, captura y cierre de ubicaciones.
 * - Normalizar Date, NaN e Infinity para respuestas serializables.
 * - Generar métricas globales para el tablero de auditorías.
 *
 * Dependencias globales:
 * - AuditoriaExcedentesRepository.
 * - AuditoriaExcedentesDetalleRepository.
 * - AuditoriaExcedentesDetalleService.
 * - EstadoActualExcedentesService.
 * - AuditoriaExcedentesLiveCache como integración opcional.
 * - UsuariosRepository como catálogo opcional para el bootstrap.
 * - Session, Utilities y servicios estándar de Google Apps Script.
 * - toStr_(), toStrUpper_(), toNum_(), compareEs_(),
 *   inferWarehouseByLocation_() y minutesDiffFromStrings_().
 *
 * Reglas de integridad:
 * - Una auditoría debe existir antes de consultarse o modificarse.
 * - Las operaciones de captura requieren una auditoría ABIERTA.
 * - Las métricas deduplican IdUnicos antes de contar resultados.
 * - Los sobrantes se deduplican por ubicación e IdUnico.
 * - Una auditoría no debe cerrarse con ubicaciones abiertas, salvo que el flujo
 *   solicite explícitamente cerrarlas primero.
 * - Sheets es la fuente autoritativa en las cargas completas.
 * - Las respuestas públicas deben ser serializables para google.script.run.
 *
 * Concurrencia:
 * - Este servicio no adquiere LockService.
 * - La capa invocadora debe proteger secuencias críticas de lectura y escritura
 *   cuando varias solicitudes puedan modificar la misma auditoría.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const AuditoriaExcedentesService = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    DEFAULT_TIME_ZONE: "America/Mexico_City",
    ALL_WAREHOUSES: "TODAS",
    UNASSIGNED_WAREHOUSE: CFG.UNASSIGNED_WAREHOUSE,
    RELIABILITY_CRITICAL_MAX: 90,
    RELIABILITY_CONTROLLED_MIN: 97,
    LOG_PREFIX: "[AuditoriaExcedentesService]",
    LIVE_LOG_PREFIX: "[AuditoriaExcedentesLiveCache]"
  });

  const STATUS = Object.freeze({
    ABIERTA: "ABIERTA",
    CERRADA: "CERRADA"
  });

  const TIPOS_AUDITORIA = Object.freeze({
    GLOBAL: "GLOBAL",
    POR_BODEGA: "POR_BODEGA"
  });

  // =========================================================
  // HELPERS GENERALES
  // =========================================================

  /**
   * Verifica que las dependencias obligatorias estén disponibles.
   *
   * @return {void}
   * @throws {Error} Si falta una utilidad, servicio o API de Apps Script.
   * @private
   */
  /**
   * Ejecuta la operación _assertDependencies_.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _assertDependencies_() {
    const functions = [
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_],
      ["compareEs_", typeof compareEs_],
      ["inferWarehouseByLocation_", typeof inferWarehouseByLocation_],
      ["minutesDiffFromStrings_", typeof minutesDiffFromStrings_]
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

    const services = [
      ["AuditoriaExcedentesRepository", typeof AuditoriaExcedentesRepository],
      [
        "AuditoriaExcedentesDetalleRepository",
        typeof AuditoriaExcedentesDetalleRepository
      ],
      [
        "AuditoriaExcedentesDetalleService",
        typeof AuditoriaExcedentesDetalleService
      ],
      ["EstadoActualExcedentesService", typeof EstadoActualExcedentesService]
    ];
    const missingServices = services
      .filter(function (dependency) {
        return dependency[1] === "undefined";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingServices.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan servicios obligatorios: ` +
          `${missingServices.join(", ")}.`
      );
    }

    if (typeof Session === "undefined" || typeof Utilities === "undefined") {
      throw new Error(
        `${CFG.LOG_PREFIX} Session y Utilities son servicios obligatorios.`
      );
    }
  }

  /**
   * Valida un payload público.
   *
   * @param {*} payload Valor recibido por una operación.
   * @param {string} operationName Nombre de la operación para diagnóstico.
   * @return {!Object} Payload validado.
   * @throws {TypeError} Si el valor no es un objeto plano.
   * @private
   */
  /**
   * Ejecuta la operación _payloadOrThrow_.
   *
   * @param {*} payload Valor utilizado por la operación.
   * @param {*} operationName Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _payloadOrThrow_(payload, operationName) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError(`${operationName} requiere un objeto payload válido.`);
    }
    return payload;
  }

  /**
   * Obtiene la zona horaria efectiva del proyecto.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _tz_() {
    return Session.getScriptTimeZone() || CFG.DEFAULT_TIME_ZONE;
  }

  /**
   * Devuelve la fecha y hora actual.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _now_() {
    return new Date();
  }

  /**
   * Formatea una fecha con el contrato dd/MM/yyyy.
   *
   * @param {*} date Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _fmtDate_(date) {
    return Utilities.formatDate(date || _now_(), _tz_(), "dd/MM/yyyy");
  }

  /**
   * Formatea una hora con el contrato HH:mm:ss.
   *
   * @param {*} date Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _fmtTime_(date) {
    return Utilities.formatDate(date || _now_(), _tz_(), "HH:mm:ss");
  }

  /**
   * Redondea un valor numérico a dos decimales.
   *
   * @param {*} value Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _round2_(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  /**
   * Calcula un porcentaje seguro.
   *
   * @param {*} numerator Valor utilizado por la operación.
   * @param {*} denominator Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _pct_(numerator, denominator) {
    return toNum_(denominator) > 0
      ? _round2_((toNum_(numerator) / toNum_(denominator)) * 100)
      : 0;
  }

  /**
   * Genera un identificador temporal de auditoría.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _genIdAuditoria_() {
    return "AUD-" + Utilities.formatDate(_now_(), _tz_(), "yyyyMMdd-HHmmss");
  }

  /**
   * Deduplica una colección mediante una clave calculada.
   *
   * @param {*} arr Valor utilizado por la operación.
   * @param {*} mapper Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _uniqueBy_(arr, mapper) {
    const seen = new Set();

    return (arr || []).filter(function(item) {
      const key = mapper(item);

      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  /**
   * Obtiene una auditoría o genera un error descriptivo.
   *
   * @param {*} idauditoria Valor utilizado por la operación.
   * @param {*} fresh Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _getAuditoriaOrThrow_(idauditoria, fresh) {
    _assertDependencies_();
    const id = toStr_(idauditoria);

    if (!id) {
      throw new Error("Se requiere IdAuditoria.");
    }

    const audit = fresh !== false && AuditoriaExcedentesRepository.getByIdAuditoriaFresh
      ? AuditoriaExcedentesRepository.getByIdAuditoriaFresh(id)
      : AuditoriaExcedentesRepository.getByIdAuditoria(id);

    if (!audit) {
      throw new Error("No existe la auditoria " + id);
    }

    return audit;
  }

  /**
   * Construye la configuración para EstadoActualExcedentesService.
   *
   * @param {*} audit Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _buildConfigEstadoActual_(audit) {
    if (toStrUpper_(audit.tipoauditoria) === TIPOS_AUDITORIA.POR_BODEGA) {
      return {
        tipoAuditoria: TIPOS_AUDITORIA.POR_BODEGA,
        bodegaObjetivo: toStrUpper_(audit.bodegaobjetivo)
      };
    }

    return {
      tipoAuditoria: TIPOS_AUDITORIA.GLOBAL,
      bodegaObjetivo: CFG.ALL_WAREHOUSES
    };
  }

  /**
   * Obtiene el universo auditable esperado.
   *
   * @param {*} audit Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _getUniversoEsperado_(audit) {
    return EstadoActualExcedentesService.getAuditables(
      _buildConfigEstadoActual_(audit)
    ) || [];
  }

  /**
   * Infiere la bodega asociada a una ubicación.
   *
   * @param {*} ubicacion Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _inferirBodegaPorUbicacion_(ubicacion) {
    return inferWarehouseByLocation_(
      toStrUpper_(ubicacion),
      CFG.UNASSIGNED_WAREHOUSE
    );
  }

  /**
   * Clasifica visualmente el nivel de confiabilidad.
   *
   * @param {*} valor Valor utilizado por la operación.
   * @param {*} esperados Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _confiabilidadState_(valor, esperados) {
    const value = _round2_(valor);

    if (toNum_(esperados) <= 0) {
      return {
        valor: 0,
        nivel: "SIN_DATOS",
        color: "slate",
        label: "SIN DATOS"
      };
    }

    if (value < CFG.RELIABILITY_CRITICAL_MAX) {
      return {
        valor: value,
        nivel: "RED",
        color: "red",
        label: "CRITICA"
      };
    }

    if (value >= CFG.RELIABILITY_CONTROLLED_MIN) {
      return {
        valor: value,
        nivel: "EMERALD",
        color: "emerald",
        label: "CONTROLADA"
      };
    }

    return {
      valor: value,
      nivel: "AMBER",
      color: "amber",
      label: "ATENCION"
    };
  }

  /**
   * Lee el detalle de una auditoría.
   *
   * @param {*} id Valor utilizado por la operación.
   * @param {*} fresh Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _leerDetalle_(id, fresh) {
    return fresh !== false && AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh
      ? AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh(id) || []
      : AuditoriaExcedentesDetalleRepository.getByIdAuditoria(id) || [];
  }

  /**
   * Convierte Date, NaN e Infinity antes de enviar la respuesta al navegador.
   * google.script.run debe recibir un objeto plano y serializable.
   */
  /**
   * Convierte recursivamente una respuesta a valores serializables.
   *
   * @param {*} value Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _normalizarRespuestaCliente_(value) {
    function sanitize(current, keyName) {
      if (current === null || current === undefined) {
        return current;
      }

      if (current instanceof Date) {
        if (isNaN(current.getTime())) {
          return "";
        }

        const key = toStrUpper_(keyName);
        const isDateField = key.indexOf("FECHA") !== -1;

        return Utilities.formatDate(
          current,
          _tz_(),
          isDateField ? "dd/MM/yyyy" : "HH:mm:ss"
        );
      }

      if (Array.isArray(current)) {
        return current.map(function(item) {
          return sanitize(item, keyName);
        });
      }

      if (typeof current === "object") {
        const output = {};

        Object.keys(current).forEach(function(key) {
          output[key] = sanitize(current[key], key);
        });

        return output;
      }

      if (typeof current === "number" && !isFinite(current)) {
        return 0;
      }

      return current;
    }

    return sanitize(value, "");
  }

  // =========================================================
  // RESUMEN MAESTRO
  // =========================================================

  /**
   * Calcula métricas leyendo auditoría y detalle.
   *
   * @param {*} idauditoria Valor utilizado por la operación.
   * @param {*} options Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _calcularMetricosAuditoriaDesdeDetalle_(idauditoria, options) {
    options = options || {};

    const id = toStr_(idauditoria);
    const audit = _getAuditoriaOrThrow_(id, options.usarFresh !== false);
    const detalle = _leerDetalle_(id, options.usarFresh !== false);

    const markers = detalle.filter(function(item) {
      return !toStr_(item.idunico) && item.horainicioubicacion;
    });

    const cerrados = markers.filter(function(item) {
      return !!item.horafinubicacion;
    });

    const abiertos = markers.filter(function(item) {
      return !item.horafinubicacion;
    });

    const rows = detalle.filter(function(item) {
      return !!toStr_(item.idunico);
    });

    const correctos = _uniqueBy_(
      rows.filter(function(item) {
        return item.escorrecto === true;
      }),
      function(item) {
        return toStrUpper_(item.idunico);
      }
    );

    const faltantes = _uniqueBy_(
      rows.filter(function(item) {
        return item.esfaltante === true;
      }),
      function(item) {
        return toStrUpper_(item.idunico);
      }
    );

    const sobrantes = _uniqueBy_(
      rows.filter(function(item) {
        return item.essobrante === true;
      }),
      function(item) {
        return toStrUpper_(item.ubicacion) + "__" + toStrUpper_(item.idunico);
      }
    );

    const escaneados = _uniqueBy_(
      rows.filter(function(item) {
        return item.esfaltante !== true;
      }),
      function(item) {
        return toStrUpper_(item.idunico);
      }
    );

    const ubicacionesAuditadas = _uniqueBy_(
      cerrados,
      function(item) {
        return toStrUpper_(item.ubicacion);
      }
    ).length;

    const ubicacionesAbiertas = _uniqueBy_(
      abiertos,
      function(item) {
        return toStrUpper_(item.ubicacion);
      }
    ).length;

    const ubicacionesTocadas = _uniqueBy_(
      detalle.filter(function(item) {
        return (
          toStr_(item.ubicacion) &&
          (
            toStr_(item.idunico) ||
            item.horainicioubicacion ||
            item.horafinubicacion
          )
        );
      }),
      function(item) {
        return toStrUpper_(item.ubicacion);
      }
    ).length;

    const ubicacionesConDiferencia = _uniqueBy_(
      rows.filter(function(item) {
        return item.esfaltante === true || item.essobrante === true;
      }),
      function(item) {
        return toStrUpper_(item.ubicacion);
      }
    ).length;

    const esperadoDetalle = correctos.length + faltantes.length;
    const esperadoCabecera = toNum_(audit.idunicosesperadostotales);
    const estatus = toStrUpper_(audit.estatus);

    const esperados = estatus === STATUS.ABIERTA
      ? Math.max(esperadoCabecera, esperadoDetalle)
      : (esperadoDetalle > 0 ? esperadoDetalle : esperadoCabecera);

    const confiabilidad = _pct_(correctos.length, esperados);

    return {
      idauditoria: id,
      ubicacionesauditadas: ubicacionesAuditadas,
      ubicacionesabiertas: ubicacionesAbiertas,
      ubicacionestocadas: ubicacionesTocadas,
      ubicacionescondiferencia: ubicacionesConDiferencia,
      idunicosesperadostotales: esperados,
      idunicosescaneadostotales: escaneados.length,
      idunicoscorrectostotales: correctos.length,
      idunicosfaltantestotales: faltantes.length,
      idunicossobrantestotales: sobrantes.length,
      confiabilidadtotal: confiabilidad,
      confiabilidadState: _confiabilidadState_(confiabilidad, esperados),
      totalFilasDetalle: detalle.length,
      totalMarcadores: markers.length,
      totalMarcadoresCerrados: cerrados.length,
      totalMarcadoresAbiertos: abiertos.length
    };
  }

  /**
   * Calcula métricas a partir de datos ya disponibles.
   *
   * @param {*} audit Valor utilizado por la operación.
   * @param {*} detalle Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _calcularMetricosDesdeDatos_(audit, detalle) {
    const safeAudit = audit || {};
    const safeDetalle = Array.isArray(detalle) ? detalle : [];

    const markers = safeDetalle.filter(function (item) {
      return !toStr_(item.idunico) && item.horainicioubicacion;
    });

    const cerrados = markers.filter(function (item) {
      return !!item.horafinubicacion;
    });

    const abiertos = markers.filter(function (item) {
      return !item.horafinubicacion;
    });

    const rows = safeDetalle.filter(function (item) {
      return !!toStr_(item.idunico);
    });

    const correctos = _uniqueBy_(
      rows.filter(function (item) {
        return item.escorrecto === true;
      }),
      function (item) {
        return toStrUpper_(item.idunico);
      }
    );

    const faltantes = _uniqueBy_(
      rows.filter(function (item) {
        return item.esfaltante === true;
      }),
      function (item) {
        return toStrUpper_(item.idunico);
      }
    );

    const sobrantes = _uniqueBy_(
      rows.filter(function (item) {
        return item.essobrante === true;
      }),
      function (item) {
        return toStrUpper_(item.ubicacion) + "__" + toStrUpper_(item.idunico);
      }
    );

    const escaneados = _uniqueBy_(
      rows.filter(function (item) {
        return item.esfaltante !== true;
      }),
      function (item) {
        return toStrUpper_(item.idunico);
      }
    );

    const ubicacionesAuditadas = _uniqueBy_(
      cerrados,
      function (item) {
        return toStrUpper_(item.ubicacion);
      }
    ).length;

    const ubicacionesAbiertas = _uniqueBy_(
      abiertos,
      function (item) {
        return toStrUpper_(item.ubicacion);
      }
    ).length;

    const ubicacionesTocadas = _uniqueBy_(
      safeDetalle.filter(function (item) {
        return toStr_(item.ubicacion) && (
          toStr_(item.idunico) ||
          item.horainicioubicacion ||
          item.horafinubicacion
        );
      }),
      function (item) {
        return toStrUpper_(item.ubicacion);
      }
    ).length;

    const ubicacionesConDiferencia = _uniqueBy_(
      rows.filter(function (item) {
        return item.esfaltante === true || item.essobrante === true;
      }),
      function (item) {
        return toStrUpper_(item.ubicacion);
      }
    ).length;

    const esperadoDetalle = correctos.length + faltantes.length;
    const esperadoCabecera = toNum_(safeAudit.idunicosesperadostotales);
    const estatus = toStrUpper_(safeAudit.estatus);

    const esperados = estatus === STATUS.ABIERTA
      ? Math.max(esperadoCabecera, esperadoDetalle)
      : (esperadoDetalle > 0 ? esperadoDetalle : esperadoCabecera);

    const confiabilidad = _pct_(correctos.length, esperados);

    return {
      idauditoria: toStr_(safeAudit.idauditoria),
      ubicacionesauditadas: ubicacionesAuditadas,
      ubicacionesabiertas: ubicacionesAbiertas,
      ubicacionestocadas: ubicacionesTocadas,
      ubicacionescondiferencia: ubicacionesConDiferencia,
      idunicosesperadostotales: esperados,
      idunicosescaneadostotales: escaneados.length,
      idunicoscorrectostotales: correctos.length,
      idunicosfaltantestotales: faltantes.length,
      idunicossobrantestotales: sobrantes.length,
      confiabilidadtotal: confiabilidad,
      confiabilidadState: _confiabilidadState_(confiabilidad, esperados),
      totalFilasDetalle: safeDetalle.length,
      totalMarcadores: markers.length,
      totalMarcadoresCerrados: cerrados.length,
      totalMarcadoresAbiertos: abiertos.length
    };
  }

  /**
   * Consolida ubicaciones a partir del detalle en memoria.
   *
   * @param {*} detalle Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _listarUbicacionesDesdeDetalle_(detalle) {
    const map = {};

    (Array.isArray(detalle) ? detalle : []).forEach(function (item) {
      const ubicacion = toStrUpper_(item.ubicacion);
      if (!ubicacion) return;

      if (!map[ubicacion]) {
        map[ubicacion] = {
          ubicacion: ubicacion,
          bodega: toStrUpper_(item.bodega),
          secuenciaubicacion: toNum_(item.secuenciaubicacion),
          abierta: false,
          cerrada: false,
          tieneActividad: false,
          marcadorIncompleto: false
        };
      }

      map[ubicacion].secuenciaubicacion = Math.max(
        map[ubicacion].secuenciaubicacion,
        toNum_(item.secuenciaubicacion)
      );

      if (item.idunico) {
        map[ubicacion].tieneActividad = true;
      } else {
        if (item.horainicioubicacion && !item.horafinubicacion) {
          map[ubicacion].abierta = true;
        }

        if (item.horainicioubicacion && item.horafinubicacion) {
          map[ubicacion].cerrada = true;
        }

        if (!item.horainicioubicacion) {
          map[ubicacion].marcadorIncompleto = true;
        }
      }
    });

    return Object.values(map)
      .filter(function (item) {
        return item.abierta || item.cerrada || item.tieneActividad;
      })
      .sort(function (a, b) {
        return (
          toNum_(a.secuenciaubicacion) - toNum_(b.secuenciaubicacion) ||
          compareEs_(a.ubicacion, b.ubicacion)
        );
      });
  }

  /**
   * Recalcula y opcionalmente persiste el resumen maestro.
   *
   * @param {*} idauditoria Valor utilizado por la operación.
   * @param {*} options Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function recalcularResumen(idauditoria, options) {
    options = options || {};

    const persistir = options.persistir !== false;

    if (persistir && options.usarFresh !== false) {
      options.usarFresh = true;
    }

    const metricos = _calcularMetricosAuditoriaDesdeDetalle_(
      idauditoria,
      options
    );

    const patch = {
      ubicacionesauditadas: metricos.ubicacionesauditadas,
      ubicacionescondiferencia: metricos.ubicacionescondiferencia,
      idunicosesperadostotales: metricos.idunicosesperadostotales,
      idunicosescaneadostotales: metricos.idunicosescaneadostotales,
      idunicoscorrectostotales: metricos.idunicoscorrectostotales,
      idunicosfaltantestotales: metricos.idunicosfaltantestotales,
      idunicossobrantestotales: metricos.idunicossobrantestotales,
      confiabilidadtotal: metricos.confiabilidadtotal
    };

    if (persistir) {
      AuditoriaExcedentesRepository.updateByIdAuditoria(
        idauditoria,
        patch
      );
    }

    return {
      ...metricos,
      ...patch
    };
  }

  // =========================================================
  // TIEMPO Y RITMO
  // =========================================================

  /**
   * Convierte una hora Date o textual a segundos del día.
   *
   * @param {*} value Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _timeToSeconds_(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        return null;
      }

      return (
        value.getHours() * 3600 +
        value.getMinutes() * 60 +
        value.getSeconds()
      );
    }

    const text = toStr_(value);
    const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

    if (!match) {
      return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);

    if (hours > 23 || minutes > 59 || seconds > 59) {
      return null;
    }

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Calcula minutos transcurridos entre dos horas.
   *
   * @param {*} inicio Valor utilizado por la operación.
   * @param {*} fin Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _diffMinutes_(inicio, fin) {
    const start = _timeToSeconds_(inicio);
    const end = _timeToSeconds_(fin || _fmtTime_());

    if (start === null || end === null) {
      return 0;
    }

    let diff = end - start;

    if (diff < 0) {
      diff += 86400;
    }

    return _round2_(diff / 60);
  }

  // =========================================================
  // UBICACIONES EN VIVO
  // =========================================================

  /**
   * Agrupa el universo esperado por ubicación.
   *
   * @param {*} audit Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _esperadosMap_(audit) {
    const map = {};

    _getUniversoEsperado_(audit).forEach(function(row) {
      const ubicacion = toStrUpper_(row.ubicacionActual || row.ubicacion);
      const idunico = toStrUpper_(row.idUnico || row.idunico);

      if (!ubicacion || !idunico) {
        return;
      }

      if (!map[ubicacion]) {
        map[ubicacion] = {
          total: 0,
          bodega: toStrUpper_(
            row.bodegaActual ||
            row.bodega ||
            _inferirBodegaPorUbicacion_(ubicacion)
          )
        };
      }

      map[ubicacion].total += 1;
    });

    return map;
  }

  /**
   * Construye el estado operativo por ubicación.
   *
   * @param {*} idauditoria Valor utilizado por la operación.
   * @param {*} audit Valor utilizado por la operación.
   * @param {*} detalle Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _buildUbicacionesEnVivo_(idauditoria, audit, detalle) {
    const id = toStr_(idauditoria);
    const safeAudit = audit || _getAuditoriaOrThrow_(id, true);
    const safeDetalle = Array.isArray(detalle)
      ? detalle
      : _leerDetalle_(id, true);

    const expected = _esperadosMap_(safeAudit);
    const map = {};

    function ensure(ubicacion, bodega) {
      const ubi = toStrUpper_(ubicacion);

      if (!ubi) {
        return null;
      }

      if (!map[ubi]) {
        const expectedInfo = expected[ubi] || {};

        map[ubi] = {
          key: ubi,
          idauditoria: id,
          ubicacion: ubi,
          bodega: toStrUpper_(
            bodega ||
            expectedInfo.bodega ||
            _inferirBodegaPorUbicacion_(ubi)
          ),
          secuenciaubicacion: 0,
          abierta: false,
          cerrada: false,
          tieneActividad: false,
          tieneMarcador: false,
          marcadorIncompleto: false,
          totalFilas: 0,
          horainicioubicacion: "",
          horafinubicacion: "",
          esperados: toNum_(expectedInfo.total),
          escaneados: 0,
          correctos: 0,
          faltantes: 0,
          sobrantes: 0,
          pendientes: 0,
          avancePct: 0,
          avanceTrabajoPct: 0,
          minutosTranscurridos: 0,
          escaneosPorMinuto: 0,
          correctosPorMinuto: 0,
          minutosEstimadosRestantes: 0,
          tieneDiferencia: false,
          estadoOperativo: "SIN_INICIAR",
          estadoRitmo: "SIN_INICIAR"
        };
      }

      return map[ubi];
    }

    safeDetalle.forEach(function(row) {
      if (!row) {
        return;
      }

      const ubicacion = toStrUpper_(row.ubicacion);

      if (!ubicacion) {
        return;
      }

      const item = ensure(ubicacion, row.bodega);

      if (!item) {
        return;
      }

      item.secuenciaubicacion = Math.max(
        toNum_(item.secuenciaubicacion),
        toNum_(row.secuenciaubicacion)
      );

      if (!toStr_(row.idunico)) {
        item.tieneMarcador = true;

        if (row.horainicioubicacion) {
          item.abierta = true;
          item.horainicioubicacion = row.horainicioubicacion;

          if (row.horafinubicacion) {
            item.cerrada = true;
            item.horafinubicacion = row.horafinubicacion;
          }
        } else {
          item.marcadorIncompleto = true;
        }

        return;
      }

      item.tieneActividad = true;
      item.totalFilas += 1;

      if (row.escorrecto === true) {
        item.correctos += 1;
      }

      if (row.esfaltante === true) {
        item.faltantes += 1;
      }

      if (row.essobrante === true) {
        item.sobrantes += 1;
      }

      if (row.esfaltante !== true) {
        item.escaneados += 1;
      }
    });

    Object.keys(map).forEach(function(ubicacion) {
      const item = map[ubicacion];

      item.tieneDiferencia = item.faltantes > 0 || item.sobrantes > 0;

      if (item.tieneActividad && !item.abierta && !item.cerrada) {
        item.abierta = true;
        item.estadoOperativo = "ACTIVIDAD_SIN_MARCADOR";
      }

      if (item.cerrada) {
        const expectedClosed = item.correctos + item.faltantes;

        if (expectedClosed > 0) {
          item.esperados = expectedClosed;
        }

        item.pendientes = 0;
        item.avancePct = 100;
        item.avanceTrabajoPct = 100;
        item.estadoOperativo = item.tieneDiferencia
          ? "CERRADA_CON_DIFERENCIA"
          : "CERRADA_CORRECTA";
      } else if (item.abierta || item.tieneActividad) {
        item.pendientes = Math.max(item.esperados - item.correctos, 0);
        item.avancePct = _pct_(item.correctos, item.esperados);
        item.avanceTrabajoPct = _pct_(item.escaneados, item.esperados);

        if (item.estadoOperativo !== "ACTIVIDAD_SIN_MARCADOR") {
          item.estadoOperativo = "EN_PROCESO";
        }
      } else {
        item.pendientes = item.esperados;
        item.estadoOperativo = "SIN_INICIAR";
      }

      const endTime = item.cerrada
        ? item.horafinubicacion
        : _fmtTime_();

      item.minutosTranscurridos = item.horainicioubicacion
        ? _diffMinutes_(item.horainicioubicacion, endTime)
        : 0;

      item.escaneosPorMinuto = item.minutosTranscurridos > 0
        ? _round2_(item.escaneados / item.minutosTranscurridos)
        : 0;

      item.correctosPorMinuto = item.minutosTranscurridos > 0
        ? _round2_(item.correctos / item.minutosTranscurridos)
        : 0;

      item.minutosEstimadosRestantes = (
        item.abierta &&
        !item.cerrada &&
        item.correctosPorMinuto > 0
      )
        ? _round2_(item.pendientes / item.correctosPorMinuto)
        : 0;

      if (item.cerrada) {
        item.estadoRitmo = "FINALIZADO";
      } else if (item.tieneActividad && !item.horainicioubicacion) {
        item.estadoRitmo = "SIN_MARCADOR";
      } else if (!item.abierta) {
        item.estadoRitmo = "SIN_INICIAR";
      } else if (item.correctosPorMinuto === 0 && item.minutosTranscurridos >= 5) {
        item.estadoRitmo = "DETENIDO";
      } else if (item.correctosPorMinuto < 2 && item.minutosTranscurridos >= 3) {
        item.estadoRitmo = "CRITICO";
      } else if (item.correctosPorMinuto < 3 && item.minutosTranscurridos >= 3) {
        item.estadoRitmo = "LENTO";
      } else {
        item.estadoRitmo = "A_TIEMPO";
      }
    });

    return Object.values(map)
      .filter(function(item) {
        return (
          item.abierta ||
          item.cerrada ||
          item.tieneActividad ||
          item.totalFilas > 0
        );
      })
      .sort(function(a, b) {
        const sequence = toNum_(a.secuenciaubicacion) - toNum_(b.secuenciaubicacion);

        if (sequence !== 0) {
          return sequence;
        }

        return compareEs_(a.ubicacion, b.ubicacion);
      });
  }

  /**
   * Resume los indicadores del estado operativo en vivo.
   *
   * @param {*} lista Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @private
   */
  function _resumenOperativo_(lista) {
    const ubicaciones = Array.isArray(lista) ? lista : [];
    const abiertas = ubicaciones.filter(function(item) {
      return item.abierta && !item.cerrada;
    });
    const cerradas = ubicaciones.filter(function(item) {
      return item.cerrada;
    });

    function sum(key) {
      return ubicaciones.reduce(function(total, item) {
        return total + toNum_(item[key]);
      }, 0);
    }

    const esperados = sum("esperados");
    const correctos = sum("correctos");
    const escaneados = sum("escaneados");

    return {
      ubicacionesTocadas: ubicaciones.length,
      ubicacionesAbiertas: abiertas.length,
      ubicacionesCerradas: cerradas.length,
      esperadosVivos: esperados,
      correctosVivos: correctos,
      escaneadosVivos: escaneados,
      pendientesVivos: sum("pendientes"),
      sobrantesVivos: sum("sobrantes"),
      faltantesOficiales: sum("faltantes"),
      avanceVivoPct: _pct_(correctos, esperados),
      avanceTrabajoPct: _pct_(escaneados, esperados),
      ubicacionesLentas: ubicaciones.filter(function(item) {
        return item.estadoRitmo === "LENTO";
      }).length,
      ubicacionesCriticas: ubicaciones.filter(function(item) {
        return item.estadoRitmo === "CRITICO";
      }).length,
      ubicacionesDetenidas: ubicaciones.filter(function(item) {
        return item.estadoRitmo === "DETENIDO";
      }).length
    };
  }

  // =========================================================
  // DETALLE VIVO
  // =========================================================

  /**
   * Construye la carga completa autoritativa de una auditoría.
   *
   * @param {*} idauditoria Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerDetalleAuditoriaEnVivo(idauditoria) {
    const id = toStr_(idauditoria);

    if (!id) {
      throw new Error(
        "obtenerDetalleAuditoriaEnVivo() requiere idauditoria."
      );
    }

    const inicioMs = Date.now();

    /* Una lectura de cabecera y una lectura de detalle. */
    const audit = _getAuditoriaOrThrow_(id, true);
    const detalle = _leerDetalle_(id, true);

    /* Cálculos en memoria, sin volver a leer Sheets. */
    const resumen = _calcularMetricosDesdeDatos_(audit, detalle);
    const ubicacionesEnVivo = _buildUbicacionesEnVivo_(
      id,
      audit,
      detalle
    );

    /*
    * Sheets es la fuente autoritativa durante la carga completa.
    * Se eliminan del LiveCache las ubicaciones que ya no existen
    * en el detalle persistido.
    */
    if (
      typeof AuditoriaExcedentesLiveCache !==
        "undefined" &&
      AuditoriaExcedentesLiveCache &&
      typeof AuditoriaExcedentesLiveCache
        .reconciliarUbicaciones === "function"
    ) {
      try {
        const reconciliacion =
          AuditoriaExcedentesLiveCache
            .reconciliarUbicaciones(
              id,
              ubicacionesEnVivo.map(
                function (item) {
                  return item.ubicacion;
                }
              )
            );

        console.log(
          CFG.LIVE_LOG_PREFIX + " Reconciliación",
          JSON.stringify(reconciliacion)
        );
      } catch (errorCache) {
        console.warn(
          CFG.LIVE_LOG_PREFIX + " No se pudo reconciliar:",
          errorCache && errorCache.message
        );
      }
    }/*
    * Sheets es la fuente autoritativa durante la carga completa.
    * Se eliminan del LiveCache las ubicaciones que ya no existen
    * en el detalle persistido.
    */
    if (
      typeof AuditoriaExcedentesLiveCache !==
        "undefined" &&
      AuditoriaExcedentesLiveCache &&
      typeof AuditoriaExcedentesLiveCache
        .reconciliarUbicaciones === "function"
    ) {
      try {
        const reconciliacion =
          AuditoriaExcedentesLiveCache
            .reconciliarUbicaciones(
              id,
              ubicacionesEnVivo.map(
                function (item) {
                  return item.ubicacion;
                }
              )
            );

        console.log(
          CFG.LIVE_LOG_PREFIX + " Reconciliación",
          JSON.stringify(reconciliacion)
        );
      } catch (errorCache) {
        console.warn(
          CFG.LIVE_LOG_PREFIX + " No se pudo reconciliar:",
          errorCache && errorCache.message
        );
      }
    }

    const ubicaciones = _listarUbicacionesDesdeDetalle_(detalle);

    const diagnostico = {
      idauditoriaSolicitada: id,
      cabeceraEncontrada: !!audit,
      totalDetalle: detalle.length,
      totalMarcadores: detalle.filter(function (row) {
        return !toStr_(row.idunico);
      }).length,
      marcadoresConInicio: detalle.filter(function (row) {
        return !toStr_(row.idunico) && !!row.horainicioubicacion;
      }).length,
      marcadoresSinInicio: detalle.filter(function (row) {
        return !toStr_(row.idunico) && !row.horainicioubicacion;
      }).length,
      filasConId: detalle.filter(function (row) {
        return !!toStr_(row.idunico);
      }).length,
      ubicacionesEnVivo: ubicacionesEnVivo.length,
      ubicacionesListado: ubicaciones.length,
      duracionBackendMs: Date.now() - inicioMs
    };

    const response = {
      ok: true,
      source: "SHEETS_SINGLE_READ",
      idauditoria: id,
      auditoria: {
        ...audit,
        ...resumen
      },
      resumen: resumen,
      resumenOperativo: _resumenOperativo_(ubicacionesEnVivo),
      detalle: detalle,
      ubicaciones: ubicaciones,
      ubicacionesEnVivo: ubicacionesEnVivo,
      diagnostico: diagnostico,
      generadoEn: {
        fecha: _fmtDate_(),
        hora: _fmtTime_()
      }
    };

    return _normalizarRespuestaCliente_(response);
  }

  /**
   * Obtiene el pulso rápido desde LiveCache cuando existe.
   *
   * @param {*} idauditoria Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerPulsoAuditoriaEnVivo(idauditoria) {
    const id = toStr_(idauditoria);

    if (!id) {
      return {
        ok: false,
        source: "SIN_IDAUDITORIA",
        idauditoria: "",
        resumenOperativo: null,
        ubicacionesEnVivo: null
      };
    }

    if (typeof AuditoriaExcedentesLiveCache !== "undefined") {
      try {
        const live = AuditoriaExcedentesLiveCache.getPulso(id);

        if (
          live &&
          live.resumenOperativo &&
          toNum_(live.resumenOperativo.ubicacionesTocadas) > 0
        ) {
          return _normalizarRespuestaCliente_(live);
        }
      } catch (error) {
        console.warn(CFG.LIVE_LOG_PREFIX + " No se pudo leer:", error);
      }
    }

    return {
      ok: true,
      source: "NO_LIVE_CACHE",
      idauditoria: id,
      resumenOperativo: null,
      ubicacionesEnVivo: null,
      generadoEn: {
        fecha: _fmtDate_(),
        hora: _fmtTime_()
      }
    };
  }

  // =========================================================
  // API GENERAL
  // =========================================================

  /**
   * Obtiene catálogos y auditorías para la interfaz.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerBootstrap() {
    _assertDependencies_();
    const resumenEstado = EstadoActualExcedentesService.getResumen() || {};

    return {
      usuarios: (
        typeof UsuariosRepository !== "undefined" &&
        UsuariosRepository.getAll
      )
        ? UsuariosRepository.getAll()
        : [],
      bodegas: Array.isArray(resumenEstado.bodegasAuditables)
        ? resumenEstado.bodegasAuditables
        : [],
      auditoriasAbiertas: AuditoriaExcedentesRepository.getAbiertas(),
      auditoriasCerradas: AuditoriaExcedentesRepository.getCerradas()
    };
  }

  /**
   * Crea y persiste una nueva auditoría abierta.
   *
   * @param {*} payload Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function abrirAuditoria(payload) {
    payload = _payloadOrThrow_(payload, "abrirAuditoria()");

    const auditor = toStrUpper_(payload.auditor);
    const tipo = toStrUpper_(payload.tipoauditoria) || TIPOS_AUDITORIA.GLOBAL;
    const bodega = tipo === TIPOS_AUDITORIA.POR_BODEGA
      ? toStrUpper_(payload.bodegaobjetivo)
      : "TODAS";

    if (!auditor) {
      throw new Error("abrirAuditoria() requiere payload.auditor");
    }

    if (
      tipo !== TIPOS_AUDITORIA.GLOBAL &&
      tipo !== TIPOS_AUDITORIA.POR_BODEGA
    ) {
      throw new Error("TipoAuditoria invalido");
    }

    if (tipo === TIPOS_AUDITORIA.POR_BODEGA && !bodega) {
      throw new Error("Debes indicar bodegaobjetivo");
    }

    const idauditoria = _genIdAuditoria_();
    const universo = EstadoActualExcedentesService.getAuditables({
      tipoAuditoria: tipo,
      bodegaObjetivo: bodega
    }) || [];

    const audit = AuditoriaExcedentesRepository.insert({
      idauditoria: idauditoria,
      fecha: _fmtDate_(),
      horainicio: _fmtTime_(),
      horafin: "",
      duracionmin: 0,
      auditor: auditor,
      tipoauditoria: tipo,
      bodegaobjetivo: bodega,
      estatus: STATUS.ABIERTA,
      ubicacionesauditadas: 0,
      ubicacionescondiferencia: 0,
      idunicosesperadostotales: universo.length,
      idunicosescaneadostotales: 0,
      idunicoscorrectostotales: 0,
      idunicosfaltantestotales: 0,
      idunicossobrantestotales: 0,
      confiabilidadtotal: 0,
      observaciones: toStr_(payload.observaciones)
    });

    return {
      ok: true,
      mensaje: "Auditoria abierta correctamente",
      auditoria: audit,
      universoEsperadoInicial: {
        total: universo.length
      }
    };
  }

  /**
   * Filtra el historial de auditorías.
   *
   * @param {*} filtros Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function listarAuditorias(filtros) {
    filtros = filtros || {};

    return AuditoriaExcedentesRepository.getAll().filter(function(item) {
      return (
        (!filtros.estatus || toStrUpper_(item.estatus) === toStrUpper_(filtros.estatus)) &&
        (!filtros.auditor || toStrUpper_(item.auditor) === toStrUpper_(filtros.auditor)) &&
        (!filtros.tipoauditoria || toStrUpper_(item.tipoauditoria) === toStrUpper_(filtros.tipoauditoria)) &&
        (!filtros.bodegaobjetivo || toStrUpper_(item.bodegaobjetivo) === toStrUpper_(filtros.bodegaobjetivo))
      );
    });
  }

  /**
   * Obtiene una auditoría por identificador.
   *
   * @param {*} id Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerAuditoriaPorId(id) {
    return _getAuditoriaOrThrow_(id, true);
  }

  /**
   * Obtiene una auditoría con su resumen vigente.
   *
   * @param {*} id Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerAuditoriaActiva(id) {
    const audit = _getAuditoriaOrThrow_(id, true);
    const resumen = recalcularResumen(id, {
      persistir: false,
      usarFresh: true
    });

    return _normalizarRespuestaCliente_({
      auditoria: {
        ...audit,
        ...resumen
      },
      detalle: _leerDetalle_(id, true),
      resumen: resumen
    });
  }

  /**
   * Delega la apertura de una ubicación al servicio de detalle.
   *
   * @param {*} payload Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function abrirUbicacion(payload) {
    payload = _payloadOrThrow_(payload, "abrirUbicacion()");
    return AuditoriaExcedentesDetalleService.abrirUbicacion(payload);
  }

  /**
   * Delega un escaneo y recalcula el resumen maestro.
   *
   * @param {*} payload Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function registrarEscaneoIdUnico(payload) {
    payload = _payloadOrThrow_(payload, "registrarEscaneoIdUnico()");
    const result = AuditoriaExcedentesDetalleService.registrarEscaneoIdUnico(payload);

    if (result && result.ok && payload && payload.idauditoria) {
      result.resumenAuditoria = recalcularResumen(payload.idauditoria, {
        persistir: true,
        usarFresh: true
      });
    }

    return result;
  }

  /**
   * Delega el cierre de ubicación y recalcula el resumen.
   *
   * @param {*} payload Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function cerrarUbicacion(payload) {
    payload = _payloadOrThrow_(payload, "cerrarUbicacion()");
    const result = AuditoriaExcedentesDetalleService.cerrarUbicacion(payload);

    if (payload && payload.idauditoria) {
      result.resumenAuditoria = recalcularResumen(payload.idauditoria, {
        persistir: true,
        usarFresh: true
      });
    }

    return result;
  }

  /**
   * Obtiene y normaliza el detalle de una ubicación.
   *
   * @param {*} id Valor utilizado por la operación.
   * @param {*} ubicacion Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerDetalleUbicacion(id, ubicacion) {
    return _normalizarRespuestaCliente_(
      AuditoriaExcedentesDetalleService.getDetalleUbicacion(id, ubicacion)
    );
  }

  /**
   * Obtiene el detalle completo de una auditoría.
   *
   * @param {*} id Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerDetalleAuditoria(id) {
    const audit = _getAuditoriaOrThrow_(id, true);
    const resumen = recalcularResumen(id, {
      persistir: false,
      usarFresh: true
    });

    return _normalizarRespuestaCliente_({
      auditoria: {
        ...audit,
        ...resumen
      },
      resumen: resumen,
      detalle: _leerDetalle_(id, true),
      ubicaciones: AuditoriaExcedentesDetalleService.listarUbicacionesAuditadas(id)
    });
  }

  /**
   * Cierra ubicaciones pendientes y finaliza la auditoría.
   *
   * @param {*} payload Valor utilizado por la operación.
   * @return {*} Resultado de la operación.
   * @public
   */
  function cerrarAuditoria(payload) {
    payload = _payloadOrThrow_(payload, "cerrarAuditoria()");

    const id = toStr_(payload.idauditoria);
    const audit = _getAuditoriaOrThrow_(id, true);

    if (toStrUpper_(audit.estatus) !== STATUS.ABIERTA) {
      throw new Error("La auditoria " + id + " ya no esta ABIERTA");
    }

    const abiertas = AuditoriaExcedentesDetalleService.listarUbicacionesAbiertas(id);

    if (abiertas.length && payload.cerrarUbicacionesAbiertas === false) {
      throw new Error("Hay ubicaciones abiertas.");
    }

    abiertas.forEach(function(item) {
      AuditoriaExcedentesDetalleService.cerrarUbicacion({
        idauditoria: id,
        ubicacion: item.ubicacion
      });
    });

    const resumen = recalcularResumen(id, {
      persistir: false,
      usarFresh: true
    });

    const horafin = _fmtTime_();

    const updated = AuditoriaExcedentesRepository.updateByIdAuditoria(id, {
      horafin: horafin,
      duracionmin: minutesDiffFromStrings_(audit.fecha, audit.horainicio, horafin),
      estatus: STATUS.CERRADA,
      ubicacionesauditadas: resumen.ubicacionesauditadas,
      ubicacionescondiferencia: resumen.ubicacionescondiferencia,
      idunicosesperadostotales: resumen.idunicosesperadostotales,
      idunicosescaneadostotales: resumen.idunicosescaneadostotales,
      idunicoscorrectostotales: resumen.idunicoscorrectostotales,
      idunicosfaltantestotales: resumen.idunicosfaltantestotales,
      idunicossobrantestotales: resumen.idunicossobrantestotales,
      confiabilidadtotal: resumen.confiabilidadtotal,
      observaciones: toStr_(payload.observaciones) || audit.observaciones || ""
    });

    if (typeof AuditoriaExcedentesLiveCache !== "undefined") {
      try {
        AuditoriaExcedentesLiveCache.clear(id);
      } catch (error) {
        console.warn(CFG.LIVE_LOG_PREFIX + " No se pudo limpiar:", error);
      }
    }

    return _normalizarRespuestaCliente_({
      ok: true,
      mensaje: "Auditoria cerrada correctamente",
      auditoria: updated,
      resumen: resumen
    });
  }

  /**
   * Calcula indicadores globales para el tablero.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function obtenerDashboardMetricos() {
    const audits = AuditoriaExcedentesRepository.getAll();

    const abiertas = audits.filter(function(item) {
      return toStrUpper_(item.estatus) === STATUS.ABIERTA;
    });

    const cerradas = audits.filter(function(item) {
      return toStrUpper_(item.estatus) === STATUS.CERRADA;
    });

    function sum(arr, key) {
      return arr.reduce(function(total, item) {
        return total + toNum_(item[key]);
      }, 0);
    }

    const esperados = sum(cerradas, "idunicosesperadostotales");
    const correctos = sum(cerradas, "idunicoscorrectostotales");

    return {
      fechaCorte: {
        fecha: _fmtDate_(),
        hora: _fmtTime_()
      },
      resumenGlobal: {
        auditoriasAbiertas: abiertas.length,
        auditoriasCerradas: cerradas.length,
        ubicacionesAuditadas: sum(cerradas, "ubicacionesauditadas"),
        ubicacionesConDiferencia: sum(cerradas, "ubicacionescondiferencia"),
        esperados: esperados,
        correctos: correctos,
        faltantes: sum(cerradas, "idunicosfaltantestotales"),
        sobrantes: sum(cerradas, "idunicossobrantestotales"),
        confiabilidad: _pct_(correctos, esperados)
      },
      destacados: {},
      porBodega: []
    };
  }

  // =========================================================
  // API PUBLICA
  // =========================================================

  return Object.freeze({
    obtenerBootstrap,
    abrirAuditoria,
    listarAuditorias,
    obtenerAuditoriaPorId,
    obtenerAuditoriaActiva,
    obtenerDetalleAuditoriaEnVivo,
    obtenerPulsoAuditoriaEnVivo,
    recalcularResumen,
    cerrarAuditoria,
    abrirUbicacion,
    registrarEscaneoIdUnico,
    cerrarUbicacion,
    obtenerDetalleUbicacion,
    obtenerDetalleAuditoria,
    obtenerDashboardMetricos
  });
})();
