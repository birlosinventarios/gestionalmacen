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
    const day = d.getDay(); // 0=domingo, 1=lunes
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

  function _getLocationMarkersClosedByAuditsInRange_(auditsInRange) {
    const allDetail = AuditoriaExcedentesDetalleRepository.getAll();
    const auditIds = new Set(auditsInRange.map(x => _toStr_(x.idauditoria)));

    return allDetail.filter(item =>
      auditIds.has(_toStr_(item.idauditoria)) &&
      !item.idunico &&
      item.horainicioubicacion &&
      item.horafinubicacion
    );
  }

  function _buildActualMetricsFromClosedLocations_(auditsInRange, bodegaFilter) {
    const allDetail = AuditoriaExcedentesDetalleRepository.getAll();
    const auditIds = new Set(auditsInRange.map(x => _toStr_(x.idauditoria)));

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

    // Esperados reales de una ubicación cerrada:
    // correctos + faltantes
    const esperados = correctos + faltantes;

    // Escaneados reales:
    // correctos + sobrantes
    const escaneados = detailRows.filter(x => x.idunico && x.esfaltante !== true).length;

    const mapDiff = {};
    detailRows.forEach(item => {
      const key = `${_toStr_(item.idauditoria)}__${_toUpper_(item.ubicacion)}`;
      if (!mapDiff[key]) {
        mapDiff[key] = false;
      }
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
      auditoriasCerradas: _uniqueBy_(auditsInRange, x => _toStr_(x.idauditoria)).length,
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

  // =========================================================
  // API PÚBLICA BASE
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
      auditoria: audit,
      detalle,
      resumen
    };
  }

  function recalcularResumen(idauditoria, options) {
    const persistir = !(options && options.persistir === false);
    const audit = _getAuditoriaOrThrow_(idauditoria);

    const universoEsperado = _getUniversoEsperado_(audit);
    const detalle = AuditoriaExcedentesDetalleRepository.getByIdAuditoria(idauditoria);

    const esperados = universoEsperado.length;
    const escaneados = detalle.filter(x => x.idunico && !x.esfaltante).length;
    const correctos = detalle.filter(x => x.idunico && x.escorrecto === true).length;
    const faltantes = detalle.filter(x => x.esfaltante === true).length;
    const sobrantes = detalle.filter(x => x.essobrante === true).length;

    const ubicacionesAuditadas = _uniqueBy_(
      detalle.filter(x => x.ubicacion),
      x => _toUpper_(x.ubicacion)
    ).length;

    const ubicacionesConDiferencia = _uniqueBy_(
      detalle.filter(x => x.ubicacion && (x.esfaltante === true || x.essobrante === true)),
      x => _toUpper_(x.ubicacion)
    ).length;

    const confiabilidad = esperados > 0
      ? _round2_((correctos / esperados) * 100)
      : 0;

    const patch = {
      ubicacionesauditadas: ubicacionesAuditadas,
      ubicacionescondiferencia: ubicacionesConDiferencia,
      idunicosesperadostotales: esperados,
      idunicosescaneadostotales: escaneados,
      idunicoscorrectostotales: correctos,
      idunicosfaltantestotales: faltantes,
      idunicossobrantestotales: sobrantes,
      confiabilidadtotal: confiabilidad
    };

    if (persistir) {
      AuditoriaExcedentesRepository.updateByIdAuditoria(idauditoria, patch);
    }

    return {
      idauditoria: _toStr_(idauditoria),
      ...patch,
      confiabilidadState: _summarizeConfiabilidad_(confiabilidad)
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
    return AuditoriaExcedentesDetalleService.registrarEscaneoIdUnico(payload);
  }

  function cerrarUbicacion(payload) {
    const result = AuditoriaExcedentesDetalleService.cerrarUbicacion(payload);
    recalcularResumen(payload.idauditoria, { persistir: true });
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
      auditoria: audit,
      resumen: resumen,
      detalle: detalle,
      ubicaciones: AuditoriaExcedentesDetalleService.listarUbicacionesAuditadas(idauditoria)
    };
  }

  // =========================================================
  // MÉTRICOS DE DASHBOARD
  // =========================================================

  /**
   * Dashboard principal con:
   * - auditorías abiertas
   * - ubicaciones abiertas
   * - confiabilidad semanal actual (ejercicio)
   * - confiabilidad mensual actual (ejercicio)
   * - faltantes / sobrantes semana y mes
   * - ubicaciones con diferencia semana y mes
   * - desglose por bodega
   */
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

    const allOpenLocations = abiertas.flatMap(a =>
      AuditoriaExcedentesDetalleService.listarUbicacionesAbiertas(a.idauditoria)
        .map(x => ({
          ...x,
          idauditoria: a.idauditoria
        }))
    );

    const semanalEjercicio = _buildActualMetricsFromClosedLocations_(auditsWeek, null);
    const mensualEjercicio = _buildActualMetricsFromClosedLocations_(auditsMonth, null);

    const bodegasUniverse = EstadoActualExcedentesService.getResumen().bodegasAuditables || [];
    const bodegas = _uniqueBy_(
      [
        ...bodegasUniverse.map(x => ({ bodega: _toUpper_(x) })),
        ...AuditoriaExcedentesDetalleRepository.getAll()
          .filter(x => x.bodega)
          .map(x => ({ bodega: _toUpper_(x.bodega) }))
      ],
      x => x.bodega
    )
      .map(x => x.bodega)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base", numeric: true }));

    const porBodega = bodegas.map(bodega => {
      const semanal = _buildActualMetricsFromClosedLocations_(auditsWeek, bodega);
      const mensual = _buildActualMetricsFromClosedLocations_(auditsMonth, bodega);

      return {
        bodega,
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

  return {
    // base
    obtenerBootstrap,
    abrirAuditoria,
    listarAuditorias,
    obtenerAuditoriaPorId,
    obtenerAuditoriaActiva,
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

/**
 * =========================================================
 * DEBUGGERS
 * =========================================================
 */

function debugAuditoriaExcedentesService_abrirAuditoria() {
  return AuditoriaExcedentesService.abrirAuditoria({
    auditor: "PRUEBA SISTEMA",
    tipoauditoria: "GLOBAL",
    bodegaobjetivo: "TODAS",
    observaciones: "PRUEBA DE APERTURA"
  });
}

function debugAuditoriaExcedentesService_obtenerBootstrap() {
  return AuditoriaExcedentesService.obtenerBootstrap();
}

function debugAuditoriaExcedentesService_listarAuditorias() {
  return AuditoriaExcedentesService.listarAuditorias({});
}

function debugAuditoriaExcedentesService_obtenerAuditoriaPorId() {
  return AuditoriaExcedentesService.obtenerAuditoriaPorId("AUD-PRUEBA-001");
}

function debugAuditoriaExcedentesService_recalcularResumen() {
  return AuditoriaExcedentesService.recalcularResumen("AUD-PRUEBA-001", { persistir: false });
}

function debugAuditoriaExcedentesService_cerrarAuditoria() {
  return AuditoriaExcedentesService.cerrarAuditoria({
    idauditoria: "AUD-PRUEBA-001",
    observaciones: "CIERRE DE PRUEBA"
  });
}

function debugAuditoriaExcedentesService_obtenerDashboardMetricos() {
  const data = AuditoriaExcedentesService.obtenerDashboardMetricos();
  console.log("[DEBUG] AuditoriaExcedentesService.obtenerDashboardMetricos");
  console.log(JSON.stringify(data, null, 2));
  return data;
}