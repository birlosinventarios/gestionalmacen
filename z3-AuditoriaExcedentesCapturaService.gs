
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

  const TIPO_RESULTADO = Object.freeze({
    CORRECTO: "CORRECTO",
    SOBRANTE: "SOBRANTE"
  });

  // =========================================================
  // HELPERS DE DOMINIO
  // =========================================================

  function _getAuditoriaOrThrow_(idauditoria) {
    const id = toStr_(idauditoria);

    if (!id) {
      throw new Error("Se requiere IdAuditoria.");
    }

    const audit = AuditoriaExcedentesRepository.getByIdAuditoria(id);

    if (!audit) {
      throw new Error("No existe la auditoría " + id);
    }

    return audit;
  }

  function _assertAuditoriaAbierta_(audit) {
    if (!audit) {
      throw new Error("No se recibió una auditoría válida.");
    }

    if (toStrUpper_(audit.estatus) !== STATUS.ABIERTA) {
      throw new Error("La auditoría " + audit.idauditoria + " no está ABIERTA.");
    }
  }

  function _buildConfigEstadoActual_(auditoria) {
    const tipo = toStrUpper_(auditoria.tipoauditoria);
    const bodegaObjetivo = toStrUpper_(auditoria.bodegaobjetivo);

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

  /**
   * ÚNICO punto donde se consulta EstadoActualExcedentesService.
   * Se debe ejecutar al cargar la auditoría, no por cada escaneo.
   */
  function _getUniversoEsperadoAuditoria_(auditoria) {
    return EstadoActualExcedentesService.getAuditables(
      _buildConfigEstadoActual_(auditoria)
    ) || [];
  }

  function _assertUbicacionEnAlcance_(auditoria, ubicacion, bodega) {
    const tipo = toStrUpper_(auditoria.tipoauditoria);

    if (tipo === TIPOS_AUDITORIA.GLOBAL) {
      return true;
    }

    const bodegaAudit = normalizeWarehouseToken_(auditoria.bodegaobjetivo);
    const bodegaUbicacion = normalizeWarehouseToken_(
      bodega || inferWarehouseByLocation_(ubicacion, "")
    );

    if (
      tipo === TIPOS_AUDITORIA.POR_BODEGA &&
      bodegaAudit &&
      bodegaUbicacion &&
      bodegaAudit !== bodegaUbicacion
    ) {
      throw new Error(
        "La ubicación escaneada pertenece a " +
        bodegaUbicacion +
        " y no corresponde a la auditoría de " +
        auditoria.bodegaobjetivo +
        "."
      );
    }

    return true;
  }

  // =========================================================
  // UBICACIONES / QR / IDENTIFICADOR
  // =========================================================

  function _buscarRegistroUbicacionPorIdentificador_(identificadorEscaneado) {
    const id = toStrUpper_(identificadorEscaneado);

    if (!id) {
      return null;
    }

    if (typeof UbicacionesExcedentesRepository === "undefined" || !UbicacionesExcedentesRepository) {
      throw new Error("UbicacionesExcedentesRepository no está disponible.");
    }

    const repo = UbicacionesExcedentesRepository;
    let row = null;

    if (!row && typeof repo.getById === "function") {
      row = repo.getById(id);
    }

    if (!row && typeof repo.getByIdentificador === "function") {
      row = repo.getByIdentificador(id);
    }

    if (!row && typeof repo.getOnePorUbicacion === "function") {
      row = repo.getOnePorUbicacion(id);
    }

    if (!row && typeof repo.getPorUbicacion === "function") {
      const rows = repo.getPorUbicacion(id) || [];
      row = Array.isArray(rows) && rows.length ? rows[0] : null;
    }

    if (!row && typeof repo.getAll === "function") {
      const all = repo.getAll() || [];
      const idToken = normalizeLocationToken_(id);

      row = all.find(function (item) {
        const tokenId = toStrUpper_(
          pickFirstField_(item, [
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

        const tokenUbicacion = toStrUpper_(
          pickFirstField_(item, [
            "ubicacion",
            "ubicacioncanon",
            "ubicacionactual",
            "ubicacionfisica"
          ])
        );

        return (
          tokenId === id ||
          tokenUbicacion === id ||
          normalizeLocationToken_(tokenId) === idToken ||
          normalizeLocationToken_(tokenUbicacion) === idToken
        );
      }) || null;
    }

    return row || null;
  }

  function _resolverUbicacionEscaneadaOrThrow_(identificadorEscaneado) {
    const id = toStrUpper_(identificadorEscaneado);

    if (!id) {
      throw new Error("Debes escanear un identificador de ubicación válido.");
    }

    const registro = _buscarRegistroUbicacionPorIdentificador_(id);

    if (!registro) {
      throw new Error("El identificador de ubicación escaneado no existe: " + id);
    }

    const ubicacion = toStrUpper_(
      pickFirstField_(registro, [
        "ubicacion",
        "ubicacioncanon",
        "ubicacionactual",
        "ubicacionfisica"
      ])
    );

    const bodega = toStrUpper_(
      pickFirstField_(registro, [
        "bodega",
        "bodegaobjetivo",
        "bodegaactual"
      ])
    );

    if (!ubicacion) {
      throw new Error(
        "El identificador " +
        id +
        " existe, pero no contiene una ubicación válida."
      );
    }

    return {
      identificadorEscaneado: id,
      ubicacion: ubicacion,
      bodega: bodega || inferWarehouseByLocation_(ubicacion, ""),
      raw: registro
    };
  }

  // =========================================================
  // DETALLES / MARCADORES
  // =========================================================

  function _getDetallesAuditoria_(idauditoria) {
    return AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria) || [];
  }

  function _getDetallesUbicacion_(idauditoria, ubicacion) {
    return AuditoriaExcedentesDetalleRepository.getByAuditoriaYUbicacion(
      idauditoria,
      ubicacion
    ) || [];
  }

  function _getMarcadorUbicacion_(idauditoria, ubicacion) {
    const rows = _getDetallesUbicacion_(idauditoria, ubicacion);

    return rows.find(function (item) {
      return !item.idunico && item.horainicioubicacion;
    }) || null;
  }

  function _getMarcadorAbiertoUbicacion_(idauditoria, ubicacion) {
    const rows = _getDetallesUbicacion_(idauditoria, ubicacion);

    return rows.find(function (item) {
      return !item.idunico &&
        item.horainicioubicacion &&
        !item.horafinubicacion;
    }) || null;
  }

  function _getSecuenciaSiguiente_(idauditoria) {
    const detalles = _getDetallesAuditoria_(idauditoria);

    return detalles.reduce(function (acc, item) {
      return Math.max(acc, toNum_(item.secuenciaubicacion));
    }, 0) + 1;
  }

  function _buildResumenUbicacionPersistida_(idauditoria, ubicacion) {
    const rows = _getDetallesUbicacion_(idauditoria, ubicacion);

    const escaneados = rows.filter(function (item) {
      return item.idunico && item.esfaltante !== true;
    });

    return {
      idauditoria: toStr_(idauditoria),
      ubicacion: toStrUpper_(ubicacion),
      escaneados: escaneados.length,
      correctos: rows.filter(function (item) {
        return item.escorrecto === true;
      }).length,
      faltantes: rows.filter(function (item) {
        return item.esfaltante === true;
      }).length,
      sobrantes: rows.filter(function (item) {
        return item.essobrante === true;
      }).length,
      abierta: !!_getMarcadorAbiertoUbicacion_(idauditoria, ubicacion),
      cerrada: !!rows.find(function (item) {
        return !item.idunico &&
          item.horainicioubicacion &&
          item.horafinubicacion;
      }),
      totalRegistros: rows.length
    };
  }

  // =========================================================
  // BOOTSTRAP
  // =========================================================

  function obtenerBootstrapCaptura() {
    const usuarios = typeof UsuariosRepository !== "undefined" && UsuariosRepository.getAll
      ? UsuariosRepository.getAll()
      : [];

    const auditoriasAbiertas = AuditoriaExcedentesRepository.getAbiertas
      ? AuditoriaExcedentesRepository.getAbiertas()
      : [];

    let bodegas = [];

    try {
      bodegas = typeof UbicacionesExcedentesRepository !== "undefined" &&
        UbicacionesExcedentesRepository.getBodegas
        ? UbicacionesExcedentesRepository.getBodegas()
        : [];
    } catch (error) {
      console.warn("[AuditoriaExcedentesCapturaService] No se pudieron cargar bodegas:", error);
      bodegas = [];
    }

    return {
      usuarios: usuarios,
      bodegas: bodegas,
      auditoriasAbiertas: auditoriasAbiertas
    };
  }

  function obtenerAuditoriasAbiertas() {
    return AuditoriaExcedentesRepository.getAbiertas
      ? AuditoriaExcedentesRepository.getAbiertas()
      : [];
  }

  // =========================================================
  // PAQUETE COMPLETO DE CAPTURA
  // =========================================================

  function obtenerPaqueteCaptura(idauditoria) {
    const id = toStr_(idauditoria);

    if (!id) {
      throw new Error("obtenerPaqueteCaptura() requiere idauditoria.");
    }

    const audit = _getAuditoriaOrThrow_(id);
    _assertAuditoriaAbierta_(audit);

    const universo = _getUniversoEsperadoAuditoria_(audit);
    const detallePrevio = _getDetallesAuditoria_(id);

    const esperadosPorUbicacion = {};
    const esperadoIndex = {};
    const ubicacionesMap = {};
    const escaneadosPrevios = {};

    universo.forEach(function (row) {
      const idunico = toStrUpper_(row.idUnico || row.idunico || "");
      const ubicacion = toStrUpper_(row.ubicacionActual || row.ubicacion || "");
      const bodega = toStrUpper_(
        row.bodegaActual ||
        row.bodega ||
        inferWarehouseByLocation_(ubicacion, "")
      );

      if (!idunico || !ubicacion) return;

      const item = {
        idunico: idunico,
        codigo: toStrUpper_(row.codigo || row.codigoproducto || row.sku || ""),
        descripcion: toStrUpper_(row.descripcion || row.descripcionproducto || ""),
        cantidad: toNum_(row.saldoActual || row.cantidad || row.balance || 0),
        ubicacionActual: ubicacion,
        bodegaActual: bodega
      };

      if (!esperadosPorUbicacion[ubicacion]) {
        esperadosPorUbicacion[ubicacion] = [];
      }

      esperadosPorUbicacion[ubicacion].push(item);
      esperadoIndex[idunico] = item;

      if (!ubicacionesMap[ubicacion]) {
        ubicacionesMap[ubicacion] = {
          ubicacion: ubicacion,
          bodega: bodega,
          totalEsperados: 0,
          abierta: false,
          cerrada: false
        };
      }

      ubicacionesMap[ubicacion].totalEsperados++;
    });

    detallePrevio.forEach(function (row) {
      const ubicacion = toStrUpper_(row.ubicacion || "");

      if (ubicacion && !ubicacionesMap[ubicacion]) {
        ubicacionesMap[ubicacion] = {
          ubicacion: ubicacion,
          bodega: toStrUpper_(row.bodega || inferWarehouseByLocation_(ubicacion, "")),
          totalEsperados: 0,
          abierta: false,
          cerrada: false
        };
      }

      if (ubicacion && !row.idunico && row.horainicioubicacion && !row.horafinubicacion) {
        ubicacionesMap[ubicacion].abierta = true;
      }

      if (ubicacion && !row.idunico && row.horainicioubicacion && row.horafinubicacion) {
        ubicacionesMap[ubicacion].cerrada = true;
      }

      const idu = toStrUpper_(row.idunico || "");

      if (!idu) return;
      if (row.esfaltante === true) return;

      escaneadosPrevios[idu] = {
        idunico: idu,
        ubicacion: toStrUpper_(row.ubicacion || ""),
        bodega: toStrUpper_(row.bodega || ""),
        codigo: toStrUpper_(row.codigo || ""),
        descripcion: toStrUpper_(row.descripcion || ""),
        estado: row.escorrecto === true
          ? "CORRECTO"
          : row.essobrante === true
          ? "SOBRANTE"
          : "ESCANEADO",
        hora: toStr_(row.horaescaneoidunico || ""),
        observaciones: toStr_(row.observaciones || "")
      };
    });

    Object.keys(esperadosPorUbicacion).forEach(function (ubicacion) {
      esperadosPorUbicacion[ubicacion].sort(function (a, b) {
        return compareEs_(a.idunico, b.idunico);
      });
    });

    const ubicaciones = Object.values(ubicacionesMap).sort(function (a, b) {
      return compareEs_(a.ubicacion, b.ubicacion);
    });

    const resumen = {
      esperados: universo.length,
      escaneados: Object.keys(escaneadosPrevios).length,
      correctos: detallePrevio.filter(function (x) {
        return x.escorrecto === true;
      }).length,
      faltantes: detallePrevio.filter(function (x) {
        return x.esfaltante === true;
      }).length,
      sobrantes: detallePrevio.filter(function (x) {
        return x.essobrante === true;
      }).length
    };

    return {
      ok: true,
      auditoria: audit,
      ubicaciones: ubicaciones,
      esperadosPorUbicacion: esperadosPorUbicacion,
      esperadoIndex: esperadoIndex,
      escaneadosPrevios: escaneadosPrevios,
      resumen: resumen,
      generadoEn: {
        fecha: fmtDateNow_(),
        hora: fmtTimeNow_()
      }
    };
  }

  // =========================================================
  // ABRIR UBICACIÓN
  // =========================================================

  function abrirUbicacionPorEscaneo(payload) {
    const idauditoria = toStr_(payload && payload.idauditoria);
    const identificadorEscaneado = toStrUpper_(
      payload && (payload.identificadorUbicacion || payload.ubicacion)
    );

    if (!idauditoria) {
      throw new Error("abrirUbicacionPorEscaneo() requiere idauditoria.");
    }

    if (!identificadorEscaneado) {
      throw new Error("Debes escanear un identificador de ubicación válido.");
    }

    const audit = _getAuditoriaOrThrow_(idauditoria);
    _assertAuditoriaAbierta_(audit);

    const ubicacionResuelta = _resolverUbicacionEscaneadaOrThrow_(identificadorEscaneado);

    _assertUbicacionEnAlcance_(
      audit,
      ubicacionResuelta.ubicacion,
      ubicacionResuelta.bodega
    );

    let marker = _getMarcadorUbicacion_(idauditoria, ubicacionResuelta.ubicacion);

    if (marker && marker.horafinubicacion) {
      throw new Error("La ubicación " + ubicacionResuelta.ubicacion + " ya fue cerrada.");
    }

    if (!marker) {
      marker = AuditoriaExcedentesDetalleRepository.insert({
        idauditoria: idauditoria,
        secuenciaubicacion: _getSecuenciaSiguiente_(idauditoria),
        bodega: ubicacionResuelta.bodega,
        ubicacion: ubicacionResuelta.ubicacion,
        horainicioubicacion: fmtTimeNow_(),
        horafinubicacion: "",
        idunico: "",
        codigo: "",
        descripcion: "",
        horaescaneoidunico: "",
        escorrecto: false,
        esfaltante: false,
        essobrante: false,
        observaciones: "ID_UBICACION_ESCANEADO:" + ubicacionResuelta.identificadorEscaneado
      });
    }

    return {
      ok: true,
      mensaje: "Ubicación abierta correctamente.",
      idauditoria: idauditoria,
      identificadorEscaneado: ubicacionResuelta.identificadorEscaneado,
      ubicacion: ubicacionResuelta.ubicacion,
      bodega: ubicacionResuelta.bodega,
      marcador: marker,
      resumenPersistido: _buildResumenUbicacionPersistida_(
        idauditoria,
        ubicacionResuelta.ubicacion
      )
    };
  }

  // =========================================================
  // ESTADO PERSISTIDO DE UBICACIÓN
  // =========================================================

  function obtenerEstadoUbicacion(payload) {
    const idauditoria = toStr_(payload && payload.idauditoria);
    const ubicacion = toStrUpper_(payload && payload.ubicacion);

    if (!idauditoria) {
      throw new Error("obtenerEstadoUbicacion() requiere idauditoria.");
    }

    if (!ubicacion) {
      throw new Error("obtenerEstadoUbicacion() requiere ubicacion.");
    }

    return {
      ok: true,
      idauditoria: idauditoria,
      ubicacion: ubicacion,
      detalle: _getDetallesUbicacion_(idauditoria, ubicacion),
      resumen: _buildResumenUbicacionPersistida_(idauditoria, ubicacion),
      abierta: !!_getMarcadorAbiertoUbicacion_(idauditoria, ubicacion)
    };
  }

  // =========================================================
  // RECÁLCULO DE CABECERA DESDE DETALLE
  // =========================================================

  function _recalcularCabeceraDesdeDetalle_(idauditoria) {
    const audit = _getAuditoriaOrThrow_(idauditoria);
    const detalle = _getDetallesAuditoria_(idauditoria);

    const escaneados = detalle.filter(function (x) {
      return x.idunico && x.esfaltante !== true;
    }).length;

    const correctos = detalle.filter(function (x) {
      return x.idunico && x.escorrecto === true;
    }).length;

    const faltantes = detalle.filter(function (x) {
      return x.esfaltante === true;
    }).length;

    const sobrantes = detalle.filter(function (x) {
      return x.essobrante === true;
    }).length;

    const ubicacionesAuditadasSet = {};
    const ubicacionesConDiferenciaSet = {};

    detalle.forEach(function (x) {
      const ubi = toStrUpper_(x.ubicacion || "");
      if (!ubi) return;

      if (!x.idunico && x.horainicioubicacion && x.horafinubicacion) {
        ubicacionesAuditadasSet[ubi] = true;
      }

      if (x.esfaltante === true || x.essobrante === true) {
        ubicacionesConDiferenciaSet[ubi] = true;
      }
    });

    const esperadosTotales = toNum_(audit.idunicosesperadostotales);

    const confiabilidad = esperadosTotales > 0
      ? round2_((correctos / esperadosTotales) * 100)
      : 0;

    const updated = AuditoriaExcedentesRepository.updateByIdAuditoria(idauditoria, {
      ubicacionesauditadas: Object.keys(ubicacionesAuditadasSet).length,
      ubicacionescondiferencia: Object.keys(ubicacionesConDiferenciaSet).length,
      idunicosescaneadostotales: escaneados,
      idunicoscorrectostotales: correctos,
      idunicosfaltantestotales: faltantes,
      idunicossobrantestotales: sobrantes,
      confiabilidadtotal: confiabilidad
    });

    return {
      idauditoria: idauditoria,
      ubicacionesauditadas: toNum_(updated.ubicacionesauditadas),
      ubicacionescondiferencia: toNum_(updated.ubicacionescondiferencia),
      idunicosesperadostotales: toNum_(updated.idunicosesperadostotales),
      idunicosescaneadostotales: toNum_(updated.idunicosescaneadostotales),
      idunicoscorrectostotales: toNum_(updated.idunicoscorrectostotales),
      idunicosfaltantestotales: toNum_(updated.idunicosfaltantestotales),
      idunicossobrantestotales: toNum_(updated.idunicossobrantestotales),
      confiabilidadtotal: toNum_(updated.confiabilidadtotal)
    };
  }

  // =========================================================
  // REGISTRO POR LOTE
  // =========================================================

  function registrarEscaneosLote(payload) {
    const idauditoria = toStr_(payload && payload.idauditoria);
    const ubicacion = toStrUpper_(payload && payload.ubicacion);
    const escaneos = Array.isArray(payload && payload.escaneos)
      ? payload.escaneos
      : [];

    if (!idauditoria) {
      throw new Error("registrarEscaneosLote() requiere idauditoria.");
    }

    if (!ubicacion) {
      throw new Error("registrarEscaneosLote() requiere ubicacion.");
    }

    if (!escaneos.length) {
      return {
        ok: true,
        insertados: 0,
        omitidos: 0,
        detalleOmitidos: [],
        mensaje: "No había escaneos pendientes para sincronizar."
      };
    }

    const audit = _getAuditoriaOrThrow_(idauditoria);
    _assertAuditoriaAbierta_(audit);

    const marker = _getMarcadorAbiertoUbicacion_(idauditoria, ubicacion);

    if (!marker) {
      throw new Error("La ubicación " + ubicacion + " no está abierta.");
    }

    const detalleActual = _getDetallesAuditoria_(idauditoria);
    const yaRegistrados = {};

    detalleActual.forEach(function (row) {
      const idu = toStrUpper_(row.idunico || "");
      if (!idu) return;
      if (row.esfaltante === true) return;

      yaRegistrados[idu] = true;
    });

    const rowsInsertar = [];
    const omitidos = [];

    escaneos.forEach(function (item) {
      const idunico = toStrUpper_(item.idunico || item.idUnico || "");
      const tipo = toStrUpper_(item.tipoResultado || item.estado || "");
      const codigo = toStrUpper_(item.codigo || "");
      const descripcion = toStrUpper_(item.descripcion || "");
      const observaciones = toStr_(item.observaciones || item.mensaje || "");

      if (!idunico) {
        omitidos.push({
          motivo: "SIN_IDUNICO",
          item: item
        });
        return;
      }

      if (yaRegistrados[idunico]) {
        omitidos.push({
          idunico: idunico,
          motivo: "DUPLICADO_SERVIDOR"
        });
        return;
      }

      const esCorrecto = tipo === TIPO_RESULTADO.CORRECTO;
      const esSobrante = tipo === TIPO_RESULTADO.SOBRANTE;

      if (!esCorrecto && !esSobrante) {
        omitidos.push({
          idunico: idunico,
          motivo: "TIPO_NO_PERSISTIBLE",
          tipo: tipo
        });
        return;
      }

      rowsInsertar.push({
        idauditoria: idauditoria,
        secuenciaubicacion: marker.secuenciaubicacion,
        bodega: toStrUpper_(
          item.bodega ||
          marker.bodega ||
          inferWarehouseByLocation_(ubicacion, "")
        ),
        ubicacion: ubicacion,
        horainicioubicacion: "",
        horafinubicacion: "",
        idunico: idunico,
        codigo: codigo,
        descripcion: descripcion,
        horaescaneoidunico: toStr_(item.hora || item.horaLocal || fmtTimeNow_()),
        escorrecto: esCorrecto,
        esfaltante: false,
        essobrante: esSobrante,
        observaciones: observaciones
      });

      yaRegistrados[idunico] = true;
    });

    if (rowsInsertar.length > 0) {
      AuditoriaExcedentesDetalleRepository.insertMany(rowsInsertar);
    }

    const auditSnapshot = _recalcularCabeceraDesdeDetalle_(idauditoria);

    return {
      ok: true,
      insertados: rowsInsertar.length,
      omitidos: omitidos.length,
      detalleOmitidos: omitidos,
      auditSnapshot: auditSnapshot,
      mensaje: "Escaneos sincronizados correctamente."
    };
  }

  /**
   * Compatibilidad con llamadas antiguas.
   *
   * IMPORTANTE:
   * Este método ya NO calcula si el IdUnico es correcto o sobrante.
   * El frontend debe enviar tipoResultado.
   */
  function registrarEscaneoIdUnico(payload) {
    const item = payload || {};

    if (!item.tipoResultado) {
      throw new Error(
        "registrarEscaneoIdUnico() requiere tipoResultado en la nueva lógica de captura."
      );
    }

    return registrarEscaneosLote({
      idauditoria: item.idauditoria,
      ubicacion: item.ubicacion,
      escaneos: [
        {
          idunico: item.idunico,
          tipoResultado: item.tipoResultado,
          codigo: item.codigo,
          descripcion: item.descripcion,
          bodega: item.bodega,
          horaLocal: item.horaLocal,
          observaciones: item.observaciones
        }
      ]
    });
  }

  // =========================================================
  // CIERRE DE UBICACIÓN
  // =========================================================

  function cerrarUbicacion(payload) {
    const idauditoria = toStr_(payload && payload.idauditoria);
    const ubicacion = toStrUpper_(payload && payload.ubicacion);
    const faltantes = Array.isArray(payload && payload.faltantes)
      ? payload.faltantes
      : [];
    const observaciones = toStr_(payload && payload.observaciones);

    if (!idauditoria) {
      throw new Error("cerrarUbicacion() requiere idauditoria.");
    }

    if (!ubicacion) {
      throw new Error("cerrarUbicacion() requiere ubicacion.");
    }

    const audit = _getAuditoriaOrThrow_(idauditoria);
    _assertAuditoriaAbierta_(audit);

    const marker = _getMarcadorAbiertoUbicacion_(idauditoria, ubicacion);

    if (!marker) {
      throw new Error("La ubicación " + ubicacion + " no está abierta o ya fue cerrada.");
    }

    const detalleActual = _getDetallesUbicacion_(idauditoria, ubicacion);
    const yaRegistrados = {};

    detalleActual.forEach(function (row) {
      const idu = toStrUpper_(row.idunico || "");
      if (!idu) return;

      yaRegistrados[idu] = true;
    });

    const faltantesInsertar = [];

    faltantes.forEach(function (item) {
      const idunico = toStrUpper_(item.idunico || item.idUnico || "");

      if (!idunico) return;
      if (yaRegistrados[idunico]) return;

      faltantesInsertar.push({
        idauditoria: idauditoria,
        secuenciaubicacion: marker.secuenciaubicacion,
        bodega: toStrUpper_(
          item.bodegaActual ||
          item.bodega ||
          marker.bodega ||
          inferWarehouseByLocation_(ubicacion, "")
        ),
        ubicacion: ubicacion,
        horainicioubicacion: "",
        horafinubicacion: "",
        idunico: idunico,
        codigo: toStrUpper_(item.codigo || ""),
        descripcion: toStrUpper_(item.descripcion || ""),
        horaescaneoidunico: "",
        escorrecto: false,
        esfaltante: true,
        essobrante: false,
        observaciones: "NO ESCANEADO AL CERRAR UBICACIÓN"
      });

      yaRegistrados[idunico] = true;
    });

    if (faltantesInsertar.length > 0) {
      AuditoriaExcedentesDetalleRepository.insertMany(faltantesInsertar);
    }

    AuditoriaExcedentesDetalleRepository.updateByRowNumber(marker._rowNumber, {
      horafinubicacion: fmtTimeNow_(),
      observaciones: observaciones || marker.observaciones || ""
    });

    const auditSnapshot = _recalcularCabeceraDesdeDetalle_(idauditoria);
    const estado = obtenerEstadoUbicacion({
      idauditoria: idauditoria,
      ubicacion: ubicacion
    });

    return {
      ok: true,
      mensaje: "Ubicación cerrada correctamente.",
      idauditoria: idauditoria,
      ubicacion: ubicacion,
      faltantesInsertados: faltantesInsertar.length,
      auditSnapshot: auditSnapshot,
      detalle: estado.detalle,
      resumen: estado.resumen,
      abierta: false
    };
  }

  // =========================================================
  // CIERRE DE AUDITORÍA
  // =========================================================

  function cerrarAuditoria(payload) {
    const idauditoria = toStr_(payload && payload.idauditoria);
    const observaciones = toStr_(payload && payload.observaciones);

    if (!idauditoria) {
      throw new Error("cerrarAuditoria() requiere idauditoria.");
    }

    const audit = _getAuditoriaOrThrow_(idauditoria);
    _assertAuditoriaAbierta_(audit);

    const abiertas = _getDetallesAuditoria_(idauditoria).filter(function (item) {
      return !item.idunico &&
        item.horainicioubicacion &&
        !item.horafinubicacion;
    });

    if (abiertas.length > 0) {
      throw new Error(
        "No se puede cerrar la auditoría porque hay ubicaciones abiertas. Cierra primero todas las ubicaciones."
      );
    }

    const resumen = _recalcularCabeceraDesdeDetalle_(idauditoria);
    const horafin = fmtTimeNow_();
    const duracionmin = minutesDiffFromStrings_(audit.fecha, audit.horainicio, horafin);

    const updated = AuditoriaExcedentesRepository.updateByIdAuditoria(idauditoria, {
      horafin: horafin,
      duracionmin: duracionmin,
      estatus: STATUS.CERRADA,
      ubicacionesauditadas: resumen.ubicacionesauditadas,
      ubicacionescondiferencia: resumen.ubicacionescondiferencia,
      idunicosesperadostotales: resumen.idunicosesperadostotales,
      idunicosescaneadostotales: resumen.idunicosescaneadostotales,
      idunicoscorrectostotales: resumen.idunicoscorrectostotales,
      idunicosfaltantestotales: resumen.idunicosfaltantestotales,
      idunicossobrantestotales: resumen.idunicossobrantestotales,
      confiabilidadtotal: resumen.confiabilidadtotal,
      observaciones: observaciones || audit.observaciones || ""
    });

    return {
      ok: true,
      mensaje: "Auditoría cerrada correctamente.",
      auditoria: updated,
      resumen: resumen
    };
  }

  // =========================================================
  // API PÚBLICA
  // =========================================================

  return {
    obtenerBootstrapCaptura,
    obtenerAuditoriasAbiertas,
    obtenerPaqueteCaptura,
    abrirUbicacionPorEscaneo,
    obtenerEstadoUbicacion,
    registrarEscaneoIdUnico,
    registrarEscaneosLote,
    cerrarUbicacion,
    cerrarAuditoria
  };

})();

/**
 * =========================================================
 * DEBUGGERS OPCIONALES
 * =========================================================
 */

function debugAuditoriaExcedentesCapturaService_obtenerBootstrapCaptura() {
  return AuditoriaExcedentesCapturaService.obtenerBootstrapCaptura();
}

function debugAuditoriaExcedentesCapturaService_obtenerAuditoriasAbiertas() {
  return AuditoriaExcedentesCapturaService.obtenerAuditoriasAbiertas();
}

function debugAuditoriaExcedentesCapturaService_obtenerPaqueteCaptura() {
  return AuditoriaExcedentesCapturaService.obtenerPaqueteCaptura("AUD-PRUEBA-001");
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

function debugAuditoriaExcedentesCapturaService_registrarEscaneosLote() {
  return AuditoriaExcedentesCapturaService.registrarEscaneosLote({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-01",
    escaneos: [
      {
        idunico: "20260514154729157481",
        tipoResultado: "CORRECTO",
        codigo: "PRUEBA",
        descripcion: "PRUEBA",
        bodega: "BODEGA 1",
        horaLocal: fmtTimeNow_(),
        observaciones: ""
      }
    ]
  });
}

function debugAuditoriaExcedentesCapturaService_cerrarUbicacion() {
  return AuditoriaExcedentesCapturaService.cerrarUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-01",
    faltantes: [],
    observaciones: "CIERRE DE PRUEBA"
  });
}

function debugAuditoriaExcedentesCapturaService_cerrarAuditoria() {
  return AuditoriaExcedentesCapturaService.cerrarAuditoria({
    idauditoria: "AUD-PRUEBA-001",
    observaciones: "CIERRE DESDE CAPTURA"
  });
}
