
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

    const audit = AuditoriaExcedentesRepository.getByIdAuditoriaFresh
      ? AuditoriaExcedentesRepository.getByIdAuditoriaFresh(id)
      : AuditoriaExcedentesRepository.getByIdAuditoria(id);

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

  function _buildEstadoActualIndexFresh_() {
    if (
      typeof EstadoActualExcedentesService === "undefined" ||
      !EstadoActualExcedentesService ||
      typeof EstadoActualExcedentesService.getAll !== "function"
    ) {
      throw new Error(
        "EstadoActualExcedentesService no está disponible para validar escaneos."
      );
    }

    /*
    * Limpia únicamente la caché consolidada de estado actual.
    * No usa ScriptLock y se ejecuta una vez por lote.
    */
    if (typeof EstadoActualExcedentesService.clearCache === "function") {
      EstadoActualExcedentesService.clearCache();
    }

    const estadoActual = EstadoActualExcedentesService.getAll() || [];

    return estadoActual.reduce(function (index, item) {
      const idunico = toStrUpper_(
        item && (item.idUnico || item.idunico || "")
      );

      if (!idunico) return index;

      index[idunico] = {
        idunico: idunico,
        codigo: toStrUpper_(item.codigo || item.sku || ""),
        descripcion: toStrUpper_(item.descripcion || ""),
        ubicacionActual: toStrUpper_(
          item.ubicacionActual || item.ubicacion || ""
        ),
        bodegaActual: toStrUpper_(
          item.bodegaActual ||
          item.bodega ||
          inferWarehouseByLocation_(
            item.ubicacionActual || item.ubicacion || "",
            ""
          )
        ),
        saldoActual: toNum_(
          item.saldoActual != null
            ? item.saldoActual
            : item.saldoBase
        ),
        existeBD: item.existeBD === true,
        validoBD: item.validoBD === true,
        vigente: item.vigente === true,
        conUbicacion: item.conUbicacion === true,
        auditable: item.auditable === true,
        estatusRegistro: toStrUpper_(item.estatusRegistro || ""),
        estatusLogico: toStrUpper_(item.estatusLogico || "")
      };

      return index;
    }, {});
  }

  function _clasificarEscaneoServidor_(
    auditoria,
    ubicacionAuditada,
    idunico,
    estadoActualIndex
  ) {
    const id = toStrUpper_(idunico);
    const ubicacion = toStrUpper_(ubicacionAuditada);
    const actual = estadoActualIndex[id] || null;

    if (!actual) {
      return {
        tipoResultado: TIPO_RESULTADO.SOBRANTE,
        escorrecto: false,
        essobrante: true,
        actual: null,
        motivo: "IDUNICO_NO_ENCONTRADO",
        observaciones: "IDUNICO NO ENCONTRADO EN ESTADO ACTUAL"
      };
    }

    if (actual.existeBD !== true) {
      return {
        tipoResultado: TIPO_RESULTADO.SOBRANTE,
        escorrecto: false,
        essobrante: true,
        actual: actual,
        motivo: "SIN_REGISTRO_BD",
        observaciones: "IDUNICO SIN REGISTRO VÁLIDO EN BD-EXCEDENTES"
      };
    }

    if (actual.validoBD !== true) {
      return {
        tipoResultado: TIPO_RESULTADO.SOBRANTE,
        escorrecto: false,
        essobrante: true,
        actual: actual,
        motivo: "REGISTRO_BD_NO_VALIDO",
        observaciones:
          "IDUNICO CON ESTATUS NO AUDITABLE: " +
          (actual.estatusRegistro || actual.estatusLogico || "SIN ESTATUS")
      };
    }

    if (actual.vigente !== true || Number(actual.saldoActual || 0) <= 0) {
      return {
        tipoResultado: TIPO_RESULTADO.SOBRANTE,
        escorrecto: false,
        essobrante: true,
        actual: actual,
        motivo: "SIN_SALDO_VIGENTE",
        observaciones: "IDUNICO SIN SALDO VIGENTE PARA AUDITORÍA"
      };
    }

    if (!actual.ubicacionActual || actual.conUbicacion !== true) {
      return {
        tipoResultado: TIPO_RESULTADO.SOBRANTE,
        escorrecto: false,
        essobrante: true,
        actual: actual,
        motivo: "SIN_UBICACION_ACTUAL",
        observaciones: "IDUNICO SIN UBICACIÓN FÍSICA VÁLIDA"
      };
    }

    try {
      _assertUbicacionEnAlcance_(
        auditoria,
        actual.ubicacionActual,
        actual.bodegaActual
      );
    } catch (errorAlcance) {
      return {
        tipoResultado: TIPO_RESULTADO.SOBRANTE,
        escorrecto: false,
        essobrante: true,
        actual: actual,
        motivo: "FUERA_DEL_ALCANCE",
        observaciones:
          "IDUNICO FUERA DEL ALCANCE DE ESTA AUDITORÍA. " +
          (errorAlcance && errorAlcance.message
            ? errorAlcance.message
            : "")
      };
    }

    if (actual.ubicacionActual !== ubicacion) {
      return {
        tipoResultado: TIPO_RESULTADO.SOBRANTE,
        escorrecto: false,
        essobrante: true,
        actual: actual,
        motivo: "UBICACION_DIFERENTE",
        observaciones: "ESPERADO EN " + actual.ubicacionActual
      };
    }

    return {
      tipoResultado: TIPO_RESULTADO.CORRECTO,
      escorrecto: true,
      essobrante: false,
      actual: actual,
      motivo: "COINCIDENCIA_CONFIRMADA",
      observaciones: ""
    };
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

  
  function _esIdentificadorUbicacionExcedente_(valor) {
    const raw = toStrUpper_(valor || "");

    if (!raw) return false;

    const registro = _buscarRegistroUbicacionPorIdentificador_(raw);

    return !!registro;
  }


  // =========================================================
  // DETALLES / MARCADORES
  // =========================================================

  
  function _getDetallesAuditoria_(idauditoria) {
    return AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh
      ? AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh(idauditoria)
      : AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria) || [];
  }



  function _getDetallesUbicacion_(idauditoria, ubicacion) {
    const id = toStr_(idauditoria);
    const ubi = toStrUpper_(ubicacion);

    const detalles = AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh
      ? AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh(id)
      : AuditoriaExcedentesDetalleRepository.getByIdAuditoria(id) || [];

    return detalles.filter(function(x) {
      return toStrUpper_(x.ubicacion) === ubi;
    });
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

    try {
      const universo = _getUniversoEsperadoAuditoria_(audit) || [];

      const esperadosUbicacion = universo.filter(function(row) {
        return toStrUpper_(row.ubicacionActual || row.ubicacion || "") === ubicacionResuelta.ubicacion;
      }).length;

      if (typeof AuditoriaExcedentesLiveCache !== "undefined") {
        AuditoriaExcedentesLiveCache.abrirUbicacion({
          idauditoria: idauditoria,
          ubicacion: ubicacionResuelta.ubicacion,
          bodega: ubicacionResuelta.bodega,
          secuenciaubicacion: marker.secuenciaubicacion,
          horainicioubicacion: marker.horainicioubicacion || fmtTimeNow_(),
          esperados: esperadosUbicacion
        });
      }
    } catch (e) {
      console.warn("[LIVE] No se pudo emitir apertura de ubicación:", e);
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
  /**
   * Delegamos el cálculo maestro a AuditoriaExcedentesService
   * para que captura, detalle, dashboard y cabecera usen la misma regla.
   */
  return AuditoriaExcedentesService.recalcularResumen(idauditoria, {
    persistir: true,
    usarFresh: true
  });

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
        clasificaciones: [],
        correccionesClasificacion: 0,
        mensaje: "No había escaneos pendientes para sincronizar."
      };
    }

    if (escaneos.length > 100) {
      throw new Error("El lote excede el máximo permitido de 100 escaneos.");
    }

    const audit = _getAuditoriaOrThrow_(idauditoria);
    _assertAuditoriaAbierta_(audit);

    const marker = _getMarcadorAbiertoUbicacion_(idauditoria, ubicacion);

    if (!marker) {
      throw new Error("La ubicación " + ubicacion + " no está abierta.");
    }

    _assertUbicacionEnAlcance_(
      audit,
      ubicacion,
      marker.bodega || inferWarehouseByLocation_(ubicacion, "")
    );

    const detalleActual = _getDetallesAuditoria_(idauditoria);
    const yaRegistrados = {};

    detalleActual.forEach(function (row) {
      const idu = toStrUpper_(row.idunico || "");
      if (!idu || row.esfaltante === true) return;

      yaRegistrados[idu] = {
        ubicacion: toStrUpper_(row.ubicacion || ""),
        escorrecto: row.escorrecto === true,
        essobrante: row.essobrante === true,
        fila: row._rowNumber || null
      };
    });

    const estadoActualIndex = _buildEstadoActualIndexFresh_();
    const rowsInsertar = [];
    const omitidos = [];
    const clasificaciones = [];
    let correccionesClasificacion = 0;

    escaneos.forEach(function (item, index) {
      const idunico = toStrUpper_(
        item && (item.idunico || item.idUnico || "")
      );

      const tipoPreliminar = toStrUpper_(
        item && (
          item.tipoResultadoPreliminar ||
          item.tipoResultado ||
          item.estado ||
          ""
        )
      );

      if (!idunico) {
        omitidos.push({ indice: index, motivo: "SIN_IDUNICO" });
        return;
      }

      if (_esIdentificadorUbicacionExcedente_(idunico)) {
        omitidos.push({
          indice: index,
          idunico: idunico,
          motivo: "QR_UBICACION_NO_ES_IDUNICO"
        });
        return;
      }

      if (yaRegistrados[idunico]) {
        omitidos.push({
          indice: index,
          idunico: idunico,
          motivo: "DUPLICADO_SERVIDOR",
          ubicacionExistente: yaRegistrados[idunico].ubicacion
        });

        clasificaciones.push({
          indice: index,
          idunico: idunico,
          persistido: false,
          duplicado: true,
          tipoPreliminar: tipoPreliminar,
          tipoResultado: "DUPLICADO",
          motivo: "DUPLICADO_SERVIDOR",
          ubicacionAuditada: ubicacion,
          ubicacionEsperada: yaRegistrados[idunico].ubicacion,
          codigo: "",
          descripcion: "",
          observaciones: "IDUNICO YA REGISTRADO EN ESTA AUDITORÍA"
        });
        return;
      }

      const clasificacion = _clasificarEscaneoServidor_(
        audit,
        ubicacion,
        idunico,
        estadoActualIndex
      );

      const actual = clasificacion.actual || {};
      const codigo = toStrUpper_(actual.codigo || (item && item.codigo) || "");
      const descripcion = toStrUpper_(
        actual.descripcion || (item && item.descripcion) || ""
      );
      const bodegaRegistro = toStrUpper_(
        marker.bodega || inferWarehouseByLocation_(ubicacion, "")
      );
      const horaEscaneo = toStr_(
        item && (item.hora || item.horaLocal)
      ) || fmtTimeNow_();
      const tipoDefinitivo = clasificacion.tipoResultado;

      if (tipoPreliminar && tipoPreliminar !== tipoDefinitivo) {
        correccionesClasificacion++;
      }

      const observacionesCliente = toStr_(
        item && (item.observaciones || item.mensaje || "")
      );
      const observacionesServidor = toStr_(clasificacion.observaciones || "");
      const observacionesFinales =
        tipoDefinitivo === TIPO_RESULTADO.CORRECTO
          ? ""
          : (observacionesServidor || observacionesCliente);

      rowsInsertar.push({
        idauditoria: idauditoria,
        secuenciaubicacion: marker.secuenciaubicacion,
        bodega: bodegaRegistro,
        ubicacion: ubicacion,
        horainicioubicacion: "",
        horafinubicacion: "",
        idunico: idunico,
        codigo: codigo,
        descripcion: descripcion,
        horaescaneoidunico: horaEscaneo,
        escorrecto: clasificacion.escorrecto === true,
        esfaltante: false,
        essobrante: clasificacion.essobrante === true,
        observaciones: observacionesFinales
      });

      yaRegistrados[idunico] = {
        ubicacion: ubicacion,
        escorrecto: clasificacion.escorrecto === true,
        essobrante: clasificacion.essobrante === true,
        fila: null
      };

      clasificaciones.push({
        indice: index,
        idunico: idunico,
        persistido: true,
        duplicado: false,
        tipoPreliminar: tipoPreliminar,
        tipoResultado: tipoDefinitivo,
        corregido: !!tipoPreliminar && tipoPreliminar !== tipoDefinitivo,
        motivo: clasificacion.motivo,
        ubicacionAuditada: ubicacion,
        ubicacionEsperada: toStrUpper_(actual.ubicacionActual || ""),
        bodegaEsperada: toStrUpper_(actual.bodegaActual || ""),
        codigo: codigo,
        descripcion: descripcion,
        observaciones: observacionesFinales
      });
    });

    let auditSnapshot = null;

    if (rowsInsertar.length > 0) {
      AuditoriaExcedentesDetalleRepository.insertMany(rowsInsertar);

      try {
        if (typeof AuditoriaExcedentesLiveCache !== "undefined") {
          AuditoriaExcedentesLiveCache.registrarEscaneos({
            idauditoria: idauditoria,
            ubicacion: ubicacion,
            bodega: marker.bodega,
            secuenciaubicacion: marker.secuenciaubicacion,
            esperados: toNum_(payload && payload.esperadosUbicacion),
            rows: rowsInsertar
          });
        }
      } catch (errorLive) {
        console.warn("[LIVE] No se pudo emitir lote de escaneos:", errorLive);
      }

      auditSnapshot = _recalcularCabeceraDesdeDetalle_(idauditoria);
    }

    return {
      ok: true,
      insertados: rowsInsertar.length,
      omitidos: omitidos.length,
      detalleOmitidos: omitidos,
      clasificaciones: clasificaciones,
      correccionesClasificacion: correccionesClasificacion,
      auditSnapshot: auditSnapshot,
      mensaje: correccionesClasificacion > 0
        ? "Escaneos sincronizados. " +
          correccionesClasificacion +
          " clasificación(es) preliminar(es) fueron corregidas por el servidor."
        : "Escaneos sincronizados correctamente."
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
      throw new Error(
        "La ubicación " + ubicacion + " no está abierta o ya fue cerrada."
      );
    }

    _assertUbicacionEnAlcance_(
      audit,
      ubicacion,
      marker.bodega || inferWarehouseByLocation_(ubicacion, "")
    );

    /*
    * El servidor obtiene nuevamente el universo autoritativo.
    * payload.faltantes se ignora intencionalmente.
    */
    const universo = _getUniversoEsperadoAuditoria_(audit) || [];
    const esperadosUbicacion = universo.filter(function (item) {
      return toStrUpper_(item.ubicacionActual || item.ubicacion || "") === ubicacion;
    });

    const detalleActual = _getDetallesUbicacion_(idauditoria, ubicacion);
    const idsEscaneadosCorrectos = new Set(
      detalleActual
        .filter(function (row) {
          return row.idunico && row.escorrecto === true;
        })
        .map(function (row) {
          return toStrUpper_(row.idunico);
        })
        .filter(Boolean)
    );

    const idsYaPersistidos = new Set(
      detalleActual
        .filter(function (row) {
          return !!row.idunico;
        })
        .map(function (row) {
          return toStrUpper_(row.idunico);
        })
        .filter(Boolean)
    );

    const faltantesInsertar = esperadosUbicacion
      .filter(function (item) {
        const id = toStrUpper_(item.idUnico || item.idunico || "");
        return id && !idsEscaneadosCorrectos.has(id) && !idsYaPersistidos.has(id);
      })
      .map(function (item) {
        return {
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
          idunico: toStrUpper_(item.idUnico || item.idunico || ""),
          codigo: toStrUpper_(item.codigo || ""),
          descripcion: toStrUpper_(item.descripcion || ""),
          horaescaneoidunico: "",
          escorrecto: false,
          esfaltante: true,
          essobrante: false,
          observaciones: "NO ESCANEADO AL CERRAR UBICACIÓN"
        };
      });

    if (faltantesInsertar.length > 0) {
      AuditoriaExcedentesDetalleRepository.insertMany(faltantesInsertar);
    }

    const horaFinLive = fmtTimeNow_();

    AuditoriaExcedentesDetalleRepository.updateByRowNumber(
      marker._rowNumber,
      {
        horafinubicacion: horaFinLive,
        observaciones: observaciones || marker.observaciones || ""
      }
    );

    try {
      if (typeof AuditoriaExcedentesLiveCache !== "undefined") {
        AuditoriaExcedentesLiveCache.cerrarUbicacion({
          idauditoria: idauditoria,
          ubicacion: ubicacion,
          bodega: marker.bodega,
          secuenciaubicacion: marker.secuenciaubicacion,
          horafinubicacion: horaFinLive,
          faltantesInsertados: faltantesInsertar.length
        });
      }
    } catch (errorLive) {
      console.warn("[LIVE] No se pudo emitir cierre de ubicación:", errorLive);
    }

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
      esperadosServidor: esperadosUbicacion.length,
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

    
    try {
      if (typeof AuditoriaExcedentesLiveCache !== "undefined") {
        AuditoriaExcedentesLiveCache.clear(idauditoria);
      }
    } catch (e) {
      console.warn("[LIVE] No se pudo limpiar LiveCache al cerrar auditoría:", e);
    }

    return {
      ok: true,
      mensaje: "Auditoría cerrada correctamente.",
      auditoria: updated,
      resumen: resumen
    };
  }

  function enriquecerSobrantesLote(payload) {
    const ids = Array.isArray(payload && payload.ids)
      ? payload.ids
      : [];

    const salida = {};

    ids.forEach(function (rawId) {
      const idunico = toStrUpper_(rawId);

      if (!idunico) return;

      try {
        const actual = EstadoActualExcedentesService.getUnoPorIdUnico(idunico);

        if (!actual) {
          salida[idunico] = {
            encontrado: false,
            idunico: idunico,
            codigo: "",
            descripcion: "",
            bodegaActual: "",
            ubicacionActual: "",
            observaciones: "IDUNICO NO ENCONTRADO EN ESTADO ACTUAL"
          };
          return;
        }

        salida[idunico] = {
          encontrado: true,
          idunico: idunico,
          codigo: toStrUpper_(actual.codigo || ""),
          descripcion: toStrUpper_(actual.descripcion || ""),
          bodegaActual: toStrUpper_(actual.bodegaActual || actual.bodega || ""),
          ubicacionActual: toStrUpper_(actual.ubicacionActual || actual.ubicacion || ""),
          observaciones: actual.ubicacionActual
            ? "SISTEMA: " + toStrUpper_(actual.ubicacionActual)
            : "SISTEMA SIN UBICACIÓN"
        };

      } catch (error) {
        salida[idunico] = {
          encontrado: false,
          idunico: idunico,
          codigo: "",
          descripcion: "",
          bodegaActual: "",
          ubicacionActual: "",
          observaciones: "ERROR AL CONSULTAR ESTADO ACTUAL: " + (error && error.message ? error.message : "")
        };
      }
    });

    return {
      ok: true,
      total: Object.keys(salida).length,
      data: salida
    };
  }

  function actualizarObservacionesSobrantes(payload) {
    payload = payload || {};

    const idauditoria = toStrUpper_(payload.idauditoria || "");
    const ubicacionAuditada = toStrUpper_(payload.ubicacionAuditada || "");
    const actualizaciones = Array.isArray(payload.actualizaciones)
      ? payload.actualizaciones
      : [];

    if (!idauditoria) {
      throw new Error("Falta idauditoria para actualizar observaciones de sobrantes.");
    }

    if (!ubicacionAuditada) {
      throw new Error("Falta ubicación auditada para actualizar observaciones de sobrantes.");
    }

    if (!actualizaciones.length) {
      return {
        ok: true,
        actualizados: 0,
        mensaje: "Sin observaciones por actualizar."
      };
    }

    const detalle = _getDetallesUbicacion_(idauditoria, ubicacionAuditada);

    if (!detalle.length) {
      return {
        ok: true,
        actualizados: 0,
        mensaje: "No se encontraron detalles para la ubicación auditada."
      };
    }

    const mapa = {};

    actualizaciones.forEach(function (item) {
      const id = toStrUpper_(item.idunico || "");
      if (id) mapa[id] = item;
    });

    let actualizados = 0;

    detalle.forEach(function (row) {
      const idunico = toStrUpper_(row.idunico || "");

      if (!idunico) return;
      if (!mapa[idunico]) return;
      if (row.essobrante !== true) return;

      const upd = mapa[idunico];

      AuditoriaExcedentesDetalleRepository.updateByRowNumber(row._rowNumber, {
        codigo: toStrUpper_(upd.codigo || row.codigo || ""),
        descripcion: toStrUpper_(upd.descripcion || row.descripcion || ""),
        observaciones: toStr_(upd.observaciones || row.observaciones || "")
      });

      actualizados++;
    });

    return {
      ok: true,
      actualizados: actualizados,
      mensaje: "Observaciones de sobrantes actualizadas: " + actualizados
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
    enriquecerSobrantesLote,
    actualizarObservacionesSobrantes,
    cerrarAuditoria
  };


})();

