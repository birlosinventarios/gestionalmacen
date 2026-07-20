/**
 * AuditoriaExcedentesLiveCache.gs
 */

const AuditoriaExcedentesLiveCache = (() => {
  const CFG = Object.freeze({
    PREFIX: "AEC_LIVE_V3_",
    TTL_SECONDS: 21600, // 6 horas, máximo útil en CacheService
    LOCK_WAIT_MS: 8000,
    MAX_TOKEN_LEN: 80,
    MAX_EVENTOS_RECIENTES: 80,
    MAX_CACHE_CHARS: 90000
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

  function _clampNonNegative_(value) {
    return Math.max(0, _toNum_(value));
  }

  function _tz_() {
    return Session.getScriptTimeZone() || "America/Mexico_City";
  }

  function _fmtDate_() {
    return Utilities.formatDate(new Date(), _tz_(), "dd/MM/yyyy");
  }

  function _fmtTime_() {
    return Utilities.formatDate(new Date(), _tz_(), "HH:mm:ss");
  }

  /**
   * Token seguro para llaves internas.
   * Evita caracteres raros y reduce riesgo de llaves conflictivas.
   */
  function _safeToken_(value) {
    const raw = _toUpper_(value)
      .replace(/[^A-Z0-9_\-./ ]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return raw.slice(0, CFG.MAX_TOKEN_LEN);
  }

  function _safeId_(idauditoria) {
    return _safeToken_(idauditoria);
  }

  function _safeUbicacion_(ubicacion) {
    return _safeToken_(ubicacion);
  }

  function _safeBodega_(bodega) {
    return _safeToken_(bodega);
  }

  function _key_(idauditoria) {
    const id = _safeId_(idauditoria);
    if (!id) {
      throw new Error("LiveCache requiere idauditoria válido.");
    }

    return CFG.PREFIX + id;
  }

  function _nowStamp_() {
    return {
      fecha: _fmtDate_(),
      hora: _fmtTime_()
    };
  }

  function _timeToSeconds_(value) {
    const s = _toStr_(value);
    if (!s) return null;

    const parts = s.split(":").map(Number);
    if (parts.length < 2) return null;

    const h = parts[0] || 0;
    const m = parts[1] || 0;
    const sec = parts[2] || 0;

    return h * 3600 + m * 60 + sec;
  }

  function _diffMinutes_(horaInicio, horaFin) {
    const ini = _timeToSeconds_(horaInicio);
    const fin = _timeToSeconds_(horaFin || _fmtTime_());

    if (ini == null || fin == null) return 0;

    let diff = fin - ini;

    // Defensa si cruza media noche.
    if (diff < 0) {
      diff += 24 * 3600;
    }

    return _round2_(diff / 60);
  }

  function _pct_(num, den) {
    const n = _toNum_(num);
    const d = _toNum_(den);

    if (!d) return 0;

    return _round2_((n / d) * 100);
  }

  function _hash_(text) {
    const raw = _toStr_(text);

    try {
      const digest = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        raw,
        Utilities.Charset.UTF_8
      );

      return digest
        .map(function(byte) {
          const v = byte < 0 ? byte + 256 : byte;
          return ("0" + v.toString(16)).slice(-2);
        })
        .join("");
    } catch (e) {
      // Fallback simple si computeDigest fallara.
      let h = 0;
      for (let i = 0; i < raw.length; i++) {
        h = ((h << 5) - h) + raw.charCodeAt(i);
        h |= 0;
      }
      return String(Math.abs(h));
    }
  }

  // =========================================================
  // ESTRUCTURA
  // =========================================================
  function _emptyState_(idauditoria) {
    return {
      ok: true,
      schema: "AEC_LIVE_V3",
      idauditoria: _safeId_(idauditoria),
      version: 0,

      // Objeto indexado por ubicación segura.
      ubicaciones: {},

      // Protección ligera contra doble aplicación de lotes/eventos.
      eventosRecientes: [],

      creadoEn: _nowStamp_(),
      generadoEn: _nowStamp_()
    };
  }

  function _normalizarState_(state, idauditoria) {
    if (!state || typeof state !== "object") {
      return _emptyState_(idauditoria);
    }

    state.ok = true;
    state.schema = state.schema || "AEC_LIVE_V3";
    state.idauditoria = _safeId_(state.idauditoria || idauditoria);
    state.version = _toNum_(state.version);
    state.ubicaciones = state.ubicaciones && typeof state.ubicaciones === "object"
      ? state.ubicaciones
      : {};
    state.eventosRecientes = Array.isArray(state.eventosRecientes)
      ? state.eventosRecientes.slice(-CFG.MAX_EVENTOS_RECIENTES)
      : [];
    state.creadoEn = state.creadoEn || _nowStamp_();
    state.generadoEn = state.generadoEn || _nowStamp_();

    return state;
  }

  function _getRaw_(idauditoria) {
    const cache = CacheService.getScriptCache();
    const raw = cache.get(_key_(idauditoria));

    if (!raw) return null;

    try {
      return _normalizarState_(JSON.parse(raw), idauditoria);
    } catch (e) {
      console.warn("[AEC LiveCache] Cache corrupto o inválido. Se ignorará.", e);
      return null;
    }
  }

  function _putRaw_(idauditoria, state) {
    const cache = CacheService.getScriptCache();
    const safe = _normalizarState_(state, idauditoria);

    safe.version = _toNum_(safe.version) + 1;
    safe.generadoEn = _nowStamp_();

    const json = JSON.stringify(safe);

    if (json.length > CFG.MAX_CACHE_CHARS) {
      throw new Error(
        "LiveCache excedió el tamaño seguro permitido. Caracteres=" + json.length
      );
    }

    cache.put(_key_(idauditoria), json, CFG.TTL_SECONDS);

    return safe;
  }

  function _ensure_(idauditoria) {
    return _getRaw_(idauditoria) || _emptyState_(idauditoria);
  }

  function _withLock_(fn) {
    const lock = LockService.getScriptLock();
    let locked = false;

    try {
      lock.waitLock(CFG.LOCK_WAIT_MS);
      locked = true;
      return fn();
    } finally {
      if (locked) {
        lock.releaseLock();
      }
    }
  }

  // =========================================================
  // EVENTOS / IDEMPOTENCIA
  // =========================================================
  function _buildEventoKey_(tipo, data) {
    const rows = Array.isArray(data && data.rows) ? data.rows : [];

    const rowText = rows
      .map(function(row) {
        return [
          _safeToken_(row.idunico),
          row.escorrecto === true ? "C" : "",
          row.esfaltante === true ? "F" : "",
          row.essobrante === true ? "S" : "",
          _toStr_(row.horaescaneoidunico || row.horaLocal || row.hora || "")
        ].join(":");
      })
      .sort()
      .join("|");

    return _hash_([
      tipo,
      _safeId_(data && data.idauditoria),
      _safeUbicacion_(data && data.ubicacion),
      _toStr_(data && data.secuenciaubicacion),
      rowText,
      _toStr_(data && data.horainicioubicacion),
      _toStr_(data && data.horafinubicacion),
      _toStr_(data && data.faltantesInsertados)
    ].join("||"));
  }

  function _eventoYaProcesado_(state, eventoKey) {
    if (!eventoKey) return false;
    return state.eventosRecientes.indexOf(eventoKey) !== -1;
  }

  function _marcarEvento_(state, eventoKey) {
    if (!eventoKey) return state;

    state.eventosRecientes = Array.isArray(state.eventosRecientes)
      ? state.eventosRecientes
      : [];

    state.eventosRecientes.push(eventoKey);

    if (state.eventosRecientes.length > CFG.MAX_EVENTOS_RECIENTES) {
      state.eventosRecientes = state.eventosRecientes.slice(-CFG.MAX_EVENTOS_RECIENTES);
    }

    return state;
  }

  // =========================================================
  // UBICACIONES
  // =========================================================
  function _newUbicacion_(state, data) {
    const ubi = _safeUbicacion_(data.ubicacion);

    return {
      key: ubi,
      idauditoria: _safeId_(state.idauditoria),
      ubicacion: ubi,
      bodega: _safeBodega_(data.bodega || ""),
      secuenciaubicacion: _toNum_(data.secuenciaubicacion),

      abierta: false,
      cerrada: false,

      horainicioubicacion: "",
      horafinubicacion: "",

      esperados: _clampNonNegative_(data.esperados),
      escaneados: 0,
      correctos: 0,
      faltantes: 0,
      sobrantes: 0,
      pendientes: _clampNonNegative_(data.esperados),

      avancePct: 0,
      avanceTrabajoPct: 0,

      minutosTranscurridos: 0,
      escaneosPorMinuto: 0,
      correctosPorMinuto: 0,
      minutosEstimadosRestantes: 0,

      tieneDiferencia: false,
      estadoRitmo: "SIN_INICIAR",

      actualizadoEn: _nowStamp_()
    };
  }

  function _ensureUbicacion_(state, data) {
    const ubi = _safeUbicacion_(data && data.ubicacion);

    if (!ubi) {
      throw new Error("LiveCache requiere ubicación válida.");
    }

    if (!state.ubicaciones[ubi]) {
      state.ubicaciones[ubi] = _newUbicacion_(state, {
        ...data,
        ubicacion: ubi
      });
    }

    const item = state.ubicaciones[ubi];

    if (data.bodega) {
      item.bodega = _safeBodega_(data.bodega);
    }

    if (data.secuenciaubicacion != null) {
      item.secuenciaubicacion = _toNum_(data.secuenciaubicacion);
    }

    if (data.esperados != null && _toNum_(data.esperados) >= 0) {
      item.esperados = _toNum_(data.esperados);
    }

    return item;
  }

  function _recalcularUbicacion_(u) {
    u.esperados = _clampNonNegative_(u.esperados);
    u.escaneados = _clampNonNegative_(u.escaneados);
    u.correctos = _clampNonNegative_(u.correctos);
    u.faltantes = _clampNonNegative_(u.faltantes);
    u.sobrantes = _clampNonNegative_(u.sobrantes);

    u.tieneDiferencia = u.faltantes > 0 || u.sobrantes > 0;

    if (u.cerrada) {
      // Al cerrar, los esperados oficiales son correctos + faltantes.
      const esperadosOficiales = u.correctos + u.faltantes;
      if (esperadosOficiales > 0) {
        u.esperados = esperadosOficiales;
      }

      u.pendientes = 0;
      u.avancePct = 100;
      u.avanceTrabajoPct = 100;
    } else {
      u.pendientes = Math.max(u.esperados - u.correctos, 0);
      u.avancePct = _pct_(u.correctos, u.esperados);
      u.avanceTrabajoPct = _pct_(u.escaneados, u.esperados);
    }

    const horaFinCalculo = u.cerrada
      ? u.horafinubicacion
      : _fmtTime_();

    u.minutosTranscurridos = u.horainicioubicacion
      ? _diffMinutes_(u.horainicioubicacion, horaFinCalculo)
      : 0;

    u.escaneosPorMinuto = u.minutosTranscurridos > 0
      ? _round2_(u.escaneados / u.minutosTranscurridos)
      : 0;

    u.correctosPorMinuto = u.minutosTranscurridos > 0
      ? _round2_(u.correctos / u.minutosTranscurridos)
      : 0;

    u.minutosEstimadosRestantes =
      u.abierta &&
      !u.cerrada &&
      u.correctosPorMinuto > 0
        ? _round2_(u.pendientes / u.correctosPorMinuto)
        : 0;

    if (u.abierta && !u.cerrada) {
      if (u.correctosPorMinuto === 0 && u.minutosTranscurridos >= 5) {
        u.estadoRitmo = "DETENIDO";
      } else if (u.correctosPorMinuto < 2 && u.minutosTranscurridos >= 3) {
        u.estadoRitmo = "CRITICO";
      } else if (u.correctosPorMinuto < 3 && u.minutosTranscurridos >= 3) {
        u.estadoRitmo = "LENTO";
      } else {
        u.estadoRitmo = "A_TIEMPO";
      }
    } else if (u.cerrada) {
      u.estadoRitmo = "FINALIZADO";
    } else {
      u.estadoRitmo = "SIN_INICIAR";
    }

    u.actualizadoEn = _nowStamp_();

    return u;
  }

  function _ordenarUbicaciones_(arr) {
    return arr.sort(function(a, b) {
      const seq = _toNum_(a.secuenciaubicacion) - _toNum_(b.secuenciaubicacion);
      if (seq !== 0) return seq;

      return String(a.ubicacion).localeCompare(String(b.ubicacion), "es", {
        numeric: true,
        sensitivity: "base"
      });
    });
  }

  // =========================================================
  // API PÚBLICA: EMISORES
  // =========================================================

  /**
   * Marca una ubicación como abierta en el canal vivo.
   *
   * data:
   * {
   *   idauditoria,
   *   ubicacion,
   *   bodega,
   *   secuenciaubicacion,
   *   horainicioubicacion,
   *   esperados
   * }
   */
  function abrirUbicacion(data) {
    data = data || {};
    const id = _safeId_(data.idauditoria);

    if (!id) {
      throw new Error("LiveCache.abrirUbicacion requiere idauditoria.");
    }

    return _withLock_(function() {
      const state = _ensure_(id);
      const eventoKey = _buildEventoKey_("ABRIR_UBICACION", data);

      if (_eventoYaProcesado_(state, eventoKey)) {
        return state;
      }

      const u = _ensureUbicacion_(state, data);

      u.abierta = true;
      u.cerrada = false;
      u.horainicioubicacion = _toStr_(data.horainicioubicacion) || _fmtTime_();
      u.horafinubicacion = "";

      _recalcularUbicacion_(u);
      _marcarEvento_(state, eventoKey);

      return _putRaw_(id, state);
    });
  }

  /**
   * Agrega escaneos al canal vivo.
   *
   * data:
   * {
   *   idauditoria,
   *   ubicacion,
   *   bodega,
   *   secuenciaubicacion,
   *   rows: [
   *     { escorrecto, esfaltante, essobrante, idunico }
   *   ]
   * }
   */
  function registrarEscaneos(data) {
    data = data || {};
    const id = _safeId_(data.idauditoria);

    if (!id) {
      throw new Error("LiveCache.registrarEscaneos requiere idauditoria.");
    }

    return _withLock_(function() {
      const state = _ensure_(id);
      const eventoKey = _buildEventoKey_("REGISTRAR_ESCANEOS", data);

      if (_eventoYaProcesado_(state, eventoKey)) {
        return state;
      }

      const rows = Array.isArray(data.rows) ? data.rows : [];

      if (!rows.length) {
        return state;
      }

      const u = _ensureUbicacion_(state, data);

      u.abierta = true;

      rows.forEach(function(row) {
        if (!row) return;

        if (row.esfaltante === true) {
          u.faltantes += 1;
          return;
        }

        if (row.escorrecto === true) {
          u.correctos += 1;
          u.escaneados += 1;
          return;
        }

        if (row.essobrante === true) {
          u.sobrantes += 1;
          u.escaneados += 1;
          return;
        }
      });

      _recalcularUbicacion_(u);
      _marcarEvento_(state, eventoKey);

      return _putRaw_(id, state);
    });
  }

  /**
   * Marca una ubicación como cerrada en el canal vivo.
   *
   * data:
   * {
   *   idauditoria,
   *   ubicacion,
   *   bodega,
   *   secuenciaubicacion,
   *   horafinubicacion,
   *   faltantesInsertados
   * }
   */
  function cerrarUbicacion(data) {
    data = data || {};
    const id = _safeId_(data.idauditoria);

    if (!id) {
      throw new Error("LiveCache.cerrarUbicacion requiere idauditoria.");
    }

    return _withLock_(function() {
      const state = _ensure_(id);
      const eventoKey = _buildEventoKey_("CERRAR_UBICACION", data);

      if (_eventoYaProcesado_(state, eventoKey)) {
        return state;
      }

      const u = _ensureUbicacion_(state, data);

      u.abierta = true;
      u.cerrada = true;
      u.horafinubicacion = _toStr_(data.horafinubicacion) || _fmtTime_();

      if (data.faltantesInsertados != null) {
        u.faltantes += _clampNonNegative_(data.faltantesInsertados);
      }

      _recalcularUbicacion_(u);
      _marcarEvento_(state, eventoKey);

      return _putRaw_(id, state);
    });
  }

  // =========================================================
  // API PÚBLICA: LECTURA
  // =========================================================

  /**
   * Lee el pulso vivo agregado.
   * Si no existe cache, regresa null para permitir fallback a Sheets.
   */
  function getPulso(idauditoria) {
    const id = _safeId_(idauditoria);
    if (!id) return null;

    const state = _getRaw_(id);
    if (!state) return null;

    const ubicacionesEnVivo = _ordenarUbicaciones_(
      Object.keys(state.ubicaciones || {})
        .map(function(key) {
          return _recalcularUbicacion_({
            ...state.ubicaciones[key]
          });
        })
        .filter(function(u) {
          return u.abierta || u.cerrada;
        })
    );

    const abiertas = ubicacionesEnVivo.filter(function(u) {
      return u.abierta && !u.cerrada;
    });

    const cerradas = ubicacionesEnVivo.filter(function(u) {
      return u.cerrada;
    });

    const esperadosVivos = ubicacionesEnVivo.reduce(function(acc, u) {
      return acc + _toNum_(u.esperados);
    }, 0);

    const correctosVivos = ubicacionesEnVivo.reduce(function(acc, u) {
      return acc + _toNum_(u.correctos);
    }, 0);

    const escaneadosVivos = ubicacionesEnVivo.reduce(function(acc, u) {
      return acc + _toNum_(u.escaneados);
    }, 0);

    const pendientesVivos = ubicacionesEnVivo.reduce(function(acc, u) {
      return acc + _toNum_(u.pendientes);
    }, 0);

    return {
      ok: true,
      source: "CACHE_LIVE",
      schema: state.schema || "AEC_LIVE_V3",
      idauditoria: id,
      version: _toNum_(state.version),

      resumenOperativo: {
        ubicacionesTocadas: ubicacionesEnVivo.length,
        ubicacionesAbiertas: abiertas.length,
        ubicacionesCerradas: cerradas.length,

        esperadosVivos: esperadosVivos,
        correctosVivos: correctosVivos,
        escaneadosVivos: escaneadosVivos,
        pendientesVivos: pendientesVivos,

        avanceVivoPct: _pct_(correctosVivos, esperadosVivos),
        avanceTrabajoPct: _pct_(escaneadosVivos, esperadosVivos),

        ubicacionesLentas: ubicacionesEnVivo.filter(function(u) {
          return u.estadoRitmo === "LENTO";
        }).length,

        ubicacionesCriticas: ubicacionesEnVivo.filter(function(u) {
          return u.estadoRitmo === "CRITICO";
        }).length,

        ubicacionesDetenidas: ubicacionesEnVivo.filter(function(u) {
          return u.estadoRitmo === "DETENIDO";
        }).length
      },

      ubicacionesEnVivo: ubicacionesEnVivo,

      generadoEn: state.generadoEn || _nowStamp_()
    };
  }

  /**
   * Elimina el cache vivo de una auditoría.
   * Útil al cerrar auditoría o para debug.
   */
  function clear(idauditoria) {
    const id = _safeId_(idauditoria);
    if (!id) return false;

    CacheService.getScriptCache().remove(_key_(id));
    return true;
  }

  /**
   * Devuelve el estado crudo para debug controlado.
   */
  function debugGetRaw(idauditoria) {
    return _getRaw_(idauditoria);
  }

  return {
    abrirUbicacion,
    registrarEscaneos,
    cerrarUbicacion,
    getPulso,
    clear,
    debugGetRaw
  };
})();