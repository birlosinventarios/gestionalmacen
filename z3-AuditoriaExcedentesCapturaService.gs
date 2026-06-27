/**
 * AuditoriaExcedentesCapturaService.gs
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

  function _normalizarTokenBodega_(value) {
    return _toUpper_(value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function _normalizarTokenUbicacion_(value) {
    return _toUpper_(value)
      .replace(/\s+/g, "")
      .trim();
  }

  function _extraerCampo_(row, posiblesCampos) {
    for (var i = 0; i < posiblesCampos.length; i++) {
      var key = posiblesCampos[i];
      if (row && row[key] != null && _toStr_(row[key])) {
        return row[key];
      }
    }
    return "";
  }

  function _inferirBodegaPorUbicacion_(ubicacion, fallback) {
    var u = _toUpper_(ubicacion);
    var fb = _toUpper_(fallback) || "PENDIENTE DE UBICACIÓN";

    if (!u) return fb;
    if (u.startsWith("B1")) return "BODEGA 1";
    if (u.startsWith("B2")) return "BODEGA 2";
    if (u.startsWith("B3")) return "BODEGA 3";
    if (u.startsWith("BM")) return "BODEGA MOSTRADOR";
    if (u.startsWith("CB1")) return "CASA BLANCA 1";
    if (u.startsWith("CB2")) return "CASA BLANCA 2";
    if (u.startsWith("CU")) return "CUARTO ALTO RIESGO";
    if (u.startsWith("MO")) return "MOSTRADOR";

    return fb;
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
    var id = _toUpper_(row.idunico || row.idUnico || row.IDUNICO || "");
    var ubi = _toUpper_(ubicacionOverride || row.ubicacionActual || row.ubicacion || "");

    return {
      idunico: id,
      codigo: _toUpper_(row.codigo || row.codigoproducto || row.sku || ""),
      descripcion: _toUpper_(row.descripcion || row.descripcionproducto || ""),
      bodega: _toUpper_(row.bodegaActual || row.bodega || ""),
      ubicacion: ubi,
      estado: "PENDIENTE",
      hora: "",
      observaciones: ""
    };
  }

  function _normalizarDetalleRowsRespuesta_(resp) {
    if (!resp) return [];

    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.detalle)) return resp.detalle;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.data)) return resp.data;

    return [];
  }

  // =========================================================
  // RESOLUCIÓN DE UBICACIÓN ESCANEADA
  // =========================================================
  function _buscarRegistroUbicacionPorIdentificador_(identificadorEscaneado) {
    var id = _toUpper_(identificadorEscaneado);

    if (typeof UbicacionesExcedentesRepository === "undefined" || !UbicacionesExcedentesRepository) {
      throw new Error("UbicacionesExcedentesRepository no está disponible");
    }

    var repo = UbicacionesExcedentesRepository;
    var row = null;

    if (!row && typeof repo.getById === "function") {
      row = repo.getById(id);
    }

    if (!row && typeof repo.getByIdentificador === "function") {
      row = repo.getByIdentificador(id);
    }

    if (!row && typeof repo.buscarPorId === "function") {
      row = repo.buscarPorId(id);
    }

    if (!row && typeof repo.buscarPorIdentificador === "function") {
      row = repo.buscarPorIdentificador(id);
    }

    if (!row && typeof repo.findById === "function") {
      row = repo.findById(id);
    }

    if (!row && typeof repo.findByIdentificador === "function") {
      row = repo.findByIdentificador(id);
    }

    if (!row) {
      var all = [];

      if (typeof repo.getAll === "function") {
        all = repo.getAll() || [];
      } else if (typeof repo.listar === "function") {
        all = repo.listar() || [];
      } else if (typeof repo.listarTodo === "function") {
        all = repo.listarTodo() || [];
      }

      if (Array.isArray(all) && all.length) {
        row = all.find(function (x) {
          var tokenId = _toUpper_(
            _extraerCampo_(x, [
              "id",
              "identificador",
              "idubicacionesexcedentes",
              "identificadorubicacion",
              "codigoqr",
              "codigo",
              "idubicacion",
              "qr"
            ])
          );

          return tokenId === id;
        }) || null;
      }
    }

    return row || null;
  }

  function _resolverUbicacionEscaneadaOrThrow_(identificadorEscaneado) {
    var id = _toUpper_(identificadorEscaneado);

    if (!id) {
      throw new Error("Debes escanear un identificador de ubicación válido");
    }

    var registro = _buscarRegistroUbicacionPorIdentificador_(id);

    if (!registro) {
      throw new Error(
        "El identificador de ubicación escaneado no existe en UbicacionesExcedentesRepository: " + id
      );
    }

    var ubicacion = _toUpper_(
      _extraerCampo_(registro, [
        "ubicacion",
        "ubicacioncanon",
        "ubicacionactual",
        "ubicacionfisica"
      ])
    );

    var bodega = _toUpper_(
      _extraerCampo_(registro, [
        "bodega",
        "bodegaobjetivo",
        "bodegaactual"
      ])
    );

    if (!ubicacion) {
      throw new Error(
        "El identificador " + id + " sí existe, pero el registro no contiene una columna ubicacion válida"
      );
    }

    return {
      identificadorEscaneado: id,
      ubicacion: ubicacion,
      bodega: bodega || _inferirBodegaPorUbicacion_(ubicacion, ""),
      raw: registro
    };
  }

  // =========================================================
  // UNIVERSO ESPERADO POR UBICACIÓN
  // =========================================================
  function _getUniversoEsperadoUbicacion_(auditoria, ubicacion) {
    var universo = _getUniversoEsperadoAuditoria_(auditoria);
    var ubi = _normalizarTokenUbicacion_(ubicacion);

    return universo
      .filter(function (item) {
        var ubiRow = _normalizarTokenUbicacion_(item.ubicacionActual || item.ubicacion || "");
        return ubiRow === ubi;
      })
      .map(function (item) {
        return _buildExpectedItem_(item, _toUpper_(ubicacion));
      })
      .filter(function (item) {
        return !!_toStr_(item.idunico);
      });
  }

  // =========================================================
  // UBICACIONES ABIERTAS / DETALLE
  // =========================================================
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

  // =========================================================
  // ESTADO VIVO DE UBICACIÓN
  // =========================================================
  function _buildEstadoUbicacion_(idauditoria, ubicacion) {
    var audit = _getAuditoriaOrThrow_(idauditoria);
    var ubi = _toUpper_(ubicacion);

    var expectedRows = _getUniversoEsperadoUbicacion_(audit, ubi);
    var detailRows = _getDetalleUbicacionRows_(idauditoria, ubi);
    var expectedMap = {};
    var resolved = [];

    expectedRows.forEach(function (item) {
      var id = _toUpper_(item.idunico || item.idUnico || "");
      if (!id) return;

      expectedMap[id] = {
        idunico: id,
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
      var id = _toUpper_(row.idunico || row.idUnico || "");
      if (!id) return; // ignora marcador de apertura/cierre

      var hora = _toStr_(row.hora || row.horaescaneoidunico || row.horaregistro || row.horaescaneo || row.horainicio || "");
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

  // =========================================================
  // DUPLICADOS
  // =========================================================
  function _buscarDuplicadoEnAuditoria_(idauditoria, idunico) {
    var rows = AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria) || [];
    var targetId = _toUpper_(idunico);

    var matches = rows.filter(function (row) {
      return _toUpper_(row.idunico || row.idUnico || "") === targetId && row.esfaltante !== true;
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

  // =========================================================
  // DELTAS UI
  // =========================================================
  function _buildLocationResumenDeltaByTipo_(tipoResultado) {
    var tipo = _toUpper_(tipoResultado);

    if (tipo === "CORRECTO") {
      return {
        escaneados: 1,
        correctos: 1,
        faltantes: 0,
        sobrantes: 0
      };
    }

    if (tipo === "SOBRANTE") {
      return {
        escaneados: 1,
        correctos: 0,
        faltantes: 0,
        sobrantes: 1
      };
    }

    return {
      escaneados: 0,
      correctos: 0,
      faltantes: 0,
      sobrantes: 0
    };
  }

  function _buildAuditResumenDeltaByTipo_(tipoResultado) {
    var tipo = _toUpper_(tipoResultado);

    if (tipo === "CORRECTO") {
      return {
        idunicosescaneadostotales: 1,
        idunicoscorrectostotales: 1,
        idunicosfaltantestotales: 0,
        idunicossobrantestotales: 0
      };
    }

    if (tipo === "SOBRANTE") {
      return {
        idunicosescaneadostotales: 1,
        idunicoscorrectostotales: 0,
        idunicosfaltantestotales: 0,
        idunicossobrantestotales: 1
      };
    }

    return {
      idunicosescaneadostotales: 0,
      idunicoscorrectostotales: 0,
      idunicosfaltantestotales: 0,
      idunicossobrantestotales: 0
    };
  }

  function _buildUiRowFromPersistencia_(tipoResultado, persistencia, payloadBase) {
    var tipo = _toUpper_(tipoResultado);
    var reg = persistencia && persistencia.registro ? persistencia.registro : {};
    var detalle = persistencia && persistencia.detalle ? persistencia.detalle : {};
    var actual = persistencia && persistencia.actual ? persistencia.actual : {};

    var hora = _toStr_(reg.horaescaneoidunico || _fmtTime_());

    var observaciones = "";
    if (tipo === "SOBRANTE") {
      observaciones =
        _toStr_(detalle.observacion) ||
        _toStr_(reg.observaciones) ||
        (
          _toUpper_(actual.ubicacionActual)
            ? ("ESPERADO EN " + _toUpper_(actual.ubicacionActual))
            : "DETECTADO FUERA DE UBICACIÓN"
        );
    } else {
      observaciones = _toStr_(reg.observaciones || "");
    }

    return {
      idunico: _toUpper_(payloadBase.idunico || reg.idunico || detalle.idunico || ""),
      codigo: _toUpper_(reg.codigo || actual.codigo || ""),
      descripcion: _toUpper_(reg.descripcion || actual.descripcion || ""),
      estado: tipo === "CORRECTO" ? "CORRECTO" : (tipo === "SOBRANTE" ? "SOBRANTE" : "PENDIENTE"),
      hora: hora,
      observaciones: observaciones
    };
  }

  function _buildUiDeltaFromResultado_(tipoResultado, persistencia, payloadBase) {
    var tipo = _toUpper_(tipoResultado);

    var row =
      (tipo === "CORRECTO" || tipo === "SOBRANTE")
        ? _buildUiRowFromPersistencia_(tipo, persistencia, payloadBase)
        : null;

    return {
      highlightId: _toUpper_(payloadBase.idunico || ""),
      location: {
        operacion:
          tipo === "CORRECTO"
            ? "UPDATE_ROW"
            : tipo === "SOBRANTE"
            ? "UPSERT_ROW"
            : "NOOP",
        rowKey: _toUpper_(payloadBase.idunico || ""),
        row: row
      },
      locationResumenDelta: _buildLocationResumenDeltaByTipo_(tipo),
      auditResumenDelta: _buildAuditResumenDeltaByTipo_(tipo)
    };
  }

  function _applyAuditDeltaToHeader_(audit, auditDelta) {
    var actualesEscaneados = _toNum_(audit.idunicosescaneadostotales);
    var actualesCorrectos = _toNum_(audit.idunicoscorrectostotales);
    var actualesFaltantes = _toNum_(audit.idunicosfaltantestotales);
    var actualesSobrantes = _toNum_(audit.idunicossobrantestotales);
    var esperados = _toNum_(audit.idunicosesperadostotales);

    var nextEscaneados = actualesEscaneados + _toNum_(auditDelta.idunicosescaneadostotales);
    var nextCorrectos = actualesCorrectos + _toNum_(auditDelta.idunicoscorrectostotales);
    var nextFaltantes = actualesFaltantes + _toNum_(auditDelta.idunicosfaltantestotales);
    var nextSobrantes = actualesSobrantes + _toNum_(auditDelta.idunicossobrantestotales);

    var confiabilidad = esperados > 0
      ? _round2_((nextCorrectos / esperados) * 100)
      : 0;

    var updated = AuditoriaExcedentesRepository.updateByIdAuditoria(audit.idauditoria, {
      idunicosescaneadostotales: nextEscaneados,
      idunicoscorrectostotales: nextCorrectos,
      idunicosfaltantestotales: nextFaltantes,
      idunicossobrantestotales: nextSobrantes,
      confiabilidadtotal: confiabilidad
    });

    return {
      idunicosescaneadostotales: _toNum_(updated.idunicosescaneadostotales),
      idunicoscorrectostotales: _toNum_(updated.idunicoscorrectostotales),
      idunicosfaltantestotales: _toNum_(updated.idunicosfaltantestotales),
      idunicossobrantestotales: _toNum_(updated.idunicossobrantestotales),
      confiabilidadtotal: _toNum_(updated.confiabilidadtotal)
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
    var identificadorEscaneado = _toUpper_(payload && (payload.identificadorUbicacion || payload.ubicacion));

    if (!idauditoria) {
      throw new Error("abrirUbicacionPorEscaneo() requiere idauditoria");
    }

    if (!identificadorEscaneado) {
      throw new Error("Debes escanear un identificador de ubicación válido");
    }

    var audit = _getAuditoriaOrThrow_(idauditoria);
    _assertAuditoriaAbierta_(audit);

    var ubicacionResuelta = _resolverUbicacionEscaneadaOrThrow_(identificadorEscaneado);

    if (_toUpper_(audit.tipoauditoria) === TIPOS_AUDITORIA.POR_BODEGA) {
      var bodegaAudit = _normalizarTokenBodega_(audit.bodegaobjetivo);
      var bodegaUbic = _normalizarTokenBodega_(ubicacionResuelta.bodega || _inferirBodegaPorUbicacion_(ubicacionResuelta.ubicacion));

      if (bodegaAudit && bodegaUbic && bodegaAudit !== bodegaUbic) {
        throw new Error(
          "La ubicación escaneada pertenece a " +
          bodegaUbic +
          " y no corresponde a la auditoría de " +
          audit.bodegaobjetivo
        );
      }
    }

    AuditoriaExcedentesDetalleService.abrirUbicacion({
      idauditoria: idauditoria,
      ubicacion: ubicacionResuelta.ubicacion,
      observaciones: "ID_UBICACION_ESCANEADO:" + ubicacionResuelta.identificadorEscaneado
    });

    var estado = _buildEstadoUbicacion_(idauditoria, ubicacionResuelta.ubicacion);

    return {
      ok: true,
      mensaje: estado.resumen.esperados > 0
        ? "Ubicación abierta correctamente"
        : "Ubicación abierta. No tiene esperados en el estado actual.",
      idauditoria: idauditoria,
      identificadorEscaneado: ubicacionResuelta.identificadorEscaneado,
      ubicacion: ubicacionResuelta.ubicacion,
      bodega: ubicacionResuelta.bodega,
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
   * Registra escaneo de IdUnico con validación de duplicado
   * y responde con contrato delta para la UI.
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

    // =====================================================
    // 1) DUPLICADOS
    // =====================================================
    var dupe = _buscarDuplicadoEnAuditoria_(idauditoria, idunico);
    if (dupe) {
      var tipoDupe = _toUpper_(dupe.ubicacion) === ubicacion
        ? "DUPLICADO_EN_UBICACION"
        : "DUPLICADO_EN_AUDITORIA";

      return {
        ok: true,
        tipoResultado: tipoDupe,
        mensaje: tipoDupe === "DUPLICADO_EN_UBICACION"
          ? "El IdUnico ya fue escaneado previamente en esta ubicación."
          : "El IdUnico ya fue escaneado previamente en otra ubicación de la misma auditoría.",
        detalle: {
          idunico: idunico,
          ubicacion: ubicacion,
          ubicacionSistema: _toUpper_(dupe.ubicacion || ""),
          observacion: tipoDupe === "DUPLICADO_EN_AUDITORIA"
            ? ("YA ESCANEADO EN " + _toUpper_(dupe.ubicacion || ""))
            : "YA ESCANEADO EN ESTA UBICACIÓN"
        },
        uiDelta: {
          highlightId: idunico,
          location: {
            operacion: "NOOP",
            rowKey: idunico,
            row: null
          },
          locationResumenDelta: {
            escaneados: 0,
            correctos: 0,
            faltantes: 0,
            sobrantes: 0
          },
          auditResumenDelta: {
            idunicosescaneadostotales: 0,
            idunicoscorrectostotales: 0,
            idunicosfaltantestotales: 0,
            idunicossobrantestotales: 0
          }
        },
        auditSnapshot: {
          idunicosescaneadostotales: _toNum_(audit.idunicosescaneadostotales),
          idunicoscorrectostotales: _toNum_(audit.idunicoscorrectostotales),
          idunicosfaltantestotales: _toNum_(audit.idunicosfaltantestotales),
          idunicossobrantestotales: _toNum_(audit.idunicossobrantestotales),
          confiabilidadtotal: _toNum_(audit.confiabilidadtotal)
        },
        persistencia: null
      };
    }

    // =====================================================
    // 2) PERSISTENCIA EN DETALLE
    // =====================================================
    var resultPersistencia = AuditoriaExcedentesDetalleService.registrarEscaneoIdUnico({
      idauditoria: idauditoria,
      ubicacion: ubicacion,
      idunico: idunico
    });

    var tipoResultado = _toUpper_(
      resultPersistencia && (resultPersistencia.tipoResultado || resultPersistencia.clasificacion || "")
    ) || "DESCONOCIDO";

    var mensaje =
      _toStr_(resultPersistencia && resultPersistencia.mensaje) ||
      (tipoResultado === "CORRECTO"
        ? "Escaneo correcto."
        : tipoResultado === "SOBRANTE"
        ? "El IdUnico no pertenece a la ubicación auditada."
        : "Escaneo procesado.");

    var detalle = {
      idunico: idunico,
      ubicacion: ubicacion,
      ubicacionSistema: _toUpper_(
        resultPersistencia &&
        resultPersistencia.detalle &&
        (resultPersistencia.detalle.ubicacionSistema || "")
      ),
      observacion: _toStr_(
        resultPersistencia &&
        resultPersistencia.detalle &&
        (resultPersistencia.detalle.observacion || "")
      )
    };

    // =====================================================
    // 3) DELTA PARA UI
    // =====================================================
    var uiDelta = _buildUiDeltaFromResultado_(tipoResultado, resultPersistencia, {
      idunico: idunico,
      ubicacion: ubicacion
    });

    // =====================================================
    // 4) ACTUALIZACIÓN INCREMENTAL DE CABECERA
    // =====================================================
    var auditSnapshot = _applyAuditDeltaToHeader_(audit, uiDelta.auditResumenDelta);

    return {
      ok: true,
      tipoResultado: tipoResultado,
      mensaje: mensaje,
      detalle: detalle,
      uiDelta: uiDelta,
      auditSnapshot: auditSnapshot,
      persistencia: resultPersistencia && resultPersistencia.registro
        ? {
            rowNumber: resultPersistencia.registro._rowNumber || null,
            idauditoria: idauditoria,
            ubicacion: ubicacion
          }
        : null
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
    identificadorUbicacion: "B1B101"
  });
}

function debugAuditoriaExcedentesCapturaService_obtenerEstadoUbicacion() {
  return AuditoriaExcedentesCapturaService.obtenerEstadoUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-01"
  });
}

function debugAuditoriaExcedentesCapturaService_registrarEscaneoIdUnico() {
  return AuditoriaExcedentesCapturaService.registrarEscaneoIdUnico({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-01",
    idunico: "20260514154729157481"
  });
}

function debugAuditoriaExcedentesCapturaService_cerrarUbicacion() {
  return AuditoriaExcedentesCapturaService.cerrarUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-01"
  });
}

function debugAuditoriaExcedentesCapturaService_cerrarAuditoria() {
  return AuditoriaExcedentesCapturaService.cerrarAuditoria({
    idauditoria: "AUD-PRUEBA-001",
    observaciones: "CIERRE DESDE CAPTURA",
    cerrarUbicacionesAbiertas: true
  });
}
