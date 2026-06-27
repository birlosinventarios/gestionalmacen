/**
 * AuditoriaExcedentesDetalleService.gs
 */

const AuditoriaExcedentesDetalleService = (() => {

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

  function _clone_(obj) {
    return JSON.parse(JSON.stringify(obj));
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

  function _normalizeIdAuditoria_(value) {
    return _toStr_(value);
  }

  function _normalizeUbicacion_(value) {
    return _toUpper_(value);
  }

  function _normalizeIdUnico_(value) {
    return _toStr_(value);
  }

  function _inferirBodegaPorUbicacion_(ubicacion) {
    const u = _normalizeUbicacion_(ubicacion);

    if (u.startsWith("B1")) return "BODEGA 1";
    if (u.startsWith("B2")) return "BODEGA 2";
    if (u.startsWith("B3")) return "BODEGA 3";
    if (u.startsWith("BM")) return "BODEGA MOSTRADOR";
    if (u.startsWith("CB1")) return "CASA BLANCA 1";
    if (u.startsWith("CB2")) return "CASA BLANCA 2";
    if (u.startsWith("CU")) return "CUARTO ALTO RIESGO";
    if (u.startsWith("MO")) return "MOSTRADOR";

    return "PENDIENTE DE UBICACIÓN";
  }

  function _getAuditoriaActivaOrThrow_(idAuditoria) {
    const id = _normalizeIdAuditoria_(idAuditoria);
    const audit = AuditoriaExcedentesRepository.getByIdAuditoria(id);

    if (!audit) {
      throw new Error(`No existe la auditoría ${id}`);
    }

    if (_toUpper_(audit.estatus) !== STATUS.ABIERTA) {
      throw new Error(`La auditoría ${id} no está ABIERTA`);
    }

    return audit;
  }

  function _getDetalleByAuditoria_(idAuditoria) {
    return AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idAuditoria);
  }

  function _getMarcadorUbicacion_(idAuditoria, ubicacion) {
    const id = _normalizeIdAuditoria_(idAuditoria);
    const ubi = _normalizeUbicacion_(ubicacion);

    const detalles = AuditoriaExcedentesDetalleRepository.getByAuditoriaYUbicacion(id, ubi);

    return detalles.find(x =>
      !x.idunico &&
      _normalizeUbicacion_(x.ubicacion) === ubi
    ) || null;
  }

  function _getSecuenciaSiguiente_(idAuditoria) {
    const detalles = _getDetalleByAuditoria_(idAuditoria);
    const maxSeq = detalles.reduce((acc, item) => Math.max(acc, _toNum_(item.secuenciaubicacion)), 0);
    return maxSeq + 1;
  }

  function _esUbicacionDentroDelAlcance_(auditoria, ubicacion, bodegaInferida) {
    const tipo = _toUpper_(auditoria.tipoauditoria);
    const bodegaObjetivo = _toUpper_(auditoria.bodegaobjetivo);
    const bodega = _toUpper_(bodegaInferida);

    if (tipo === TIPOS_AUDITORIA.GLOBAL) {
      return true;
    }

    if (tipo === TIPOS_AUDITORIA.POR_BODEGA) {
      return bodega === bodegaObjetivo;
    }

    return false;
  }

  function _getEsperadosPorUbicacion_(auditoria, ubicacion) {
    const tipo = _toUpper_(auditoria.tipoauditoria);
    const bodegaObjetivo = _toUpper_(auditoria.bodegaobjetivo);
    const ubi = _normalizeUbicacion_(ubicacion);

    let universo = [];

    if (tipo === TIPOS_AUDITORIA.GLOBAL) {
      universo = EstadoActualExcedentesService.getAuditables({
        tipoAuditoria: TIPOS_AUDITORIA.GLOBAL,
        bodegaObjetivo: "TODAS"
      });
    } else {
      universo = EstadoActualExcedentesService.getAuditables({
        tipoAuditoria: TIPOS_AUDITORIA.POR_BODEGA,
        bodegaObjetivo: bodegaObjetivo
      });
    }

    return universo.filter(x => _normalizeUbicacion_(x.ubicacionActual) === ubi);
  }

  function _buildResumenUbicacion_(idauditoria, ubicacion) {
    const items = AuditoriaExcedentesDetalleRepository.getByAuditoriaYUbicacion(idauditoria, ubicacion);

    const escaneados = items.filter(x => x.idunico);
    const correctos = escaneados.filter(x => x.escorrecto);
    const faltantes = items.filter(x => x.esfaltante);
    const sobrantes = items.filter(x => x.essobrante);

    return {
      idauditoria: _normalizeIdAuditoria_(idauditoria),
      ubicacion: _normalizeUbicacion_(ubicacion),
      escaneados: escaneados.length,
      correctos: correctos.length,
      faltantes: faltantes.length,
      sobrantes: sobrantes.length,
      totalRegistros: items.length
    };
  }

  // =========================================================
  // API PÚBLICA
  // =========================================================

  /**
   * Abre una ubicación dentro de una auditoría abierta.
   * Crea un registro marcador sin IdUnico para controlar inicio/fin.
   */
  function abrirUbicacion(payload) {
    const idauditoria = _normalizeIdAuditoria_(payload && payload.idauditoria);
    const ubicacion = _normalizeUbicacion_(payload && payload.ubicacion);

    if (!idauditoria) {
      throw new Error("abrirUbicacion() requiere payload.idauditoria");
    }

    if (!ubicacion) {
      throw new Error("abrirUbicacion() requiere payload.ubicacion");
    }

    const auditoria = _getAuditoriaActivaOrThrow_(idauditoria);

    const existing = _getMarcadorUbicacion_(idauditoria, ubicacion);
    if (existing && !existing.horafinubicacion) {
      return {
        ok: true,
        mensaje: "La ubicación ya estaba abierta",
        marcador: existing,
        resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
      };
    }

    const bodega = _inferirBodegaPorUbicacion_(ubicacion);

    if (!_esUbicacionDentroDelAlcance_(auditoria, ubicacion, bodega)) {
      throw new Error(`La ubicación ${ubicacion} no pertenece al alcance de la auditoría`);
    }

    const secuencia = _getSecuenciaSiguiente_(idauditoria);

    const marker = AuditoriaExcedentesDetalleRepository.insert({
      idauditoria,
      secuenciaubicacion: secuencia,
      bodega: bodega,
      ubicacion: ubicacion,
      horainicioubicacion: _fmtTime_(),
      horafinubicacion: "",
      idunico: "",
      codigo: "",
      descripcion: "",
      horaescaneoidunico: "",
      escorrecto: false,
      esfaltante: false,
      essobrante: false,
      observaciones: _toStr_(payload && payload.observaciones)
    });

    return {
      ok: true,
      mensaje: "Ubicación abierta correctamente",
      marcador: marker,
      resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
    };
  }

  /**
   * Obtiene los esperados de una ubicación desde EstadoActualExcedentesService.
   */
  function obtenerEsperadosPorUbicacion(idauditoria, ubicacion) {
    const audit = _getAuditoriaActivaOrThrow_(idauditoria);
    const data = _getEsperadosPorUbicacion_(audit, ubicacion);

    return {
      idauditoria: _normalizeIdAuditoria_(idauditoria),
      ubicacion: _normalizeUbicacion_(ubicacion),
      totalEsperados: data.length,
      data: _clone_(data)
    };
  }

  /**
   * Registra un escaneo de IdUnico dentro de una ubicación.
   */
  function registrarEscaneoIdUnico(payload) {
    const idauditoria = _normalizeIdAuditoria_(payload && payload.idauditoria);
    const ubicacion = _normalizeUbicacion_(payload && payload.ubicacion);
    const idunico = _normalizeIdUnico_(payload && payload.idunico);

    if (!idauditoria) {
      throw new Error("registrarEscaneoIdUnico() requiere payload.idauditoria");
    }

    if (!ubicacion) {
      throw new Error("registrarEscaneoIdUnico() requiere payload.ubicacion");
    }

    if (!idunico) {
      throw new Error("registrarEscaneoIdUnico() requiere payload.idunico");
    }

    const audit = _getAuditoriaActivaOrThrow_(idauditoria);

    // Aseguramos que la ubicación esté abierta
    let marker = _getMarcadorUbicacion_(idauditoria, ubicacion);
    if (!marker || marker.horafinubicacion) {
      abrirUbicacion({
        idauditoria,
        ubicacion
      });
      marker = _getMarcadorUbicacion_(idauditoria, ubicacion);
    }

    // No permitir duplicado dentro de toda la auditoría
    const already = AuditoriaExcedentesDetalleRepository.findEscaneo(idauditoria, idunico);
    if (already) {
      const mismaUbicacion = _normalizeUbicacion_(already.ubicacion) === ubicacion;

      return {
        ok: false,
        duplicado: true,
        tipoResultado: mismaUbicacion ? "DUPLICADO_EN_UBICACION" : "DUPLICADO_EN_AUDITORIA",
        mensaje: mismaUbicacion
          ? `El IdUnico ${idunico} ya fue escaneado en esta ubicación`
          : `El IdUnico ${idunico} ya fue escaneado dentro de la auditoría`,
        detalle: {
          idunico,
          ubicacion,
          ubicacionExistente: _normalizeUbicacion_(already.ubicacion)
        },
        registroExistente: already,
        resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
      };
    }

    const actual = EstadoActualExcedentesService.getUnoPorIdUnico(idunico);

    // NO ENCONTRADO = SOBRANTE
    if (!actual) {
      const regNoReconocido = AuditoriaExcedentesDetalleRepository.insert({
        idauditoria,
        secuenciaubicacion: (marker && marker.secuenciaubicacion) || _getSecuenciaSiguiente_(idauditoria),
        bodega: _inferirBodegaPorUbicacion_(ubicacion),
        ubicacion,
        horainicioubicacion: "",
        horafinubicacion: "",
        idunico,
        codigo: "",
        descripcion: "",
        horaescaneoidunico: _fmtTime_(),
        escorrecto: false,
        esfaltante: false,
        essobrante: true,
        observaciones: "IDUNICO NO ENCONTRADO EN ESTADO ACTUAL"
      });

      return {
        ok: true,
        tipoResultado: "SOBRANTE",
        mensaje: `El IdUnico ${idunico} no existe en estado actual. Se registró como sobrante.`,
        detalle: {
          idunico,
          ubicacion,
          observacion: "SOBRANTE_NO_RECONOCIDO"
        },
        registro: regNoReconocido,
        resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
      };
    }

    const bodegaActual = _toUpper_(actual.bodegaActual);
    const ubicacionActual = _normalizeUbicacion_(actual.ubicacionActual);

    // FUERA DEL ALCANCE = SOBRANTE
    if (!_esUbicacionDentroDelAlcance_(audit, ubicacionActual, bodegaActual)) {
      const regFueraAlcance = AuditoriaExcedentesDetalleRepository.insert({
        idauditoria,
        secuenciaubicacion: (marker && marker.secuenciaubicacion) || _getSecuenciaSiguiente_(idauditoria),
        bodega: _inferirBodegaPorUbicacion_(ubicacion),
        ubicacion,
        horainicioubicacion: "",
        horafinubicacion: "",
        idunico,
        codigo: actual.codigo || "",
        descripcion: actual.descripcion || "",
        horaescaneoidunico: _fmtTime_(),
        escorrecto: false,
        esfaltante: false,
        essobrante: true,
        observaciones: `FUERA DE ALCANCE. SISTEMA: ${ubicacionActual || "SIN UBICACIÓN"}`
      });

      return {
        ok: true,
        tipoResultado: "SOBRANTE",
        mensaje: `El IdUnico ${idunico} está físicamente en ${ubicacion}, pero en sistema pertenece a una ubicación fuera del alcance de la auditoría.`,
        detalle: {
          idunico,
          ubicacion,
          ubicacionSistema: ubicacionActual || "",
          observacion: "SOBRANTE_FUERA_DE_ALCANCE"
        },
        registro: regFueraAlcance,
        actual,
        resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
      };
    }

    // UBICACIÓN DISTINTA = SOBRANTE
    if (ubicacionActual !== ubicacion) {
      const regSobrante = AuditoriaExcedentesDetalleRepository.insert({
        idauditoria,
        secuenciaubicacion: (marker && marker.secuenciaubicacion) || _getSecuenciaSiguiente_(idauditoria),
        bodega: _inferirBodegaPorUbicacion_(ubicacion),
        ubicacion,
        horainicioubicacion: "",
        horafinubicacion: "",
        idunico,
        codigo: actual.codigo || "",
        descripcion: actual.descripcion || "",
        horaescaneoidunico: _fmtTime_(),
        escorrecto: false,
        esfaltante: false,
        essobrante: true,
        observaciones: `ESPERADO EN ${ubicacionActual || "SIN UBICACIÓN"}`
      });

      return {
        ok: true,
        tipoResultado: "SOBRANTE",
        mensaje: `El IdUnico ${idunico} está físicamente en ${ubicacion}, pero en sistema pertenece a ${ubicacionActual || "otra ubicación"}.`,
        detalle: {
          idunico,
          ubicacion,
          ubicacionSistema: ubicacionActual || "",
          observacion: "SOBRANTE_UBICACION_DISTINTA"
        },
        registro: regSobrante,
        actual,
        resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
      };
    }

    // CORRECTO
    const regCorrecto = AuditoriaExcedentesDetalleRepository.insert({
      idauditoria,
      secuenciaubicacion: (marker && marker.secuenciaubicacion) || _getSecuenciaSiguiente_(idauditoria),
      bodega: _inferirBodegaPorUbicacion_(ubicacion),
      ubicacion,
      horainicioubicacion: "",
      horafinubicacion: "",
      idunico,
      codigo: actual.codigo || "",
      descripcion: actual.descripcion || "",
      horaescaneoidunico: _fmtTime_(),
      escorrecto: true,
      esfaltante: false,
      essobrante: false,
      observaciones: ""
    });

    return {
      ok: true,
      tipoResultado: "CORRECTO",
      mensaje: "Escaneo correcto",
      detalle: {
        idunico,
        ubicacion
      },
      registro: regCorrecto,
      actual,
      resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
    };
  }

  /**
   * Cierra una ubicación:
   * - genera faltantes
   * - cierra marcador
   * - devuelve resumen de la ubicación
   */
  function cerrarUbicacion(payload) {
    const idauditoria = _normalizeIdAuditoria_(payload && payload.idauditoria);
    const ubicacion = _normalizeUbicacion_(payload && payload.ubicacion);
    const observaciones = _toStr_(payload && payload.observaciones);

    if (!idauditoria) {
      throw new Error("cerrarUbicacion() requiere payload.idauditoria");
    }

    if (!ubicacion) {
      throw new Error("cerrarUbicacion() requiere payload.ubicacion");
    }

    const audit = _getAuditoriaActivaOrThrow_(idauditoria);
    const marker = _getMarcadorUbicacion_(idauditoria, ubicacion);

    if (!marker) {
      throw new Error(`La ubicación ${ubicacion} no ha sido abierta en esta auditoría`);
    }

    if (marker.horafinubicacion) {
      return {
        ok: true,
        mensaje: "La ubicación ya estaba cerrada",
        resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
      };
    }

    const esperados = _getEsperadosPorUbicacion_(audit, ubicacion);
    const escaneados = AuditoriaExcedentesDetalleRepository
      .getEscaneadosByAuditoriaYUbicacion(idauditoria, ubicacion);

    const setEscaneados = new Set(
      escaneados
        .map(x => _normalizeIdUnico_(x.idunico))
        .filter(Boolean)
    );

    const faltantes = esperados.filter(item => !setEscaneados.has(_normalizeIdUnico_(item.idUnico)));

    if (faltantes.length > 0) {
      AuditoriaExcedentesDetalleRepository.insertMany(
        faltantes.map(item => ({
          idauditoria,
          secuenciaubicacion: marker.secuenciaubicacion,
          bodega: _toUpper_(item.bodegaActual),
          ubicacion: _normalizeUbicacion_(item.ubicacionActual),
          horainicioubicacion: "",
          horafinubicacion: "",
          idunico: _normalizeIdUnico_(item.idUnico),
          codigo: _toUpper_(item.codigo),
          descripcion: _toUpper_(item.descripcion),
          horaescaneoidunico: "",
          escorrecto: false,
          esfaltante: true,
          essobrante: false,
          observaciones: "NO ESCANEADO AL CERRAR UBICACIÓN"
        }))
      );
    }

    AuditoriaExcedentesDetalleRepository.updateByRowNumber(marker._rowNumber, {
      horafinubicacion: _fmtTime_(),
      observaciones: observaciones || marker.observaciones || ""
    });

    return {
      ok: true,
      mensaje: "Ubicación cerrada correctamente",
      totalEsperados: esperados.length,
      totalEscaneados: escaneados.length,
      totalFaltantesGenerados: faltantes.length,
      resumen: _buildResumenUbicacion_(idauditoria, ubicacion)
    };
  }

  /**
   * Obtiene detalle completo de una ubicación
   */
  function getDetalleUbicacion(idauditoria, ubicacion) {
    const data = AuditoriaExcedentesDetalleRepository.getByAuditoriaYUbicacion(idauditoria, ubicacion);
    const resumen = _buildResumenUbicacion_(idauditoria, ubicacion);

    return {
      idauditoria: _normalizeIdAuditoria_(idauditoria),
      ubicacion: _normalizeUbicacion_(ubicacion),
      resumen,
      data
    };
  }

  /**
   * Lista ubicaciones tocadas dentro de la auditoría
   */
  function listarUbicacionesAuditadas(idauditoria) {
    const detalles = AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria);

    const map = {};
    detalles.forEach(item => {
      const ubi = _normalizeUbicacion_(item.ubicacion);
      if (!ubi) return;

      if (!map[ubi]) {
        map[ubi] = {
          ubicacion: ubi,
          bodega: _toUpper_(item.bodega),
          secuenciaubicacion: _toNum_(item.secuenciaubicacion),
          abierta: false,
          cerrada: false
        };
      }

      if (item.horainicioubicacion) {
        map[ubi].abierta = true;
      }

      if (item.horafinubicacion) {
        map[ubi].cerrada = true;
      }
    });

    return Object.values(map).sort((a, b) => a.secuenciaubicacion - b.secuenciaubicacion);
  }

  /**
   * Ubicaciones actualmente abiertas (sin HoraFinUbicacion)
   */
  function listarUbicacionesAbiertas(idauditoria) {
    const detalles = AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria);

    return detalles
      .filter(x => !x.idunico && x.horainicioubicacion && !x.horafinubicacion)
      .map(x => ({
        ubicacion: x.ubicacion,
        bodega: x.bodega,
        secuenciaubicacion: x.secuenciaubicacion,
        horainicioubicacion: x.horainicioubicacion
      }));
  }

  return {
    abrirUbicacion,
    obtenerEsperadosPorUbicacion,
    registrarEscaneoIdUnico,
    cerrarUbicacion,
    getDetalleUbicacion,
    listarUbicacionesAuditadas,
    listarUbicacionesAbiertas
  };

})();

/**
 * =========================================================
 * DEBUGGERS
 * =========================================================
 */

function debugAuditoriaExcedentesDetalleService_abrirUbicacion() {
  return AuditoriaExcedentesDetalleService.abrirUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19"
  });
}

function debugAuditoriaExcedentesDetalleService_registrarEscaneoIdUnico() {
  return AuditoriaExcedentesDetalleService.registrarEscaneoIdUnico({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19",
    idunico: "202605141622201581"
  });
}

function debugAuditoriaExcedentesDetalleService_cerrarUbicacion() {
  return AuditoriaExcedentesDetalleService.cerrarUbicacion({
    idauditoria: "AUD-PRUEBA-001",
    ubicacion: "B1-19"
  });
}

function debugAuditoriaExcedentesDetalleService_getDetalleUbicacion() {
  return AuditoriaExcedentesDetalleService.getDetalleUbicacion("AUD-PRUEBA-001", "B1-19");
}
