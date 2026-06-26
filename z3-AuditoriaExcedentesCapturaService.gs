/**
 * AuditoriaExcedentesCapturaService.gs
 * ------------------------------------------------------------
 * Servicio operativo de captura para auditoría de excedentes.
 *
 * RESPONSABILIDAD:
 * - seleccionar auditoría abierta
 * - abrir ubicación por escaneo
 * - traer universo esperado de una ubicación
 * - registrar escaneo de IdUnico
 * - detectar duplicados
 * - calcular estado vivo de la ubicación
 * - cerrar ubicación
 * - cerrar auditoría desde captura
 *
 * REUTILIZA:
 * - AuditoriaExcedentesService
 * - AuditoriaExcedentesDetalleService
 * - AuditoriaExcedentesRepository
 * - AuditoriaExcedentesDetalleRepository
 * - EstadoActualExcedentesService
 */

const AuditoriaExcedentesCapturaService = (() => {
  const STATUS = Object.freeze({
    ABIERTA: "ABIERTA",
    CERRADA: "CERRADA"
  });

  const TIPOS_AUDITORIA = Object.freeze({
    GLOBAL: "GLOBAL",
    POR_BODEGA: "POR_BODEGA"
  });

  // =========================================================
  // HELPERS BASE
  // =========================================================
  function _toStr_(value) {
    return String(value == null ? "" : value).trim();
  }

  function _toUpper_(value) {
    return _toStr_(value).toUpperCase();
  }

  function _toNum_(value) {
    if (value === "" || value == null) return 0;
    const n = Number(value);
    return isNaN(n) ? 0 : n;
  }

  function _round2_(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function _tz_() {
    return Session.getScriptTimeZone() || "America/Mexico_City";
  }

  function _now_() {
    return new Date();
  }

  function _fmtDate_(d) {
    return Utilities.formatDate(d || _now_(), _tz_(), "dd/MM/yyyy");
  }

  function _fmtTime_(d) {
    return Utilities.formatDate(d || _now_(), _tz_(), "HH:mm:ss");
  }

  function _uniqueBy_(arr, mapper) {
    var seen = {};
    var out = [];

    (arr || []).forEach(function (item) {
      var key = mapper(item);
      if (seen[key]) return;
      seen[key] = true;
      out.push(item);
    });

    return out;
  }

  function _getAuditoriaOrThrow_(idauditoria) {
    var audit = AuditoriaExcedentesRepository.getByIdAuditoria(_toStr_(idauditoria));
    if (!audit) {
      throw new Error("No existe la auditoría " + idauditoria);
    }
    return audit;
  }

  function _assertAuditoriaAbierta_(audit) {
    if (_toUpper_(audit.estatus) !== STATUS.ABIERTA) {
      throw new Error("La auditoría " + audit.idauditoria + " no está ABIERTA");
    }
  }

  function _buildConfigEstadoActual_(auditoria) {
    var tipo = _toUpper_(auditoria.tipoauditoria);
    var bodegaObjetivo = _toUpper_(auditoria.bodegaobjetivo);

    if (tipo === TIPOS_AUDITORIA.POR_BODEGA) {
      return {
        tipoAuditoria: TIPOS_AUDITORIA.POR_BODEGA,
        bodegaObjetivo: bodegaObjetivo
      };
    }

    return {
      tipoAuditoria: TIPOS_AUDITORIA.GLOBAL,
      bodegaObjetivo: "TODAS"
    };
  }

  function _getUniversoEsperadoAuditoria_(auditoria) {
    return EstadoActualExcedentesService.getAuditables(
      _buildConfigEstadoActual_(auditoria)
    ) || [];
  }

  function _buildExpectedItem_(row, ubicacionOverride) {
    return {
      idunico: _toUpper_(row.idunico),
      codigo: _toUpper_(row.codigo || row.codigoproducto || row.sku || ""),
      descripcion: _toUpper_(row.descripcion || row.descripcionproducto || ""),
      bodega: _toUpper_(row.bodegaActual || row.bodega || ""),
      ubicacion: _toUpper_(ubicacionOverride || row.ubicacionActual || row.ubicacion || ""),
      estado: "PENDIENTE",
      hora: "",
      observaciones: ""
    };
  }

  function _normalizarDetalleRowsRespuesta_(resp) {
    if (!resp) return [];

    if (Array.isArray(resp)) {
      return resp;
    }

    if (Array.isArray(resp.detalle)) {
      return resp.detalle;
    }

    if (Array.isArray(resp.rows)) {
      return resp.rows;
    }

    return [];
  }

  function _getUniversoEsperadoUbicacion_(auditoria, ubicacion) {
    var universo = _getUniversoEsperadoAuditoria_(auditoria);
    var ubi = _toUpper_(ubicacion);

    return universo
      .filter(function (item) {
        return _toUpper_(item.ubicacionActual || item.ubicacion) === ubi;
      })
      .map(function (item) {
        return _buildExpectedItem_(item, ubi);
      });
  }

  function _getUbicacionesAbiertas_(idauditoria) {
    if (
      typeof AuditoriaExcedentesDetalleService !== "undefined" &&
      AuditoriaExcedentesDetalleService.listarUbicacionesAbiertas
    ) {
      return AuditoriaExcedentesDetalleService.listarUbicacionesAbiertas(idauditoria) || [];
    }
    return [];
  }

  function _isUbicacionAbierta_(idauditoria, ubicacion) {
    var abiertas = _getUbicacionesAbiertas_(idauditoria);
    var ubi = _toUpper_(ubicacion);

    return abiertas.some(function (x) {
      return _toUpper_(x.ubicacion) === ubi;
    });
  }

  function _getDetalleUbicacionRows_(idauditoria, ubicacion) {
    if (
      typeof AuditoriaExcedentesDetalleService !== "undefined" &&
      AuditoriaExcedentesDetalleService.getDetalleUbicacion
    ) {
      var resp = AuditoriaExcedentesDetalleService.getDetalleUbicacion(idauditoria, ubicacion);
      return _normalizarDetalleRowsRespuesta_(resp);
    }

    return [];
  }

  function _buildEstadoUbicacion_(idauditoria, ubicacion) {
    var audit = _getAuditoriaOrThrow_(idauditoria);
    var ubi = _toUpper_(ubicacion);

    var expectedRows = _getUniversoEsperadoUbicacion_(audit, ubi);
    var detailRows = _getDetalleUbicacionRows_(idauditoria, ubi);
    var expectedMap = {};
    var resolved = [];

    expectedRows.forEach(function (item) {
      expectedMap[_toUpper_(item.idunico)] = {
        idunico: item.idunico,
        codigo: item.codigo,
        descripcion: item.descripcion,
        bodega: item.bodega,
        ubicacion: item.ubicacion,
        estado: "PENDIENTE",
        hora: "",
        observaciones: ""
      };
    });

    detailRows.forEach(function (row) {
      var id = _toUpper_(row.idunico);
      if (!id) return;

      var hora = _toStr_(row.hora || row.horaregistro || row.horaescaneo || row.horainicio || "");
      var observaciones = _toStr_(row.observaciones || row.nota || row.mensaje || "");

      if (expectedMap[id]) {
        if (row.esfaltante === true) {
          expectedMap[id].estado = "FALTANTE";
          expectedMap[id].hora = hora;
          expectedMap[id].observaciones = observaciones || "No fue escaneado al cierre";
        } else if (row.escorrecto === true) {
          expectedMap[id].estado = "CORRECTO";
          expectedMap[id].hora = hora;
          expectedMap[id].observaciones = observaciones;
        } else {
          expectedMap[id].estado = "PENDIENTE";
        }
      } else {
        resolved.push({
          idunico: id,
          codigo: _toUpper_(row.codigo || row.codigoproducto || row.sku || ""),
          descripcion: _toUpper_(row.descripcion || row.descripcionproducto || ""),
          bodega: _toUpper_(row.bodega || ""),
          ubicacion: ubi,
          estado: row.essobrante === true ? "SOBRANTE" : "PENDIENTE",
          hora: hora,
          observaciones: observaciones || (row.essobrante === true ? "Detectado fuera de ubicación" : "")
        });
      }
    });

    Object.keys(expectedMap).forEach(function (key) {
      resolved.push(expectedMap[key]);
    });

    resolved.sort(function (a, b) {
      return _toStr_(a.idunico).localeCompare(_toStr_(b.idunico), "es", {
        sensitivity: "base",
        numeric: true
      });
    });

    var resumen = {
      esperados: expectedRows.length,
      escaneados: resolved.filter(function (x) {
        return x.estado === "CORRECTO" || x.estado === "SOBRANTE";
      }).length,
      correctos: resolved.filter(function (x) { return x.estado === "CORRECTO"; }).length,
      faltantes: resolved.filter(function (x) { return x.estado === "FALTANTE"; }).length,
      sobrantes: resolved.filter(function (x) { return x.estado === "SOBRANTE"; }).length
    };

    return {
      idauditoria: _toStr_(idauditoria),
      ubicacion: ubi,
      abierta: _isUbicacionAbierta_(idauditoria, ubi),
      detalle: resolved,
      resumen: resumen
    };
  }

  function _buscarDuplicadoEnAuditoria_(idauditoria, idunico) {
    var rows = AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria) || [];
    var targetId = _toUpper_(idunico);

    var matches = rows.filter(function (row) {
      return _toUpper_(row.idunico) === targetId && row.esfaltante !== true;
    });

    if (!matches.length) return null;

    var first = matches[0];
    return {
      idunico: targetId,
      ubicacion: _toUpper_(first.ubicacion),
      bodega: _toUpper_(first.bodega),
      totalCoincidencias: matches.length
    };
  }

  function _determinarTipoResultadoTrasEscaneo_(idauditoria, ubicacion, idunico) {
    var estado = _buildEstadoUbicacion_(idauditoria, ubicacion);
    var id = _toUpper_(idunico);

    var row = (estado.detalle || []).find(function (x) {
      return _toUpper_(x.idunico) === id;
    });

    if (!row) {
      return {
        tipoResultado: "DESCONOCIDO",
        mensaje: "El escaneo fue registrado pero no se pudo determinar su estado.",
        detalle: null,
        resumenUbicacion: estado.resumen
      };
    }

    if (row.estado === "CORRECTO") {
      return {
        tipoResultado: "CORRECTO",
        mensaje: "Escaneo correcto.",
        detalle: row,
        resumenUbicacion: estado.resumen
      };
    }

    if (row.estado === "SOBRANTE") {
      return {
        tipoResultado: "SOBRANTE",
        mensaje: "El IdUnico no pertenece a la ubicación auditada.",
        detalle: row,
        resumenUbicacion: estado.resumen
      };
    }

    return {
      tipoResultado: "DESCONOCIDO",
      mensaje: "No se pudo clasificar el escaneo.",
      detalle: row,
      resumenUbicacion: estado.resumen
    };
  }

  // =========================================================
  // API PÚBLICA
  // =========================================================

  /**
   * Bootstrap específico de captura
   */
  function obtenerBootstrapCaptura() {
    var boot = AuditoriaExcedentesService.obtenerBootstrap();
    var abiertas = AuditoriaExcedentesRepository.getAbiertas
      ? AuditoriaExcedentesRepository.getAbiertas()
      : [];

    return {
      usuarios: boot.usuarios || [],
      bodegas: boot.bodegas || [],
      auditoriasAbiertas: abiertas
    };
  }

  /**
   * Atajo para obtener auditorías abiertas
   */
  function obtenerAuditoriasAbiertas() {
    return AuditoriaExcedentesRepository.getAbiertas
      ? AuditoriaExcedentesRepository.getAbiertas()
      : [];
  }

  /**
   * Abre una ubicación por escaneo y devuelve el estado operativo inicial.
   * payload:
   * {
   *   idauditoria,
   *   identificadorUbicacion
   * }
   */
  function abrirUbicacionPorEscaneo(payload) {
    var idauditoria = _toStr_(payload && payload.idauditoria);
    var identificadorUbicacion = _toUpper_(payload && (payload.identificadorUbicacion || payload.ubicacion));

    if (!idauditoria) {
      throw new Error("abrirUbicacionPorEscaneo() requiere idauditoria");
    }

    if (!identificadorUbicacion) {
      throw new Error("Debes escanear un identificador de ubicación válido");
    }

    var audit = _getAuditoriaOrThrow_(idauditoria);
    _assertAuditoriaAbierta_(audit);

    AuditoriaExcedentesDetalleService.abrirUbicacion({
      idauditoria: idauditoria,
      ubicacion: identificadorUbicacion
    });

    var estado = _buildEstadoUbicacion_(idauditoria, identificadorUbicacion);

    return {
      ok: true,
      mensaje: estado.resumen.esperados > 0
        ? "Ubicación abierta correctamente"
        : "Ubicación abierta. No tiene esperados en el estado actual.",
      idauditoria: idauditoria,
      ubicacion: identificadorUbicacion,
      detalle: estado.detalle,
      resumen: estado.resumen,
      abierta: estado.abierta
    };
  }

  /**
   * Devuelve el estado vivo de una ubicación:
   * - esperados
   * - correctos
   * - faltantes
   * - sobrantes
   * - pendiente
   */
  function obtenerEstadoUbicacion(payload) {
    var idauditoria = _toStr_(payload && payload.idauditoria);
    var ubicacion = _toUpper_(payload && payload.ubicacion);

    if (!idauditoria) {
      throw new Error("obtenerEstadoUbicacion() requiere idauditoria");
    }

    if (!ubicacion) {
      throw new Error("obtenerEstadoUbicacion() requiere ubicacion");
    }

    return _buildEstadoUbicacion_(idauditoria, ubicacion);
  }

  /**
   * Registra escaneo de IdUnico con validación de duplicado.
   * payload:
   * {
   *   idauditoria,
   *   ubicacion,
   *   idunico
   * }
   */
  function registrarEscaneoIdUnico(payload) {
    var idauditoria = _toStr_(payload && payload.idauditoria);
    var ubicacion = _toUpper_(payload && payload.ubicacion);
    var idunico = _toUpper_(payload && payload.idunico);

    if (!idauditoria) {
      throw new Error("registrarEscaneoIdUnico() requiere idauditoria");
    }

    if (!ubicacion) {
      throw new Error("registrarEscaneoIdUnico() requiere ubicacion");
    }

    if (!idunico) {
      throw new Error("registrarEscaneoIdUnico() requiere idunico");
    }

    var audit = _getAuditoriaOrThrow_(idauditoria);
    _assertAuditoriaAbierta_(audit);

    if (!_isUbicacionAbierta_(idauditoria, ubicacion)) {
      throw new Error("Debes abrir primero la ubicación antes de escanear IdUnicos");
    }

    var dupe = _buscarDuplicadoEnAuditoria_(idauditoria, idunico);
    if (dupe) {
      return {
        ok: true,
        tipoResultado: _toUpper_(dupe.ubicacion) === ubicacion
          ? "DUPLICADO_EN_UBICACION"
          : "DUPLICADO_EN_AUDITORIA",
        mensaje: _toUpper_(dupe.ubicacion) === ubicacion
          ? "El IdUnico ya fue escaneado previamente en esta ubicación."
          : "El IdUnico ya fue escaneado previamente en otra ubicación de la misma auditoría.",
        detalle: dupe,
        resumenUbicacion: _buildEstadoUbicacion_(idauditoria, ubicacion).resumen
      };
    }

    // Delegamos al detalle service para que persista con su lógica actual
    var resultPersistencia = AuditoriaExcedentesDetalleService.registrarEscaneoIdUnico({
      idauditoria: idauditoria,
      ubicacion: ubicacion,
      idunico: idunico
    });

    // Recalcular resumen general de auditoría
    AuditoriaExcedentesService.recalcularResumen(idauditoria, { persistir: true });

    var clasificado = _determinarTipoResultadoTrasEscaneo_(idauditoria, ubicacion, idunico);

    return {
      ok: true,
      tipoResultado: clasificado.tipoResultado,
      mensaje: clasificado.mensaje,
      detalle: clasificado.detalle,
      persistencia: resultPersistencia || null,
      resumenUbicacion: clasificado.resumenUbicacion
    };
  }

  /**
   * Cierra una ubicación y devuelve el estado final resultante.
   */
  function cerrarUbicacion(payload) {
    var idauditoria = _toStr_(payload && payload.idauditoria);
    var ubicacion = _toUpper_(payload && payload.ubicacion);

    if (!idauditoria) {
      throw new Error("cerrarUbicacion() requiere idauditoria");
    }

    if (!ubicacion) {
      throw new Error("cerrarUbicacion() requiere ubicacion");
    }

    AuditoriaExcedentesDetalleService.cerrarUbicacion({
      idauditoria: idauditoria,
      ubicacion: ubicacion,
      observaciones: _toStr_(payload && payload.observaciones)
    });

    AuditoriaExcedentesService.recalcularResumen(idauditoria, { persistir: true });

    var estado = _buildEstadoUbicacion_(idauditoria, ubicacion);

    return {
      ok: true,
      mensaje: "Ubicación cerrada correctamente",
      idauditoria: idauditoria,
      ubicacion: ubicacion,
      detalle: estado.detalle,
      resumen: estado.resumen,
      abierta: false
    };
  }

  /**
   * Cierra auditoría desde captura
   */
  function cerrarAuditoria(payload) {
    return AuditoriaExcedentesService.cerrarAuditoria(payload || {});
  }

  return {
    obtenerBootstrapCaptura,
    obtenerAuditoriasAbiertas,
    abrirUbicacionPorEscaneo,
    obtenerEstadoUbicacion,
    registrarEscaneoIdUnico,
    cerrarUbicacion,
    cerrarAuditoria
  };
})();

