/**
 * AuditoriaExcedentesService.gs
 * Version completa corregida.
 *
 * Correcciones incluidas:
 * 1. obtenerDetalleAuditoriaEnVivo() esta declarado y exportado.
 * 2. La respuesta antes de llegar al navegador se normaliza a valores serializables.
 * 3. _timeToSeconds_ acepta Date y texto HH:mm:ss.
 * 4. Las ubicaciones con filas de IdUnico aparecen aunque el marcador historico este incompleto.
 * 5. Las ubicaciones tocadas se calculan con marcadores o actividad real.
 */
const AuditoriaExcedentesService = (() => {
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

  function _tz_() {
    return Session.getScriptTimeZone() || "America/Mexico_City";
  }

  function _now_() {
    return new Date();
  }

  function _fmtDate_(date) {
    return Utilities.formatDate(date || _now_(), _tz_(), "dd/MM/yyyy");
  }

  function _fmtTime_(date) {
    return Utilities.formatDate(date || _now_(), _tz_(), "HH:mm:ss");
  }

  function _round2_(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function _pct_(numerator, denominator) {
    return toNum_(denominator) > 0
      ? _round2_((toNum_(numerator) / toNum_(denominator)) * 100)
      : 0;
  }

  function _genIdAuditoria_() {
    return "AUD-" + Utilities.formatDate(_now_(), _tz_(), "yyyyMMdd-HHmmss");
  }

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

  function _getAuditoriaOrThrow_(idauditoria, fresh) {
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

  function _buildConfigEstadoActual_(audit) {
    if (toStrUpper_(audit.tipoauditoria) === TIPOS_AUDITORIA.POR_BODEGA) {
      return {
        tipoAuditoria: TIPOS_AUDITORIA.POR_BODEGA,
        bodegaObjetivo: toStrUpper_(audit.bodegaobjetivo)
      };
    }

    return {
      tipoAuditoria: TIPOS_AUDITORIA.GLOBAL,
      bodegaObjetivo: "TODAS"
    };
  }

  function _getUniversoEsperado_(audit) {
    return EstadoActualExcedentesService.getAuditables(
      _buildConfigEstadoActual_(audit)
    ) || [];
  }

  function _inferirBodegaPorUbicacion_(ubicacion) {
    return inferWarehouseByLocation_(
      toStrUpper_(ubicacion),
      "PENDIENTE DE UBICACION"
    );
  }

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

    if (value < 90) {
      return {
        valor: value,
        nivel: "RED",
        color: "red",
        label: "CRITICA"
      };
    }

    if (value >= 97) {
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

  function _leerDetalle_(id, fresh) {
    return fresh !== false && AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh
      ? AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh(id) || []
      : AuditoriaExcedentesDetalleRepository.getByIdAuditoria(id) || [];
  }

  /**
   * Convierte Date, NaN e Infinity antes de enviar la respuesta al navegador.
   * google.script.run debe recibir un objeto plano y serializable.
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
          "[AED FULL] Reconciliación LiveCache",
          JSON.stringify(reconciliacion)
        );
      } catch (errorCache) {
        console.warn(
          "[AED FULL] No se pudo reconciliar LiveCache:",
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
          "[AED FULL] Reconciliación LiveCache",
          JSON.stringify(reconciliacion)
        );
      } catch (errorCache) {
        console.warn(
          "[AED FULL] No se pudo reconciliar LiveCache:",
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
        console.warn("[LIVE] No se pudo leer LiveCache:", error);
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

  function obtenerBootstrap() {
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

  function abrirAuditoria(payload) {
    payload = payload || {};

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

  function obtenerAuditoriaPorId(id) {
    return _getAuditoriaOrThrow_(id, true);
  }

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

  function abrirUbicacion(payload) {
    return AuditoriaExcedentesDetalleService.abrirUbicacion(payload);
  }

  function registrarEscaneoIdUnico(payload) {
    const result = AuditoriaExcedentesDetalleService.registrarEscaneoIdUnico(payload || {});

    if (result && result.ok && payload && payload.idauditoria) {
      result.resumenAuditoria = recalcularResumen(payload.idauditoria, {
        persistir: true,
        usarFresh: true
      });
    }

    return result;
  }

  function cerrarUbicacion(payload) {
    const result = AuditoriaExcedentesDetalleService.cerrarUbicacion(payload || {});

    if (payload && payload.idauditoria) {
      result.resumenAuditoria = recalcularResumen(payload.idauditoria, {
        persistir: true,
        usarFresh: true
      });
    }

    return result;
  }

  function obtenerDetalleUbicacion(id, ubicacion) {
    return _normalizarRespuestaCliente_(
      AuditoriaExcedentesDetalleService.getDetalleUbicacion(id, ubicacion)
    );
  }

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

  function cerrarAuditoria(payload) {
    payload = payload || {};

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
        console.warn("[LIVE] No se pudo limpiar LiveCache:", error);
      }
    }

    return _normalizarRespuestaCliente_({
      ok: true,
      mensaje: "Auditoria cerrada correctamente",
      auditoria: updated,
      resumen: resumen
    });
  }

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

  return {
    obtenerBootstrap: obtenerBootstrap,
    abrirAuditoria: abrirAuditoria,
    listarAuditorias: listarAuditorias,
    obtenerAuditoriaPorId: obtenerAuditoriaPorId,
    obtenerAuditoriaActiva: obtenerAuditoriaActiva,
    obtenerDetalleAuditoriaEnVivo: obtenerDetalleAuditoriaEnVivo,
    obtenerPulsoAuditoriaEnVivo: obtenerPulsoAuditoriaEnVivo,
    recalcularResumen: recalcularResumen,
    cerrarAuditoria: cerrarAuditoria,
    abrirUbicacion: abrirUbicacion,
    registrarEscaneoIdUnico: registrarEscaneoIdUnico,
    cerrarUbicacion: cerrarUbicacion,
    obtenerDetalleUbicacion: obtenerDetalleUbicacion,
    obtenerDetalleAuditoria: obtenerDetalleAuditoria,
    obtenerDashboardMetricos: obtenerDashboardMetricos
  };
})();
