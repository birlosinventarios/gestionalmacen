/**
 * AuditoriaExcedentesService.gs
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

  const CONFIABILIDAD = Object.freeze({
    RED_MAX: 89.9999,
    AMBER_MIN: 90,
    AMBER_MAX: 96.9999,
    EMERALD_MIN: 97
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

  function _genIdAuditoria_() {
    const d = _now_();
    return "AUD-" + Utilities.formatDate(d, _tz_(), "yyyyMMdd-HHmmss");
  }

  function _minutesDiff_(fechaStr, horaInicioStr, horaFinStr) {
    try {
      if (!fechaStr || !horaInicioStr || !horaFinStr) return 0;

      const [day, month, year] = String(fechaStr).split("/").map(Number);
      const [h1, m1, s1] = String(horaInicioStr).split(":").map(Number);
      const [h2, m2, s2] = String(horaFinStr).split(":").map(Number);

      const inicio = new Date(year, month - 1, day, h1 || 0, m1 || 0, s1 || 0);
      const fin = new Date(year, month - 1, day, h2 || 0, m2 || 0, s2 || 0);

      const diff = fin.getTime() - inicio.getTime();
      return diff > 0 ? Math.round(diff / 60000) : 0;
    } catch (e) {
      return 0;
    }
  }

  function _round2_(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function _parseDateDdMmYyyy_(fechaStr) {
    const s = _toStr_(fechaStr);
    if (!s) return null;

    const parts = s.split("/");
    if (parts.length !== 3) return null;

    const day = Number(parts[0]);
    const month = Number(parts[1]);
    const year = Number(parts[2]);

    if (!day || !month || !year) return null;

    return new Date(year, month - 1, day, 0, 0, 0, 0);
  }

  function _startOfWeekMonday_(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + diff);
    return d;
  }

  function _endOfWeekSunday_(date) {
    const d = _startOfWeekMonday_(date);
    d.setDate(d.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  function _startOfMonth_(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  }

  function _endOfMonth_(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  function _isDateWithin_(dateObj, start, end) {
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return false;
    return dateObj.getTime() >= start.getTime() && dateObj.getTime() <= end.getTime();
  }

  function _getAuditoriaOrThrow_(idauditoria) {
    const audit = AuditoriaExcedentesRepository.getByIdAuditoria(_toStr_(idauditoria));
    if (!audit) {
      throw new Error(`No existe la auditoría ${idauditoria}`);
    }
    return audit;
  }

  function _buildConfigEstadoActual_(auditoria) {
    const tipo = _toUpper_(auditoria.tipoauditoria);
    const bodegaObjetivo = _toUpper_(auditoria.bodegaobjetivo);

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

  function _getUniversoEsperado_(auditoria) {
    return EstadoActualExcedentesService.getAuditables(
      _buildConfigEstadoActual_(auditoria)
    );
  }

  function _uniqueBy_(arr, mapper) {
    const seen = new Set();
    const out = [];

    (arr || []).forEach(item => {
      const key = mapper(item);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(item);
    });

    return out;
  }

  function _getConfiabilidadState_(valor) {
    const v = _toNum_(valor);

    if (v < CONFIABILIDAD.AMBER_MIN) {
      return {
        nivel: "RED",
        color: "red",
        label: "CRÍTICA",
        min: 0,
        max: 89.99
      };
    }

    if (v >= CONFIABILIDAD.EMERALD_MIN) {
      return {
        nivel: "EMERALD",
        color: "emerald",
        label: "CONTROLADA",
        min: 97,
        max: 100
      };
    }

    return {
      nivel: "AMBER",
      color: "amber",
      label: "ATENCIÓN",
      min: 90,
      max: 96.99
    };
  }

  function _summarizeConfiabilidad_(valor) {
    const pct = _round2_(valor);
    return {
      valor: pct,
      ..._getConfiabilidadState_(pct)
    };
  }

  function _inferirBodegaPorUbicacion_(ubicacion) {
    const u = _toUpper_(ubicacion);

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

  // =========================================================
  // RESUMEN / MÉTRICOS
  // =========================================================
  function _buildActualMetricsFromClosedLocations_(auditsInRange, bodegaFilter, allDetailOpt) {
    const allDetail = Array.isArray(allDetailOpt)
      ? allDetailOpt
      : AuditoriaExcedentesDetalleRepository.getAll();

    const auditIds = new Set((auditsInRange || []).map(x => _toStr_(x.idauditoria)));

    const markersClosed = allDetail.filter(item =>
      auditIds.has(_toStr_(item.idauditoria)) &&
      !item.idunico &&
      item.horainicioubicacion &&
      item.horafinubicacion &&
      (!bodegaFilter || _toUpper_(item.bodega) === _toUpper_(bodegaFilter))
    );

    const locationKeysClosed = new Set(
      markersClosed.map(m => `${_toStr_(m.idauditoria)}__${_toUpper_(m.ubicacion)}`)
    );

    const detailRows = allDetail.filter(item => {
      const key = `${_toStr_(item.idauditoria)}__${_toUpper_(item.ubicacion)}`;
      return (
        item.idunico &&
        locationKeysClosed.has(key) &&
        (!bodegaFilter || _toUpper_(item.bodega) === _toUpper_(bodegaFilter))
      );
    });

    const correctos = detailRows.filter(x => x.escorrecto === true).length;
    const faltantes = detailRows.filter(x => x.esfaltante === true).length;
    const sobrantes = detailRows.filter(x => x.essobrante === true).length;
    const esperados = correctos + faltantes;
    const escaneados = detailRows.filter(x => x.idunico && x.esfaltante !== true).length;

    const mapDiff = {};
    detailRows.forEach(item => {
      const key = `${_toStr_(item.idauditoria)}__${_toUpper_(item.ubicacion)}`;
      if (!mapDiff[key]) mapDiff[key] = false;
      if (item.esfaltante === true || item.essobrante === true) {
        mapDiff[key] = true;
      }
    });

    const ubicacionesAuditadas = locationKeysClosed.size;
    const ubicacionesConDiferencia = Object.values(mapDiff).filter(Boolean).length;

    const confiabilidad = esperados > 0
      ? _round2_((correctos / esperados) * 100)
      : 0;

    return {
      auditoriasCerradas: _uniqueBy_(auditsInRange || [], x => _toStr_(x.idauditoria)).length,
      ubicacionesAuditadas,
      ubicacionesConDiferencia,
      esperados,
      escaneados,
      correctos,
      faltantes,
      sobrantes,
      confiabilidad,
      confiabilidadState: _summarizeConfiabilidad_(confiabilidad)
    };
  }

  function _calcularMetricosAuditoriaDesdeDetalle_(idauditoria, options) {
    options = options || {};

    
    const audit = options.usarFresh && AuditoriaExcedentesRepository.getByIdAuditoriaFresh
      ? AuditoriaExcedentesRepository.getByIdAuditoriaFresh(idauditoria)
      : _getAuditoriaOrThrow_(idauditoria);

    if (!audit) {
      throw new Error(`No existe la auditoría ${idauditoria}`);
    }

    
    const detalle = options.usarFresh && AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh
      ? AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh(idauditoria)
      : AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria);


    const id = _toStr_(idauditoria);

    const markers = detalle.filter(x =>
      !x.idunico &&
      x.horainicioubicacion
    );

    const markersCerrados = markers.filter(x =>
      x.horainicioubicacion &&
      x.horafinubicacion
    );

    const markersAbiertos = markers.filter(x =>
      x.horainicioubicacion &&
      !x.horafinubicacion
    );

    const filasConId = detalle.filter(x => x.idunico);

    const correctosRows = filasConId.filter(x => x.escorrecto === true);
    const faltantesRows = filasConId.filter(x => x.esfaltante === true);
    const sobrantesRows = filasConId.filter(x => x.essobrante === true);
    const escaneadosRows = filasConId.filter(x => x.esfaltante !== true);

    const ubicacionesAuditadas = _uniqueBy_(
      markersCerrados.filter(x => x.ubicacion),
      x => _toUpper_(x.ubicacion)
    ).length;

    const ubicacionesAbiertas = _uniqueBy_(
      markersAbiertos.filter(x => x.ubicacion),
      x => _toUpper_(x.ubicacion)
    ).length;

    const ubicacionesConDiferencia = _uniqueBy_(
      filasConId.filter(x =>
        x.ubicacion &&
        (x.esfaltante === true || x.essobrante === true)
      ),
      x => _toUpper_(x.ubicacion)
    ).length;

    let esperados = _toNum_(audit.idunicosesperadostotales);

    if (!esperados && options.usarFallbackEsperados !== false) {
      esperados = correctosRows.length + faltantesRows.length;
    }

    const correctos = correctosRows.length;
    const faltantes = faltantesRows.length;
    const sobrantes = sobrantesRows.length;
    const escaneados = escaneadosRows.length;

    const confiabilidad = esperados > 0
      ? _round2_((correctos / esperados) * 100)
      : 0;

    return {
      idauditoria: id,

      ubicacionesauditadas: ubicacionesAuditadas,
      ubicacionesabiertas: ubicacionesAbiertas,
      ubicacionescondiferencia: ubicacionesConDiferencia,

      idunicosesperadostotales: esperados,
      idunicosescaneadostotales: escaneados,
      idunicoscorrectostotales: correctos,
      idunicosfaltantestotales: faltantes,
      idunicossobrantestotales: sobrantes,

      confiabilidadtotal: confiabilidad,
      confiabilidadState: _summarizeConfiabilidad_(confiabilidad),

      totalFilasDetalle: detalle.length,
      totalMarcadores: markers.length,
      totalMarcadoresCerrados: markersCerrados.length,
      totalMarcadoresAbiertos: markersAbiertos.length
    };
  }

  // =========================================================
  // API BASE
  // =========================================================
  function obtenerBootstrap() {
    const usuarios = (typeof UsuariosRepository !== "undefined" && UsuariosRepository.getAll)
      ? UsuariosRepository.getAll()
      : [];

    const resumenEstado = EstadoActualExcedentesService.getResumen();
    const bodegas = Array.isArray(resumenEstado.bodegasAuditables)
      ? resumenEstado.bodegasAuditables
      : [];

    const abiertas = AuditoriaExcedentesRepository.getAbiertas();
    const cerradas = AuditoriaExcedentesRepository.getCerradas();

    return {
      usuarios,
      bodegas,
      auditoriasAbiertas: abiertas,
      auditoriasCerradas: cerradas
    };
  }

  function abrirAuditoria(payload) {
    const auditor = _toUpper_(payload && payload.auditor);
    const tipoauditoria = _toUpper_(payload && payload.tipoauditoria) || TIPOS_AUDITORIA.GLOBAL;
    const bodegaobjetivo = tipoauditoria === TIPOS_AUDITORIA.POR_BODEGA
      ? _toUpper_(payload && payload.bodegaobjetivo)
      : "TODAS";
    const observaciones = _toStr_(payload && payload.observaciones);

    if (!auditor) {
      throw new Error("abrirAuditoria() requiere payload.auditor");
    }

    if (tipoauditoria !== TIPOS_AUDITORIA.GLOBAL && tipoauditoria !== TIPOS_AUDITORIA.POR_BODEGA) {
      throw new Error("TipoAuditoria inválido. Usa GLOBAL o POR_BODEGA");
    }

    if (tipoauditoria === TIPOS_AUDITORIA.POR_BODEGA && !bodegaobjetivo) {
      throw new Error("Para auditoría POR_BODEGA debes indicar bodegaobjetivo");
    }

    const idauditoria = _genIdAuditoria_();
    const fecha = _fmtDate_();
    const horainicio = _fmtTime_();

    const universo = EstadoActualExcedentesService.getAuditables({
      tipoAuditoria: tipoauditoria,
      bodegaObjetivo: tipoauditoria === TIPOS_AUDITORIA.GLOBAL ? "TODAS" : bodegaobjetivo
    });

    const insertado = AuditoriaExcedentesRepository.insert({
      idauditoria,
      fecha,
      horainicio,
      horafin: "",
      duracionmin: 0,
      auditor,
      tipoauditoria,
      bodegaobjetivo,
      estatus: STATUS.ABIERTA,
      ubicacionesauditadas: 0,
      ubicacionescondiferencia: 0,
      idunicosesperadostotales: universo.length,
      idunicosescaneadostotales: 0,
      idunicoscorrectostotales: 0,
      idunicosfaltantestotales: 0,
      idunicossobrantestotales: 0,
      confiabilidadtotal: 0,
      observaciones
    });

    return {
      ok: true,
      mensaje: "Auditoría abierta correctamente",
      auditoria: insertado,
      universoEsperadoInicial: {
        total: universo.length,
        bodegas: _uniqueBy_(universo, x => _toUpper_(x.bodegaActual)).map(x => _toUpper_(x.bodegaActual)),
        ubicaciones: _uniqueBy_(universo, x => _toUpper_(x.ubicacionActual)).map(x => _toUpper_(x.ubicacionActual))
      }
    };
  }

  function listarAuditorias(filtros) {
    const all = AuditoriaExcedentesRepository.getAll();

    const estatus = _toUpper_(filtros && filtros.estatus);
    const auditor = _toUpper_(filtros && filtros.auditor);
    const tipo = _toUpper_(filtros && filtros.tipoauditoria);
    const bodega = _toUpper_(filtros && filtros.bodegaobjetivo);

    return all.filter(item => {
      if (estatus && _toUpper_(item.estatus) !== estatus) return false;
      if (auditor && _toUpper_(item.auditor) !== auditor) return false;
      if (tipo && _toUpper_(item.tipoauditoria) !== tipo) return false;
      if (bodega && _toUpper_(item.bodegaobjetivo) !== bodega) return false;
      return true;
    });
  }

  function obtenerAuditoriaPorId(idauditoria) {
    return _getAuditoriaOrThrow_(idauditoria);
  }

  function obtenerAuditoriaActiva(idauditoria) {
    const audit = _getAuditoriaOrThrow_(idauditoria);
    const detalle = AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria);
    const resumen = recalcularResumen(idauditoria, { persistir: false });

    return {
      auditoria: {
        ...audit,
        ...resumen
      },
      detalle: detalle,
      resumen: resumen
    };
  }

  function recalcularResumen(idauditoria, options) {
    options = options || {};

    const persistir = !(options && options.persistir === false);
    const metricos = _calcularMetricosAuditoriaDesdeDetalle_(idauditoria, options);

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
      AuditoriaExcedentesRepository.updateByIdAuditoria(idauditoria, patch);
    }

    return {
      ...metricos,
      ...patch
    };
  }

  function cerrarAuditoria(payload) {
    const idauditoria = _toStr_(payload && payload.idauditoria);
    const observaciones = _toStr_(payload && payload.observaciones);
    const cerrarUbicacionesAbiertas = payload && payload.cerrarUbicacionesAbiertas !== false;

    const audit = _getAuditoriaOrThrow_(idauditoria);

    if (_toUpper_(audit.estatus) !== STATUS.ABIERTA) {
      throw new Error(`La auditoría ${idauditoria} ya no está ABIERTA`);
    }

    if (cerrarUbicacionesAbiertas) {
      const abiertas = AuditoriaExcedentesDetalleService.listarUbicacionesAbiertas(idauditoria);

      abiertas.forEach(item => {
        AuditoriaExcedentesDetalleService.cerrarUbicacion({
          idauditoria,
          ubicacion: item.ubicacion
        });
      });
    }

    const resumen = recalcularResumen(idauditoria, { persistir: false });
    const horafin = _fmtTime_();
    const duracionmin = _minutesDiff_(audit.fecha, audit.horainicio, horafin);

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
      console.warn("[LIVE] No se pudo limpiar LiveCache al cerrar auditoría desde Service principal:", e);
    }

    return {
      ok: true,
      mensaje: "Auditoría cerrada correctamente",
      auditoria: updated,
      resumen: resumen
    };
  }

  // =========================================================
  // ATAJOS A DETALLE
  // =========================================================
  function abrirUbicacion(payload) {
    return AuditoriaExcedentesDetalleService.abrirUbicacion(payload);
  }

  function registrarEscaneoIdUnico(payload) {
    const result = AuditoriaExcedentesDetalleService.registrarEscaneoIdUnico(payload || {});

    if (payload && payload.idauditoria && result && result.ok) {
      const resumen = recalcularResumen(payload.idauditoria, { persistir: true });
      result.auditSnapshot = resumen;
      result.resumenAuditoria = resumen;
    }

    return result;
  }

  function cerrarUbicacion(payload) {
    payload = payload || {};

    const result = AuditoriaExcedentesDetalleService.cerrarUbicacion(payload);

    if (payload.idauditoria) {
      const resumen = recalcularResumen(payload.idauditoria, { persistir: true });
      result.auditSnapshot = resumen;
      result.resumenAuditoria = resumen;
    }

    return result;
  }

  function obtenerDetalleUbicacion(idauditoria, ubicacion) {
    return AuditoriaExcedentesDetalleService.getDetalleUbicacion(idauditoria, ubicacion);
  }

  function obtenerDetalleAuditoria(idauditoria) {
    const audit = _getAuditoriaOrThrow_(idauditoria);
    const detalle = AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria);
    const resumen = recalcularResumen(idauditoria, { persistir: false });

    return {
      auditoria: {
        ...audit,
        ...resumen
      },
      resumen: resumen,
      detalle: detalle,
      ubicaciones: AuditoriaExcedentesDetalleService.listarUbicacionesAuditadas(idauditoria)
    };
  }

  // =========================================================
  // DASHBOARD
  // =========================================================
  function obtenerDashboardMetricos() {
    const now = _now_();

    const startWeek = _startOfWeekMonday_(now);
    const endWeek = _endOfWeekSunday_(now);

    const startMonth = _startOfMonth_(now);
    const endMonth = _endOfMonth_(now);

    const allAudits = AuditoriaExcedentesRepository.getAll();

    const abiertas = allAudits.filter(x => _toUpper_(x.estatus) === STATUS.ABIERTA);
    const cerradas = allAudits.filter(x => _toUpper_(x.estatus) === STATUS.CERRADA);

    const auditsWeek = cerradas.filter(a => {
      const fecha = _parseDateDdMmYyyy_(a.fecha);
      return _isDateWithin_(fecha, startWeek, endWeek);
    });

    const auditsMonth = cerradas.filter(a => {
      const fecha = _parseDateDdMmYyyy_(a.fecha);
      return _isDateWithin_(fecha, startMonth, endMonth);
    });

    const allDetailDashboard = AuditoriaExcedentesDetalleRepository.getAll();

    const auditIdsAbiertas = new Set(
      abiertas.map(a => _toStr_(a.idauditoria))
    );

    const allOpenLocations = allDetailDashboard
      .filter(item =>
        auditIdsAbiertas.has(_toStr_(item.idauditoria)) &&
        !item.idunico &&
        item.horainicioubicacion &&
        !item.horafinubicacion
      )
      .map(item => ({
        idauditoria: item.idauditoria,
        ubicacion: item.ubicacion,
        bodega: item.bodega,
        secuenciaubicacion: item.secuenciaubicacion,
        horainicioubicacion: item.horainicioubicacion
      }));

    const semanalEjercicio = _buildActualMetricsFromClosedLocations_(
      auditsWeek,
      null,
      allDetailDashboard
    );

    const mensualEjercicio = _buildActualMetricsFromClosedLocations_(
      auditsMonth,
      null,
      allDetailDashboard
    );

    let bodegasUniverse = [];

    try {
      const resumenEstado = EstadoActualExcedentesService.getResumen() || {};
      bodegasUniverse = Array.isArray(resumenEstado.bodegasAuditables)
        ? resumenEstado.bodegasAuditables
        : [];
    } catch (e) {
      console.warn("[AuditoriaExcedentesService] No se pudo obtener resumen de EstadoActual:", e);
      bodegasUniverse = [];
    }

    const bodegas = _uniqueBy_(
      [
        ...bodegasUniverse.map(x => ({ bodega: _toUpper_(x) })),
        ...allDetailDashboard
          .filter(x => x.bodega)
          .map(x => ({ bodega: _toUpper_(x.bodega) })),
        ...allAudits
          .filter(x => x.bodegaobjetivo && _toUpper_(x.bodegaobjetivo) !== "TODAS")
          .map(x => ({ bodega: _toUpper_(x.bodegaobjetivo) }))
      ],
      x => x.bodega
    )
      .map(x => x.bodega)
      .filter(Boolean)
      .sort((a, b) => String(a).localeCompare(String(b), "es", {
        sensitivity: "base",
        numeric: true
      }));

    const porBodega = bodegas.map(bodega => {
      const semanal = _buildActualMetricsFromClosedLocations_(auditsWeek, bodega, allDetailDashboard);
      const mensual = _buildActualMetricsFromClosedLocations_(auditsMonth, bodega, allDetailDashboard);

      return {
        bodega: bodega,
        semanalActual: {
          auditoriasCerradas: semanal.auditoriasCerradas,
          ubicacionesAuditadas: semanal.ubicacionesAuditadas,
          ubicacionesConDiferencia: semanal.ubicacionesConDiferencia,
          esperados: semanal.esperados,
          escaneados: semanal.escaneados,
          correctos: semanal.correctos,
          faltantes: semanal.faltantes,
          sobrantes: semanal.sobrantes,
          confiabilidad: semanal.confiabilidad,
          confiabilidadState: semanal.confiabilidadState
        },
        mensualActual: {
          auditoriasCerradas: mensual.auditoriasCerradas,
          ubicacionesAuditadas: mensual.ubicacionesAuditadas,
          ubicacionesConDiferencia: mensual.ubicacionesConDiferencia,
          esperados: mensual.esperados,
          escaneados: mensual.escaneados,
          correctos: mensual.correctos,
          faltantes: mensual.faltantes,
          sobrantes: mensual.sobrantes,
          confiabilidad: mensual.confiabilidad,
          confiabilidadState: mensual.confiabilidadState
        }
      };
    });

    const bodegaMasCriticaSemana = [...porBodega]
      .filter(x => x.semanalActual.esperados > 0)
      .sort((a, b) => a.semanalActual.confiabilidad - b.semanalActual.confiabilidad)[0] || null;

    const bodegaMasCriticaMes = [...porBodega]
      .filter(x => x.mensualActual.esperados > 0)
      .sort((a, b) => a.mensualActual.confiabilidad - b.mensualActual.confiabilidad)[0] || null;

    const bodegaMejorSemana = [...porBodega]
      .filter(x => x.semanalActual.esperados > 0)
      .sort((a, b) => b.semanalActual.confiabilidad - a.semanalActual.confiabilidad)[0] || null;

    const bodegaMejorMes = [...porBodega]
      .filter(x => x.mensualActual.esperados > 0)
      .sort((a, b) => b.mensualActual.confiabilidad - a.mensualActual.confiabilidad)[0] || null;

    return {
      fechaCorte: {
        fecha: _fmtDate_(now),
        hora: _fmtTime_(now),
        semana: {
          inicio: _fmtDate_(startWeek),
          fin: _fmtDate_(endWeek)
        },
        mes: {
          inicio: _fmtDate_(startMonth),
          fin: _fmtDate_(endMonth)
        }
      },

      resumenGlobal: {
        auditoriasAbiertas: abiertas.length,
        auditoriasCerradasSemanaActual: auditsWeek.length,
        auditoriasCerradasMesActual: auditsMonth.length,
        ubicacionesAbiertas: allOpenLocations.length,

        confiabilidadSemanalActualEjercicio: semanalEjercicio.confiabilidad,
        confiabilidadSemanalActualEjercicioState: semanalEjercicio.confiabilidadState,

        confiabilidadMensualActualEjercicio: mensualEjercicio.confiabilidad,
        confiabilidadMensualActualEjercicioState: mensualEjercicio.confiabilidadState,

        faltantesSemanaActual: semanalEjercicio.faltantes,
        sobrantesSemanaActual: semanalEjercicio.sobrantes,
        ubicacionesConDiferenciaSemanaActual: semanalEjercicio.ubicacionesConDiferencia,

        faltantesMesActual: mensualEjercicio.faltantes,
        sobrantesMesActual: mensualEjercicio.sobrantes,
        ubicacionesConDiferenciaMesActual: mensualEjercicio.ubicacionesConDiferencia,

        esperadosSemanaActual: semanalEjercicio.esperados,
        correctosSemanaActual: semanalEjercicio.correctos,
        esperadosMesActual: mensualEjercicio.esperados,
        correctosMesActual: mensualEjercicio.correctos
      },

      destacados: {
        bodegaMasCriticaSemana: bodegaMasCriticaSemana,
        bodegaMasCriticaMes: bodegaMasCriticaMes,
        bodegaMejorSemana: bodegaMejorSemana,
        bodegaMejorMes: bodegaMejorMes
      },

      porBodega: porBodega
    };
  }

  // =========================================================
  // DETALLE AUDITORÍA EN VIVO
  // =========================================================
  function _aecLive_timeToSeconds_(value) {
    const s = _toStr_(value);
    if (!s) return null;

    const parts = s.split(":").map(Number);
    if (parts.length < 2) return null;

    const h = parts[0] || 0;
    const m = parts[1] || 0;
    const sec = parts[2] || 0;

    return h * 3600 + m * 60 + sec;
  }

  function _aecLive_diffMinutesByTime_(horaInicio, horaFin) {
    const ini = _aecLive_timeToSeconds_(horaInicio);
    const fin = _aecLive_timeToSeconds_(horaFin || _fmtTime_());

    if (ini == null || fin == null) return 0;

    let diff = fin - ini;
    if (diff < 0) diff += 24 * 3600;

    return _round2_(diff / 60);
  }

  function _aecLive_safePct_(num, den) {
    const n = _toNum_(num);
    const d = _toNum_(den);
    if (!d) return 0;
    return _round2_((n / d) * 100);
  }

  function _aecLive_buildEsperadosPorUbicacion_(audit) {
    const universo = _getUniversoEsperado_(audit) || [];
    const map = {};

    universo.forEach(row => {
      const ubicacion = _toUpper_(row.ubicacionActual || row.ubicacion || "");
      const idunico = _toStr_(row.idUnico || row.idunico || "");

      if (!ubicacion || !idunico) return;

      if (!map[ubicacion]) {
        map[ubicacion] = {
          ubicacion: ubicacion,
          bodega: _toUpper_(
            row.bodegaActual ||
            row.bodega ||
            _inferirBodegaPorUbicacion_(ubicacion)
          ),
          totalEsperados: 0,
          ids: {}
        };
      }

      map[ubicacion].totalEsperados++;
      map[ubicacion].ids[idunico] = true;
    });

    return map;
  }

  function _aecLive_buildUbicacionesEnVivo_(idauditoria) {
    const audit = _getAuditoriaOrThrow_(idauditoria);
    const detalle = AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria) || [];
    const esperadosMap = _aecLive_buildEsperadosPorUbicacion_(audit);

    const map = {};

    function ensureUbicacion_(ubicacion, bodega) {
      const ubi = _toUpper_(ubicacion);
      if (!ubi) return null;

      if (!map[ubi]) {
        const esperadoInfo = esperadosMap[ubi] || {};

        map[ubi] = {
          key: ubi,
          idauditoria: _toStr_(idauditoria),
          ubicacion: ubi,
          bodega: _toUpper_(
            bodega ||
            esperadoInfo.bodega ||
            _inferirBodegaPorUbicacion_(ubi)
          ),
          secuenciaubicacion: 0,

          abierta: false,
          cerrada: false,
          estadoOperativo: "SIN_INICIAR",
          estadoRitmo: "SIN_INICIAR",

          horainicioubicacion: "",
          horafinubicacion: "",

          esperados: _toNum_(esperadoInfo.totalEsperados),
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
          totalFilas: 0
        };
      }

      return map[ubi];
    }

    detalle.forEach(row => {
      const ubicacion = _toUpper_(row.ubicacion || "");
      if (!ubicacion) return;

      const item = ensureUbicacion_(ubicacion, row.bodega);
      if (!item) return;

      item.secuenciaubicacion = Math.max(
        _toNum_(item.secuenciaubicacion),
        _toNum_(row.secuenciaubicacion)
      );

      if (!row.idunico && row.horainicioubicacion) {
        item.abierta = true;
        item.horainicioubicacion = row.horainicioubicacion || item.horainicioubicacion;

        if (row.horafinubicacion) {
          item.cerrada = true;
          item.horafinubicacion = row.horafinubicacion;
        }

        return;
      }

      if (!row.idunico) return;

      item.totalFilas++;

      if (row.escorrecto === true) item.correctos++;
      if (row.esfaltante === true) item.faltantes++;
      if (row.essobrante === true) item.sobrantes++;
      if (row.esfaltante !== true) item.escaneados++;
    });

    Object.keys(map).forEach(ubicacion => {
      const item = map[ubicacion];

      item.tieneDiferencia = item.faltantes > 0 || item.sobrantes > 0;

      if (item.cerrada) {
        item.esperados = item.correctos + item.faltantes;
        item.pendientes = 0;
        item.avancePct = 100;
        item.avanceTrabajoPct = 100;

        item.estadoOperativo = item.tieneDiferencia
          ? "CERRADA_CON_DIFERENCIA"
          : "CERRADA_CORRECTA";

      } else if (item.abierta) {
        item.pendientes = Math.max(item.esperados - item.correctos, 0);
        item.avancePct = _aecLive_safePct_(item.correctos, item.esperados);
        item.avanceTrabajoPct = _aecLive_safePct_(item.escaneados, item.esperados);
        item.estadoOperativo = "EN_PROCESO";

      } else {
        item.pendientes = item.esperados;
        item.avancePct = 0;
        item.avanceTrabajoPct = 0;
        item.estadoOperativo = "SIN_INICIAR";
      }

      const horaFinCalculo = item.cerrada
        ? item.horafinubicacion
        : _fmtTime_();

      item.minutosTranscurridos = item.horainicioubicacion
        ? _aecLive_diffMinutesByTime_(item.horainicioubicacion, horaFinCalculo)
        : 0;

      item.escaneosPorMinuto = item.minutosTranscurridos > 0
        ? _round2_(item.escaneados / item.minutosTranscurridos)
        : 0;

      item.correctosPorMinuto = item.minutosTranscurridos > 0
        ? _round2_(item.correctos / item.minutosTranscurridos)
        : 0;

      item.minutosEstimadosRestantes =
        item.abierta && !item.cerrada && item.correctosPorMinuto > 0
          ? _round2_(item.pendientes / item.correctosPorMinuto)
          : 0;

      if (item.abierta && !item.cerrada) {
        if (item.correctosPorMinuto === 0 && item.minutosTranscurridos >= 5) {
          item.estadoRitmo = "DETENIDO";
        } else if (item.correctosPorMinuto < 2 && item.minutosTranscurridos >= 3) {
          item.estadoRitmo = "CRITICO";
        } else if (item.correctosPorMinuto < 3 && item.minutosTranscurridos >= 3) {
          item.estadoRitmo = "LENTO";
        } else {
          item.estadoRitmo = "A_TIEMPO";
        }
      } else if (item.cerrada) {
        item.estadoRitmo = "FINALIZADO";
      } else {
        item.estadoRitmo = "SIN_INICIAR";
      }
    });

    return Object.values(map)
      .filter(x => x.abierta || x.cerrada)
      .sort((a, b) => {
        const seq = _toNum_(a.secuenciaubicacion) - _toNum_(b.secuenciaubicacion);
        if (seq !== 0) return seq;

        return String(a.ubicacion).localeCompare(String(b.ubicacion), "es", {
          numeric: true,
          sensitivity: "base"
        });
      });
  }

  function _aecLive_buildUbicacionesEnVivoFresh_(idauditoria, audit, detalle) {
    const safeAudit = audit || _getAuditoriaOrThrow_(idauditoria);
    const safeDetalle = Array.isArray(detalle)
      ? detalle
      : AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh
      ? AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh(idauditoria)
      : AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria) || [];

    const esperadosMap = _aecLive_buildEsperadosPorUbicacion_(safeAudit);
    const map = {};

    function ensureUbicacion_(ubicacion, bodega) {
      const ubi = _toUpper_(ubicacion);
      if (!ubi) return null;

      if (!map[ubi]) {
        const esperadoInfo = esperadosMap[ubi] || {};

        map[ubi] = {
          key: ubi,
          idauditoria: _toStr_(idauditoria),
          ubicacion: ubi,
          bodega: _toUpper_(
            bodega ||
            esperadoInfo.bodega ||
            _inferirBodegaPorUbicacion_(ubi)
          ),
          secuenciaubicacion: 0,

          abierta: false,
          cerrada: false,
          estadoOperativo: "SIN_INICIAR",
          estadoRitmo: "SIN_INICIAR",

          horainicioubicacion: "",
          horafinubicacion: "",

          esperados: _toNum_(esperadoInfo.totalEsperados),
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
          totalFilas: 0
        };
      }

      return map[ubi];
    }

    safeDetalle.forEach(row => {
      const ubicacion = _toUpper_(row.ubicacion || "");
      if (!ubicacion) return;

      const item = ensureUbicacion_(ubicacion, row.bodega);
      if (!item) return;

      item.secuenciaubicacion = Math.max(
        _toNum_(item.secuenciaubicacion),
        _toNum_(row.secuenciaubicacion)
      );

      if (!row.idunico && row.horainicioubicacion) {
        item.abierta = true;
        item.horainicioubicacion = row.horainicioubicacion || item.horainicioubicacion;

        if (row.horafinubicacion) {
          item.cerrada = true;
          item.horafinubicacion = row.horafinubicacion;
        }

        return;
      }

      if (!row.idunico) return;

      item.totalFilas++;

      if (row.escorrecto === true) item.correctos++;
      if (row.esfaltante === true) item.faltantes++;
      if (row.essobrante === true) item.sobrantes++;
      if (row.esfaltante !== true) item.escaneados++;
    });

    Object.keys(map).forEach(ubicacion => {
      const item = map[ubicacion];

      item.tieneDiferencia = item.faltantes > 0 || item.sobrantes > 0;

      if (item.cerrada) {
        item.esperados = item.correctos + item.faltantes;
        item.pendientes = 0;
        item.avancePct = 100;
        item.avanceTrabajoPct = 100;

        item.estadoOperativo = item.tieneDiferencia
          ? "CERRADA_CON_DIFERENCIA"
          : "CERRADA_CORRECTA";

      } else if (item.abierta) {
        item.pendientes = Math.max(item.esperados - item.correctos, 0);
        item.avancePct = _aecLive_safePct_(item.correctos, item.esperados);
        item.avanceTrabajoPct = _aecLive_safePct_(item.escaneados, item.esperados);
        item.estadoOperativo = "EN_PROCESO";

      } else {
        item.pendientes = item.esperados;
        item.avancePct = 0;
        item.avanceTrabajoPct = 0;
        item.estadoOperativo = "SIN_INICIAR";
      }

      const horaFinCalculo = item.cerrada
        ? item.horafinubicacion
        : _fmtTime_();

      item.minutosTranscurridos = item.horainicioubicacion
        ? _aecLive_diffMinutesByTime_(item.horainicioubicacion, horaFinCalculo)
        : 0;

      item.escaneosPorMinuto = item.minutosTranscurridos > 0
        ? _round2_(item.escaneados / item.minutosTranscurridos)
        : 0;

      item.correctosPorMinuto = item.minutosTranscurridos > 0
        ? _round2_(item.correctos / item.minutosTranscurridos)
        : 0;

      item.minutosEstimadosRestantes =
        item.abierta && !item.cerrada && item.correctosPorMinuto > 0
          ? _round2_(item.pendientes / item.correctosPorMinuto)
          : 0;

      if (item.abierta && !item.cerrada) {
        if (item.correctosPorMinuto === 0 && item.minutosTranscurridos >= 5) {
          item.estadoRitmo = "DETENIDO";
        } else if (item.correctosPorMinuto < 2 && item.minutosTranscurridos >= 3) {
          item.estadoRitmo = "CRITICO";
        } else if (item.correctosPorMinuto < 3 && item.minutosTranscurridos >= 3) {
          item.estadoRitmo = "LENTO";
        } else {
          item.estadoRitmo = "A_TIEMPO";
        }
      } else if (item.cerrada) {
        item.estadoRitmo = "FINALIZADO";
      } else {
        item.estadoRitmo = "SIN_INICIAR";
      }
    });

    return Object.values(map)
      .filter(x => x.abierta || x.cerrada)
      .sort((a, b) => {
        const seq = _toNum_(a.secuenciaubicacion) - _toNum_(b.secuenciaubicacion);
        if (seq !== 0) return seq;

        return String(a.ubicacion).localeCompare(String(b.ubicacion), "es", {
          numeric: true,
          sensitivity: "base"
        });
      });
  }

  function obtenerDetalleAuditoriaEnVivo(idauditoria) {
    const audit = _getAuditoriaOrThrow_(idauditoria);

    const detalle = AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh
      ? AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh(idauditoria)
      : AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria) || [];

    const resumen = recalcularResumen(idauditoria, {
      persistir: false,
      usarFresh: true
    });

    const ubicacionesEnVivo = _aecLive_buildUbicacionesEnVivoFresh_(idauditoria, audit, detalle);


    return {
      ok: true,
      source: "SHEETS_FULL",

      auditoria: {
        ...audit,
        ...resumen
      },

      resumen: resumen,

      resumenOperativo: _aecLive_resumenOperativoDesdeUbicaciones_(ubicacionesEnVivo),

      detalle: detalle,

      ubicaciones: AuditoriaExcedentesDetalleService.listarUbicacionesAuditadas(idauditoria),

      ubicacionesEnVivo: ubicacionesEnVivo,

      generadoEn: {
        fecha: _fmtDate_(),
        hora: _fmtTime_()
      }
    };
  }

  // =========================================================
  // PULSO LIGERO EN VIVO
  // =========================================================
  function _pulso_timeToSeconds_(value) {
    const s = _toStr_(value);
    if (!s) return null;

    const parts = s.split(":").map(Number);
    if (parts.length < 2) return null;

    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  }

  function _pulso_diffMinutes_(horaInicio, horaFin) {
    const ini = _pulso_timeToSeconds_(horaInicio);
    const fin = _pulso_timeToSeconds_(horaFin || _fmtTime_());

    if (ini == null || fin == null) return 0;

    let diff = fin - ini;
    if (diff < 0) diff += 24 * 3600;

    return _round2_(diff / 60);
  }

  function _pulso_pct_(num, den) {
    const n = _toNum_(num);
    const d = _toNum_(den);
    if (!d) return 0;
    return _round2_((n / d) * 100);
  }

  function _pulso_getEsperadosUbicacion_(audit, ubicacion) {
    const cache = CacheService.getScriptCache();
    const idAudit = _toStr_(audit.idauditoria);
    const ubi = _toUpper_(ubicacion);
    const key = "AEC_EXPECTED_UBI_" + idAudit + "_" + ubi;

    const cached = cache.get(key);
    if (cached !== null && cached !== "") {
      return _toNum_(cached);
    }

    const universo = _getUniversoEsperado_(audit) || [];

    const total = universo.filter(row => {
      return _toUpper_(row.ubicacionActual || row.ubicacion || "") === ubi;
    }).length;

    cache.put(key, String(total), 21600);
    return total;
  }

  function _aecLive_resumenOperativoDesdeUbicaciones_(ubicacionesEnVivo) {
    const lista = Array.isArray(ubicacionesEnVivo) ? ubicacionesEnVivo : [];

    const abiertas = lista.filter(x => x.abierta && !x.cerrada);
    const cerradas = lista.filter(x => x.cerrada);

    const esperadosVivos = lista.reduce((acc, x) => acc + _toNum_(x.esperados), 0);
    const correctosVivos = lista.reduce((acc, x) => acc + _toNum_(x.correctos), 0);
    const escaneadosVivos = lista.reduce((acc, x) => acc + _toNum_(x.escaneados), 0);
    const pendientesVivos = lista.reduce((acc, x) => acc + _toNum_(x.pendientes), 0);
    const sobrantesVivos = lista.reduce((acc, x) => acc + _toNum_(x.sobrantes), 0);
    const faltantesOficiales = lista.reduce((acc, x) => acc + _toNum_(x.faltantes), 0);
    const minutosActivos = abiertas.reduce((acc, x) => acc + _toNum_(x.minutosTranscurridos), 0);

    return {
      ubicacionesTocadas: lista.length,
      ubicacionesAbiertas: abiertas.length,
      ubicacionesCerradas: cerradas.length,

      esperadosVivos,
      correctosVivos,
      escaneadosVivos,
      pendientesVivos,
      sobrantesVivos,
      faltantesOficiales,

      avanceVivoPct: _pulso_pct_(correctosVivos, esperadosVivos),
      avanceTrabajoPct: _pulso_pct_(escaneadosVivos, esperadosVivos),

      minutosActivos: _round2_(minutosActivos),
      escaneosPorMinuto: minutosActivos > 0
        ? _round2_(escaneadosVivos / minutosActivos)
        : 0,
      correctosPorMinuto: minutosActivos > 0
        ? _round2_(correctosVivos / minutosActivos)
        : 0,

      ubicacionesLentas: lista.filter(x => x.estadoRitmo === "LENTO").length,
      ubicacionesCriticas: lista.filter(x => x.estadoRitmo === "CRITICO").length,
      ubicacionesDetenidas: lista.filter(x => x.estadoRitmo === "DETENIDO").length
    };
  }

  function _aecLive_debeIgnorarCachePorDetalleVacio_(idauditoria, live) {
    try {
      if (!live) return false;

      const ubicacionesLive = Array.isArray(live.ubicacionesEnVivo)
        ? live.ubicacionesEnVivo.length
        : 0;

      if (ubicacionesLive <= 0) return false;

      const id = _toStr_(idauditoria);
      const cache = CacheService.getScriptCache();
      const sanityKey = "AEC_LIVE_SANITY_EMPTY_DETAIL_" + id;

      const sanityCached = cache.get(sanityKey);

      if (sanityCached === "OK") {
        return false;
      }

      const detalle = AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh
        ? AuditoriaExcedentesDetalleRepository.getByIdAuditoriaFresh(id)
        : AuditoriaExcedentesDetalleRepository.getByIdAuditoria(id) || [];

      if (!detalle.length) {
        try {
          if (typeof AuditoriaExcedentesLiveCache !== "undefined") {
            AuditoriaExcedentesLiveCache.clear(id);
          }
        } catch (clearErr) {
          console.warn("[LIVE] No se pudo limpiar LiveCache obsoleto:", clearErr);
        }

        console.warn("[LIVE] Cache ignorado y limpiado porque detalle está vacío:", id);

        cache.put(sanityKey, "CLEARED", 10);
        return true;
      }

      cache.put(sanityKey, "OK", 10);
      return false;

    } catch (e) {
      console.warn("[LIVE] Error validando cache contra detalle vacío:", e);
      return false;
    }
  }

  function _aecLive_mergePulsoLiveConSheets_(idauditoria, live) {
    const id = _toStr_(idauditoria);

    const audit = _getAuditoriaOrThrow_(id);
    const resumen = recalcularResumen(id, { persistir: false });

    const ubicacionesSheets = _aecLive_buildUbicacionesEnVivo_(id) || [];

    const ubicacionesLive = Array.isArray(live && live.ubicacionesEnVivo)
      ? live.ubicacionesEnVivo
      : [];

    const map = {};

    ubicacionesSheets.forEach(u => {
      const key = _toUpper_(u.key || u.ubicacion || "");
      if (!key) return;
      map[key] = u;
    });

    ubicacionesLive.forEach(u => {
      const key = _toUpper_(u.key || u.ubicacion || "");
      if (!key) return;

      const base = map[key] || {};

      map[key] = {
        ...base,
        ...u,
        idauditoria: id,
        key: key,
        ubicacion: _toUpper_(u.ubicacion || base.ubicacion || key),
        bodega: _toUpper_(u.bodega || base.bodega || _inferirBodegaPorUbicacion_(key)),
        secuenciaubicacion: _toNum_(u.secuenciaubicacion || base.secuenciaubicacion)
      };
    });

    const ubicacionesEnVivo = Object.values(map)
      .filter(x => x.abierta || x.cerrada)
      .sort((a, b) => {
        const seq = _toNum_(a.secuenciaubicacion) - _toNum_(b.secuenciaubicacion);
        if (seq !== 0) return seq;

        return String(a.ubicacion).localeCompare(String(b.ubicacion), "es", {
          numeric: true,
          sensitivity: "base"
        });
      });

    return {
      ok: true,
      source: "CACHE_LIVE_MERGED_SHEETS",
      schema: live && live.schema ? live.schema : "AEC_LIVE_V3",
      idauditoria: id,
      version: live && live.version ? live.version : 0,

      auditoria: {
        ...audit,
        ...resumen
      },

      resumen: resumen,

      resumenOperativo: _aecLive_resumenOperativoDesdeUbicaciones_(ubicacionesEnVivo),

      ubicacionesEnVivo: ubicacionesEnVivo,

      generadoEn: {
        fecha: _fmtDate_(),
        hora: _fmtTime_()
      }
    };
  }

  function obtenerPulsoAuditoriaEnVivo(idauditoria) {
    const id = _toStr_(idauditoria);

    if (!id) {
      return {
        ok: false,
        source: "SIN_IDAUDITORIA",
        idauditoria: "",
        resumenOperativo: {},
        ubicacionesEnVivo: [],
        generadoEn: {
          fecha: _fmtDate_(),
          hora: _fmtTime_()
        }
      };
    }

    if (typeof AuditoriaExcedentesLiveCache !== "undefined") {
      try {
        const live = AuditoriaExcedentesLiveCache.getPulso(id);

        if (
          live &&
          live.resumenOperativo &&
          Number(live.resumenOperativo.ubicacionesTocadas || 0) > 0
        ) {
          if (!_aecLive_debeIgnorarCachePorDetalleVacio_(id, live)) {
            return {
              ...live,
              source: live.source || "CACHE_LIVE"
            };
          }
        }
      } catch (e) {
        console.warn("[LIVE] No se pudo leer pulso desde LiveCache:", e);
      }
    }

    /**
     * IMPORTANTE:
     * El pulso NO debe consultar Sheets.
     * Si no hay LiveCache, la vista conserva lo que ya tiene
     * y el full refresh se encarga de sincronizar.
     */
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

  return {
    // base
    obtenerBootstrap,
    abrirAuditoria,
    listarAuditorias,
    obtenerAuditoriaPorId,
    obtenerAuditoriaActiva,
    obtenerDetalleAuditoriaEnVivo,
    obtenerPulsoAuditoriaEnVivo,
    recalcularResumen,
    cerrarAuditoria,

    // detalle
    abrirUbicacion,
    registrarEscaneoIdUnico,
    cerrarUbicacion,
    obtenerDetalleUbicacion,
    obtenerDetalleAuditoria,

    // dashboard
    obtenerDashboardMetricos
  };

})();