/**
 * =========================================================
 * DEBUGGERS
 * =========================================================
 */

function debugAuditoriaExcedentesCapturaService_obtenerBootstrapCaptura() {
  return AuditoriaExcedentesCapturaService.obtenerBootstrapCaptura();
}

function debugAuditoriaExcedentesCapturaService_obtenerAuditoriasAbiertas() {
  return AuditoriaExcedentesCapturaService.obtenerAuditoriasAbiertas();
}

function debugAuditoriaExcedentesCapturaService_abrirUbicacionPorEscaneo() {
  return AuditoriaExcedentesCapturaService.abrirUbicacionPorEscaneo({
    idauditoria: "AUD-PRUEBA-001",
    identificadorUbicacion: "B1-19"
  });
}

function debugAuditoriaExcedentesCapturaService_obtenerEstadoUbicacion() {
  return AuditoriaExcedentesCapturaService.obtenerEstadoUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19"
  });
}

function debugAuditoriaExcedentesCapturaService_registrarEscaneoIdUnico() {
  return AuditoriaExcedentesCapturaService.registrarEscaneoIdUnico({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19",
    idunico: "202605141622201581"
  });
}

function debugAuditoriaExcedentesCapturaService_cerrarUbicacion() {
  return AuditoriaExcedentesCapturaService.cerrarUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19"
  });
}

function debugAuditoriaExcedentesCapturaService_cerrarAuditoria() {
  return AuditoriaExcedentesCapturaService.cerrarAuditoria({
    idauditoria: "AUD-PRUEBA-001",
    observaciones: "CIERRE DESDE CAPTURA",
    cerrarUbicacionesAbiertas: true
  });
}