/**
 * z3-AdminExcedentesService.gs
 *
 * @fileoverview Administración de estados de excedentes (IDUNICO).
 *
 * PROPÓSITO
 * ─────────
 * Corregir desde la app, de forma controlada y auditada, el estado de una
 * etiqueta: por ejemplo, regresar un SURTIDO hecho por error a ACOMODADO o
 * una etiqueta a DISPONIBLE. Antes esto se hacía editando las hojas a mano,
 * lo que no avisaba a las cachés (revisión de inventario) y dejaba datos
 * desfasados en las vistas. Aquí cada cambio:
 *   1. se aplica bajo el ScriptLock de inventario,
 *   2. deshace TODO lo que escribió cada movimiento revertido,
 *   3. sube la revisión de inventario (las cachés se invalidan al instante),
 *   4. queda registrado con respaldo en ADMIN_EXCEDENTES_BITACORA.
 *
 * QUÉ ESCRIBE UN MOVIMIENTO (y por tanto qué se deshace)
 * ─────────────────────────────────────────────────────
 *   Movimiento   Bitacora-TRASPASOS   EXISTENCIAS                    SINCRONIZACION        BD-EXCEDENTES.STATUS
 *   ACOMODO      fila ACOMODO         BIRLOS → bodega del excedente  clave APLICADO        ACOMODADO
 *   SURTIDO      fila SURTIDO (−)     bodega del excedente → BIRLOS  clave APLICADO        PARCIAL / SURTIDO
 *   Si el SURTIDO vino de Reabastecimiento, además existe un detalle en
 *   REABASTECIMIENTO_DETALLES con el mismo idOperacion.
 *
 * Al revertir un movimiento:
 *   - Bitacora-TRASPASOS: se vacía la fila (ver AdminExcedentesRepository).
 *   - EXISTENCIAS: se devuelve la cantidad (ExistenciasRepository).
 *   - SINCRONIZACION: la fila queda REVERTIDO (su clave cambia).
 *   - REABASTECIMIENTO_DETALLES: se vacía el detalle del surtido.
 *   - STATUS: se recalcula repitiendo el historial que queda.
 *
 * ACCIONES (ADMIN_EXCEDENTES_CONFIG.ACCIONES)
 * ──────────────────────────────────────────
 * Siempre se deshace del movimiento MÁS RECIENTE hacia atrás; nunca uno
 * intermedio. Así el historial restante es siempre una secuencia válida.
 *   DESHACER_ULTIMO      Revierte solo el último movimiento.
 *   VOLVER_ACOMODADO     Revierte los SURTIDO posteriores al último ACOMODO.
 *   VOLVER_DISPONIBLE    Revierte todos los movimientos.
 *   SINCRONIZAR_STATUS   No toca movimientos: corrige STATUS para que coincida
 *                        con el historial (desfase por ediciones manuales).
 *
 * EMPAREJAMIENTO MOVIMIENTO ↔ SINCRONIZACIÓN
 * ─────────────────────────────────────────
 * Bitacora-TRASPASOS no guarda el idOperacion (FOLIO queda vacío), así que el
 * movimiento se empareja con su fila de sincronización por IDUNICO, tipo y
 * cantidad, del más reciente hacia atrás. Un movimiento sin pareja (anterior
 * a la sincronización) se revierte igual, pero EXISTENCIAS no se ajusta: el
 * plan lo muestra como advertencia antes de aplicar.
 *
 * SEGURIDAD (prototipo)
 * ────────────────────
 * - La contraseña se valida SOLO en el servidor contra su huella SHA-256
 *   (ADMIN_EXCEDENTES_CONFIG.PASSWORD_SHA256); el navegador nunca la conoce.
 * - Entrar a la vista entrega un token de sesión (CacheService, 30 min sin
 *   uso). Toda consulta exige el token.
 * - Aplicar un cambio exige token + contraseña otra vez + responsable + motivo.
 * - Intentos fallidos: tras MAX_FAILED_ATTEMPTS se bloquea LOCKOUT_SECONDS al
 *   usuario de Apps Script.
 *
 * CONCURRENCIA
 * ────────────
 * El plan devuelve una "firma" (huella de las filas involucradas). Al aplicar,
 * bajo candado, se recalcula: si otra persona movió la etiqueta entre la
 * consulta y la confirmación, la firma no coincide y no se escribe nada.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version ADMIN-EXCEDENTES-SERVICE-2026-11-20-01
 */

const AdminExcedentesService = (() => {
  "use strict";

  const CFG = ADMIN_EXCEDENTES_CONFIG;
  const ERR = CFG.ERROR_CODES;
  const ACT = CFG.ACCIONES;
  const ST = CFG.STATUS;

  // ==========================================================================
  // INFRAESTRUCTURA
  // ==========================================================================

  /**
   * Error de dominio con código público. El Controller lo presenta como
   * "[CODIGO] mensaje".
   * @private
   */
  function domainError_(code, message, details) {
    const error = new Error(message);
    error.code = code;
    if (details) error.details = details;
    return error;
  }

  /** Hex en minúsculas de un arreglo de bytes de Utilities.computeDigest. @private */
  function bytesToHex_(bytes) {
    return bytes.map(function(byte) {
      const value = byte < 0 ? byte + 256 : byte;
      return (value < 16 ? "0" : "") + value.toString(16);
    }).join("");
  }

  /** Huella SHA-256 hexadecimal de un texto. @private */
  function sha256_(text) {
    return bytesToHex_(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(text == null ? "" : text),
      Utilities.Charset.UTF_8
    ));
  }

  /** Comparación en tiempo constante de dos textos de igual formato. @private */
  function safeEquals_(left, right) {
    const a = String(left || "");
    const b = String(right || "");
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
  }

  /** Clave estable del usuario de Apps Script para el bloqueo por intentos. @private */
  function userKey_() {
    try {
      const key = Session.getTemporaryActiveUserKey && Session.getTemporaryActiveUserKey();
      if (key) return String(key);
    } catch (error) { /* sin clave temporal */ }
    return "ANONIMO";
  }

  /** Correo del usuario activo si Apps Script lo expone. @private */
  function activeEmail_() {
    try {
      return String(Session.getActiveUser().getEmail() || "");
    } catch (error) {
      return "";
    }
  }

  /** Fecha y hora locales del script (dd/MM/yyyy, HH:mm:ss). @private */
  function nowParts_() {
    const now = new Date();
    const tz = Session.getScriptTimeZone();
    return {
      fecha: Utilities.formatDate(now, tz, "dd/MM/yyyy"),
      hora: Utilities.formatDate(now, tz, "HH:mm:ss")
    };
  }

  // ==========================================================================
  // SESIÓN Y CONTRASEÑA
  // ==========================================================================

  /**
   * Valida la contraseña con bloqueo por intentos fallidos.
   *
   * @param {*} password Contraseña capturada.
   * @throws {Error} ADMEXC_BLOQUEADO o ADMEXC_PASSWORD_INVALIDA.
   * @private
   */
  function assertPassword_(password) {
    const cache = CacheService.getScriptCache();
    const failKey = CFG.FAIL_CACHE_PREFIX + userKey_();
    const failures = Number(cache.get(failKey) || 0);
    if (failures >= CFG.MAX_FAILED_ATTEMPTS) {
      throw domainError_(ERR.BLOQUEADO, "Demasiados intentos fallidos. Espera " + Math.round(CFG.LOCKOUT_SECONDS / 60) + " minutos e inténtalo de nuevo.");
    }
    if (!safeEquals_(sha256_(password), CFG.PASSWORD_SHA256)) {
      cache.put(failKey, String(failures + 1), CFG.LOCKOUT_SECONDS);
      const remaining = CFG.MAX_FAILED_ATTEMPTS - failures - 1;
      throw domainError_(ERR.PASSWORD_INVALIDA, remaining > 0
        ? "Contraseña incorrecta. Intentos restantes: " + remaining + "."
        : "Contraseña incorrecta. El acceso quedó bloqueado temporalmente.");
    }
    cache.remove(failKey);
  }

  /**
   * Abre una sesión de administración.
   *
   * @param {{password:string}} payload
   * @return {{token:string, expiraEnSegundos:number}}
   */
  function startSession(payload) {
    const trace = perfStart_("ADMIN_EXCEDENTES_INICIAR_SESION", {});
    try {
      assertPassword_(payload && payload.password);
      const token = Utilities.getUuid();
      CacheService.getScriptCache().put(
        CFG.TOKEN_CACHE_PREFIX + token,
        JSON.stringify({ at: Date.now(), user: userKey_() }),
        CFG.TOKEN_TTL_SECONDS
      );
      perfEnd_(trace, "ok");
      return { token: token, expiraEnSegundos: CFG.TOKEN_TTL_SECONDS };
    } catch (error) {
      perfEnd_(trace, "error", { message: error && error.message });
      throw error;
    }
  }

  /**
   * Exige un token vigente y renueva su vigencia (30 min desde el último uso).
   *
   * @param {*} token Token de startSession().
   * @throws {Error} ADMEXC_SESION_INVALIDA.
   * @private
   */
  function assertToken_(token) {
    const value = String(token || "");
    if (!/^[0-9a-f-]{36}$/i.test(value)) {
      throw domainError_(ERR.SESION_INVALIDA, "La sesión de administración no es válida. Vuelve a entrar con la contraseña.");
    }
    const cache = CacheService.getScriptCache();
    const raw = cache.get(CFG.TOKEN_CACHE_PREFIX + value);
    if (!raw) {
      throw domainError_(ERR.SESION_INVALIDA, "La sesión de administración expiró. Vuelve a entrar con la contraseña.");
    }
    cache.put(CFG.TOKEN_CACHE_PREFIX + value, raw, CFG.TOKEN_TTL_SECONDS);
  }

  /** Cierra la sesión (elimina el token). */
  function endSession(payload) {
    const token = String(payload && payload.token || "");
    if (token) CacheService.getScriptCache().remove(CFG.TOKEN_CACHE_PREFIX + token);
    return { cerrada: true };
  }

  // ==========================================================================
  // INSTANTÁNEA DE UN IDUNICO
  // ==========================================================================

  /**
   * STATUS que dejaría Traspasos al repetir el historial de movimientos:
   * sin movimientos → DISPONIBLE; ACOMODO → ACOMODADO; SURTIDO → PARCIAL si
   * queda saldo, SURTIDO si se agotó.
   *
   * @param {!Array<!Object>} movements Movimientos en orden cronológico.
   * @param {number} initialQuantity Cantidad inicial de BD-EXCEDENTES.
   * @return {{status:string, saldo:number}}
   * @private
   */
  function replayStatus_(movements, initialQuantity) {
    let status = ST.DISPONIBLE;
    let saldo = round2_(Math.abs(toNum_(initialQuantity)));
    movements.forEach(function(movement) {
      if (movement.tipo === "ACOMODO") {
        status = ST.ACOMODADO;
      } else if (movement.tipo === "SURTIDO") {
        saldo = Math.max(0, round2_(saldo - Math.abs(toNum_(movement.cantidad))));
        status = saldo > 0 ? ST.PARCIAL : ST.SURTIDO;
      }
    });
    return { status: status, saldo: saldo };
  }

  /**
   * Empareja cada movimiento con su fila de sincronización APLICADO (mismo
   * tipo y cantidad), del más reciente hacia atrás.
   *
   * @return {!Map<number, !Object>} fila de bitácora → fila de sincronización.
   * @private
   */
  function pairSyncRows_(movements, syncRows) {
    const pairs = new Map();
    const available = syncRows
      .filter(function(sync) { return sync.resultado === "APLICADO"; })
      .slice()
      .sort(function(a, b) { return b.rowNumber - a.rowNumber; });
    const used = new Set();
    movements.slice().reverse().forEach(function(movement) {
      const quantity = round2_(Math.abs(toNum_(movement.cantidad)));
      const match = available.find(function(sync) {
        return !used.has(sync.rowNumber) &&
          sync.tipomovimiento === movement.tipo &&
          round2_(sync.cantidad) === quantity;
      });
      if (match) {
        used.add(match.rowNumber);
        pairs.set(movement.fila, match);
      }
    });
    return pairs;
  }

  /**
   * Lee todo lo que involucra a un IDUNICO (sin el estado canónico).
   *
   * @param {string} idUnico Etiqueta.
   * @param {Object=} trace Traza activa.
   * @return {!Object} Instantánea con base, movimientos, sincronizaciones,
   *     detalles de Reabastecimiento, estado esperado y firma.
   * @private
   */
  function readSnapshot_(idUnico, trace) {
    const token = toStr_(idUnico);
    const base = AdminExcedentesRepository.getExcedenteRows(token);
    perfMark_(trace, "ADMIN_BASE_READ", { rows: base.length });
    const movements = AdminExcedentesRepository.getTraspasoRows(token);
    perfMark_(trace, "ADMIN_MOVEMENTS_READ", { rows: movements.length });
    const syncRows = typeof ExistenciasRepository.getSincronizacionesPorIdUnico === "function"
      ? ExistenciasRepository.getSincronizacionesPorIdUnico(token)
      : [];
    perfMark_(trace, "ADMIN_SYNC_READ", { rows: syncRows.length });
    const reabDetails = ReabastecimientoDetallesRepository.getAll(trace).filter(function(detail) {
      return toStrUpper_(detail.idUnico) === toStrUpper_(token);
    });
    perfMark_(trace, "ADMIN_REAB_DETAILS_READ", { rows: reabDetails.length });

    if (!base.length && !movements.length) {
      throw domainError_(ERR.IDUNICO_NO_ENCONTRADO, "La etiqueta " + token + " no existe en BD-EXCEDENTES ni en Bitacora-TRASPASOS.");
    }

    // Fila activa: la última física (mismo criterio que Traspasos).
    const active = base.length ? base[base.length - 1] : null;
    // Cantidad inicial: la fila base más reciente por fecha/hora (como el estado).
    const newestBase = base.slice().sort(function(a, b) { return (a.ts - b.ts) || (a.rowNumber - b.rowNumber); }).pop() || null;
    const initialQuantity = newestBase ? newestBase.cantidad : 0;
    const expected = replayStatus_(movements, initialQuantity);
    const pairs = pairSyncRows_(movements, syncRows);

    const enriched = movements.map(function(movement) {
      const sync = pairs.get(movement.fila) || null;
      const detail = sync && movement.tipo === "SURTIDO"
        ? reabDetails.find(function(item) { return item.idOperacion && item.idOperacion === sync.idOperacion; }) || null
        : null;
      return Object.assign({}, movement, {
        sync: sync,
        reabDetalle: detail ? { numFila: detail.numFila, idSolicitud: detail.idSolicitud, idOperacion: detail.idOperacion, cantidad: detail.cantidad } : null
      });
    });

    const signatureSource = JSON.stringify({
      b: base.map(function(row) { return [row.rowNumber, row.status, row.cantidad]; }),
      m: movements.map(function(row) { return [row.fila, row.tipo, row.cantidad, row.ts]; }),
      s: syncRows.map(function(row) { return [row.rowNumber, row.clave, row.resultado]; }),
      d: reabDetails.map(function(row) { return [row.numFila, row.idOperacion]; })
    });

    return {
      idUnico: token,
      base: base,
      active: active,
      initialQuantity: initialQuantity,
      currentStatus: active ? active.status : "",
      expectedStatus: expected.status,
      expectedSaldo: expected.saldo,
      movements: enriched,
      syncRows: syncRows,
      reabDetails: reabDetails,
      signature: sha256_(signatureSource)
    };
  }

  // ==========================================================================
  // PLAN DE CAMBIOS
  // ==========================================================================

  /**
   * Calcula qué movimientos se revierten y el resultado de una acción.
   *
   * @param {!Object} snapshot Instantánea de readSnapshot_.
   * @param {string} action Acción de ADMIN_EXCEDENTES_CONFIG.ACCIONES.
   * @return {!Object} Plan con pasos, advertencias y estado final.
   * @private
   */
  function buildPlan_(snapshot, action) {
    const movements = snapshot.movements;
    let targets;
    switch (action) {
      case ACT.DESHACER_ULTIMO:
        if (!movements.length) throw domainError_(ERR.ACCION_NO_APLICABLE, "La etiqueta no tiene movimientos que deshacer.");
        targets = movements.slice(-1);
        break;
      case ACT.VOLVER_ACOMODADO: {
        let lastAcomodo = -1;
        movements.forEach(function(movement, index) { if (movement.tipo === "ACOMODO") lastAcomodo = index; });
        if (lastAcomodo === -1) throw domainError_(ERR.ACCION_NO_APLICABLE, "La etiqueta nunca se acomodó: no puede volver a ACOMODADO. Usa VOLVER A DISPONIBLE.");
        targets = movements.slice(lastAcomodo + 1);
        if (!targets.length) throw domainError_(ERR.ACCION_NO_APLICABLE, "El último movimiento ya es un ACOMODO: no hay surtidos que revertir.");
        break;
      }
      case ACT.VOLVER_DISPONIBLE:
        targets = movements.slice();
        break;
      case ACT.SINCRONIZAR_STATUS:
        targets = [];
        break;
      default:
        throw domainError_(ERR.ACCION_INVALIDA, "La acción solicitada no es válida.");
    }

    const remaining = movements.slice(0, movements.length - targets.length);
    const result = replayStatus_(remaining, snapshot.initialQuantity);
    const statusChanges = Boolean(snapshot.active) && snapshot.currentStatus !== result.status;
    if (!targets.length && !statusChanges) {
      throw domainError_(ERR.ACCION_NO_APLICABLE, action === ACT.SINCRONIZAR_STATUS
        ? "El STATUS ya coincide con el historial; no hay nada que corregir."
        : "La etiqueta ya está en ese estado; no hay cambios que aplicar.");
    }

    const warnings = [];
    if (!snapshot.active) warnings.push("No existe fila en BD-EXCEDENTES: solo se revierten movimientos; no se actualiza STATUS.");
    const steps = targets.slice().reverse().map(function(movement) {
      if (!movement.sync) {
        warnings.push("El " + movement.tipo + " del " + movement.fecha + " (fila " + movement.fila + ") no tiene registro de sincronización: EXISTENCIAS no se ajustará automáticamente.");
      }
      return {
        tipo: movement.tipo,
        fila: movement.fila,
        fecha: movement.fecha,
        hora: movement.hora,
        cantidad: movement.cantidad,
        ubicacion: movement.tipo === "ACOMODO" ? movement.ubicacionEntrada : movement.ubicacionSalida,
        existencias: movement.sync ? {
          filaSincronizacion: movement.sync.rowNumber,
          devolverA: movement.sync.bodegaSalida,
          retirarDe: movement.sync.bodegaEntrada,
          cantidad: movement.sync.cantidad
        } : null,
        reabDetalle: movement.reabDetalle
      };
    });

    return {
      idUnico: snapshot.idUnico,
      accion: action,
      firma: snapshot.signature,
      statusAnterior: snapshot.currentStatus,
      statusNuevo: result.status,
      cambiaStatus: statusChanges,
      saldoAnterior: snapshot.expectedSaldo,
      saldoNuevo: result.saldo,
      pasos: steps,
      advertencias: warnings,
      targets: targets
    };
  }

  /** Plan sin datos internos, para el navegador. @private */
  function publicPlan_(plan) {
    const copy = Object.assign({}, plan);
    delete copy.targets;
    return copy;
  }

  // ==========================================================================
  // CONSULTAS PÚBLICAS
  // ==========================================================================

  /**
   * Detalle completo de un IDUNICO para la vista.
   *
   * @param {{token:string, idUnico:string}} payload
   * @return {!Object} Etiqueta, estado canónico, historial y acciones posibles.
   */
  function getDetail(payload) {
    const trace = perfStart_("ADMIN_EXCEDENTES_CONSULTAR", {});
    try {
      assertToken_(payload && payload.token);
      const idUnico = toStr_(payload && payload.idUnico);
      if (!idUnico) throw domainError_(ERR.PAYLOAD_INVALIDO, "Escanea o captura el IDUNICO.");
      const snapshot = readSnapshot_(idUnico, trace);

      // Estado canónico (el mismo que ven Traspasos, Gestor y Auditoría).
      let estado = null;
      try {
        estado = EstadoActualExcedentesService.getUnoPorIdUnicoDirecto(idUnico);
      } catch (error) {
        estado = null;
      }
      perfMark_(trace, "ADMIN_CANONICAL_STATE_READY", { found: Boolean(estado) });

      const actions = Object.keys(ACT).map(function(key) {
        try {
          const plan = buildPlan_(snapshot, ACT[key]);
          return { accion: ACT[key], disponible: true, movimientos: plan.pasos.length, statusNuevo: plan.statusNuevo, motivo: "" };
        } catch (error) {
          return { accion: ACT[key], disponible: false, movimientos: 0, statusNuevo: "", motivo: error.message };
        }
      });

      const result = {
        idUnico: snapshot.idUnico,
        codigo: snapshot.active ? snapshot.active.codigo : (snapshot.movements[0] ? snapshot.movements[0].codigo : ""),
        descripcion: snapshot.active ? snapshot.active.descripcion : (snapshot.movements[0] ? snapshot.movements[0].descripcion : ""),
        cantidadInicial: snapshot.initialQuantity,
        statusBD: snapshot.currentStatus,
        statusEsperado: snapshot.expectedStatus,
        desfase: Boolean(snapshot.active) && snapshot.currentStatus !== snapshot.expectedStatus,
        saldoHistorial: snapshot.expectedSaldo,
        estado: estado ? {
          saldoActual: estado.saldoActual,
          ubicacionActual: estado.ubicacionActual,
          bodegaActual: estado.bodegaActual,
          estatusLogico: estado.estatusLogico,
          vigente: estado.vigente,
          auditable: estado.auditable
        } : null,
        base: snapshot.base.map(function(row) {
          const copy = Object.assign({}, row);
          delete copy.values;
          copy.activa = Boolean(snapshot.active) && row.rowNumber === snapshot.active.rowNumber;
          return copy;
        }),
        movimientos: snapshot.movements.map(function(movement) {
          return {
            fila: movement.fila,
            fecha: movement.fecha,
            hora: movement.hora,
            tipo: movement.tipo,
            cantidad: movement.cantidad,
            ubicacionSalida: movement.ubicacionSalida,
            ubicacionEntrada: movement.ubicacionEntrada,
            bodegaSalida: movement.bodegaSalida,
            bodegaEntrada: movement.bodegaEntrada,
            solicitante: movement.solicitante,
            sincronizado: Boolean(movement.sync),
            idOperacion: movement.sync ? movement.sync.idOperacion : "",
            reabDetalle: movement.reabDetalle
          };
        }),
        sincronizaciones: snapshot.syncRows.map(function(row) {
          return { rowNumber: row.rowNumber, idOperacion: row.idOperacion, tipo: row.tipomovimiento, cantidad: row.cantidad, resultado: row.resultado };
        }),
        reabDetalles: snapshot.reabDetails.map(function(detail) {
          return { numFila: detail.numFila, idSolicitud: detail.idSolicitud, cantidad: detail.cantidad, tipoSurtido: detail.tipoSurtido, idOperacion: detail.idOperacion };
        }),
        acciones: actions,
        firma: snapshot.signature
      };
      perfEnd_(trace, "ok", { movimientos: result.movimientos.length });
      return result;
    } catch (error) {
      perfEnd_(trace, "error", { message: error && error.message });
      throw error;
    }
  }

  /**
   * Plan de una acción, para mostrarlo antes de pedir la contraseña.
   *
   * @param {{token:string, idUnico:string, accion:string}} payload
   * @return {!Object} Plan público (pasos, advertencias, estado final, firma).
   */
  function getPlan(payload) {
    const trace = perfStart_("ADMIN_EXCEDENTES_PLANIFICAR", {});
    try {
      assertToken_(payload && payload.token);
      const snapshot = readSnapshot_(toStr_(payload && payload.idUnico), trace);
      const plan = publicPlan_(buildPlan_(snapshot, toStrUpper_(payload && payload.accion)));
      perfEnd_(trace, "ok", { pasos: plan.pasos.length });
      return plan;
    } catch (error) {
      perfEnd_(trace, "error", { message: error && error.message });
      throw error;
    }
  }

  // ==========================================================================
  // APLICACIÓN
  // ==========================================================================

  /** Limpia las cachés de lectura que dependen del inventario. @private */
  function invalidateInventoryCaches_() {
    [
      typeof EstadoActualExcedentesService !== "undefined" ? EstadoActualExcedentesService : null,
      typeof ExcedentesRepository !== "undefined" ? ExcedentesRepository : null,
      typeof TraspasosRepository !== "undefined" ? TraspasosRepository : null,
      typeof GestorExcedentesService !== "undefined" ? GestorExcedentesService : null
    ].forEach(function(module) {
      if (module && typeof module.clearCache === "function") {
        try { module.clearCache(); } catch (error) { /* la siguiente lectura releerá la hoja */ }
      }
    });
    if (typeof APPALMACENCache !== "undefined") {
      ["clearPrototipoFolios", "clearGestorExcedentes"].forEach(function(name) {
        if (typeof APPALMACENCache[name] === "function") {
          try { APPALMACENCache[name](); } catch (error) { /* sin acción */ }
        }
      });
    }
  }

  /**
   * Aplica una acción. Exige token, contraseña, responsable y motivo.
   *
   * Orden (todo bajo el ScriptLock de inventario):
   *  1. Releer la etiqueta y comparar la firma del plan (concurrencia).
   *  2. Validar SIN escribir: filas de bitácora y detalles de Reabastecimiento.
   *  3. EXISTENCIAS + SINCRONIZACION (ExistenciasRepository revalida y escribe).
   *  4. Vaciar filas de Bitacora-TRASPASOS (del más reciente al más antiguo).
   *  5. Vaciar detalles de Reabastecimiento ligados a surtidos revertidos.
   *  6. STATUS en BD-EXCEDENTES.
   *  7. flush + revisión de inventario (+ revisión de Reabastecimiento).
   *  8. Bitácora de administración con respaldo.
   *
   * @param {{token:string, idUnico:string, accion:string, firma:string,
   *     password:string, responsable:string, motivo:string}} payload
   * @return {!Object} Resumen del cambio y detalle actualizado.
   */
  function applyAction(payload) {
    const trace = perfStart_("ADMIN_EXCEDENTES_APLICAR", {});
    try {
      const input = payload && typeof payload === "object" ? payload : {};
      assertToken_(input.token);
      assertPassword_(input.password);
      const responsable = toStrUpper_(input.responsable);
      if (!responsable) throw domainError_(ERR.RESPONSABLE_REQUERIDO, "Selecciona al responsable del cambio.");
      const motivo = toStr_(input.motivo);
      if (motivo.length < CFG.MOTIVO_MIN_LENGTH || motivo.length > CFG.MOTIVO_MAX_LENGTH) {
        throw domainError_(ERR.MOTIVO_REQUERIDO, "Describe el motivo del cambio (" + CFG.MOTIVO_MIN_LENGTH + " a " + CFG.MOTIVO_MAX_LENGTH + " caracteres).");
      }
      const idUnico = toStr_(input.idUnico);
      const action = toStrUpper_(input.accion);

      const outcome = withScriptLock_("ADMIN_EXCEDENTES_APLICAR", function() {
        // 1. Concurrencia.
        const snapshot = readSnapshot_(idUnico, trace);
        if (!safeEquals_(snapshot.signature, input.firma)) {
          throw domainError_(ERR.PLAN_CAMBIO, "La etiqueta cambió desde que revisaste el plan. Vuelve a consultarla antes de aplicar.");
        }
        const plan = buildPlan_(snapshot, action);
        const targets = plan.targets.slice().reverse(); // más reciente primero

        // 2. Validaciones sin escritura.
        targets.forEach(function(movement) {
          AdminExcedentesRepository.assertTraspasoRow({ fila: movement.fila, idUnico: idUnico, tipo: movement.tipo, cantidad: movement.cantidad });
        });
        perfMark_(trace, "ADMIN_PRECHECK_PASSED", { movimientos: targets.length });

        const backup = { plan: publicPlan_(plan), traspasos: [], reabDetalles: [], existencias: [], status: null };

        // 3. Existencias y sincronización.
        const syncItems = targets
          .filter(function(movement) { return movement.sync; })
          .map(function(movement) { return { rowNumber: movement.sync.rowNumber, clave: movement.sync.clave }; });
        backup.existencias = syncItems.length
          ? ExistenciasRepository.revertirMovimientosSincronizados(syncItems, trace)
          : [];

        // 4. Bitácora de traspasos.
        targets
          .slice()
          .sort(function(a, b) { return b.fila - a.fila; })
          .forEach(function(movement) {
            backup.traspasos.push(AdminExcedentesRepository.clearTraspasoRowUnderLock({
              fila: movement.fila, idUnico: idUnico, tipo: movement.tipo, cantidad: movement.cantidad
            }));
          });
        perfMark_(trace, "ADMIN_TRASPASOS_CLEARED", { filas: backup.traspasos.length });

        // 5. Detalles de Reabastecimiento.
        const folios = new Set();
        targets.forEach(function(movement) {
          if (!movement.reabDetalle) return;
          const cleared = ReabastecimientoDetallesRepository.clearRowUnderLock(movement.reabDetalle.numFila, {
            idSolicitud: movement.reabDetalle.idSolicitud,
            idUnico: idUnico,
            idOperacion: movement.reabDetalle.idOperacion
          }, trace);
          if (cleared.cleared) {
            folios.add(movement.reabDetalle.idSolicitud);
            backup.reabDetalles.push({ numFila: movement.reabDetalle.numFila, idSolicitud: movement.reabDetalle.idSolicitud, respaldo: cleared.respaldo });
          }
        });

        // 6. STATUS.
        if (plan.cambiaStatus) {
          backup.status = AdminExcedentesRepository.updateExcedenteStatusUnderLock(
            snapshot.active.rowNumber, idUnico, snapshot.currentStatus, plan.statusNuevo
          );
        }

        // 7. Confirmación y avisos a las cachés.
        SpreadsheetApp.flush();
        if (typeof appInventoryRevisionBump_ === "function") appInventoryRevisionBump_();
        folios.forEach(function(folio) {
          if (typeof ReabastecimientoService !== "undefined" && typeof ReabastecimientoService.notificarCambioExterno === "function") {
            ReabastecimientoService.notificarCambioExterno(folio, trace);
          }
        });
        invalidateInventoryCaches_();
        perfMark_(trace, "ADMIN_CHANGES_COMMITTED", { folios: folios.size });

        // 8. Bitácora de administración.
        const when = nowParts_();
        AdminExcedentesRepository.appendBitacora({
          fecha: when.fecha,
          hora: when.hora,
          responsable: responsable,
          correo: activeEmail_(),
          accion: action,
          idUnico: idUnico,
          codigo: snapshot.active ? snapshot.active.codigo : "",
          statusAnterior: plan.statusAnterior,
          statusNuevo: plan.cambiaStatus ? plan.statusNuevo : plan.statusAnterior,
          saldoAnterior: plan.saldoAnterior,
          saldoNuevo: plan.saldoNuevo,
          movimientosRevertidos: backup.traspasos.length,
          existenciasAjustadas: backup.existencias.length,
          reabDetallesEliminados: backup.reabDetalles.length,
          motivo: motivo,
          advertencias: plan.advertencias,
          respaldo: backup
        });

        return {
          accion: action,
          idUnico: idUnico,
          statusAnterior: plan.statusAnterior,
          statusNuevo: plan.cambiaStatus ? plan.statusNuevo : plan.statusAnterior,
          saldoNuevo: plan.saldoNuevo,
          movimientosRevertidos: backup.traspasos.length,
          existenciasAjustadas: backup.existencias.length,
          reabDetallesEliminados: backup.reabDetalles.length,
          foliosReabastecimiento: Array.from(folios),
          advertencias: plan.advertencias
        };
      }, CFG.LOCK_TIMEOUT_MS, trace);

      perfEnd_(trace, "ok", { movimientos: outcome.movimientosRevertidos });
      // Detalle actualizado fuera del candado (estado canónico ya recalculado).
      outcome.detalle = getDetail({ token: input.token, idUnico: idUnico });
      return outcome;
    } catch (error) {
      perfEnd_(trace, "error", { message: error && error.message });
      throw error;
    }
  }

  // ==========================================================================
  // INCONSISTENCIAS
  // ==========================================================================

  /**
   * Etiquetas cuyo STATUS en BD-EXCEDENTES no coincide con su historial.
   *
   * Usa el estado consolidado (EstadoActualExcedentesService.getAll) para
   * revisar todo el almacén en una pasada. Regla del STATUS esperado: sin
   * movimientos → DISPONIBLE; último ACOMODO → ACOMODADO; último SURTIDO →
   * PARCIAL con saldo o SURTIDO sin saldo. Solo se revisan los STATUS que
   * administra esta herramienta.
   *
   * @param {{token:string}} payload
   * @return {{total:number, mostradas:number, items:!Array<!Object>}}
   */
  function listInconsistencies(payload) {
    const trace = perfStart_("ADMIN_EXCEDENTES_INCONSISTENCIAS", {});
    try {
      assertToken_(payload && payload.token);
      const managed = Object.keys(ST).map(function(key) { return ST[key]; });
      const items = [];
      EstadoActualExcedentesService.getAll().forEach(function(item) {
        if (!item.existeBD) return;
        const current = toStrUpper_(item.estatusRegistro);
        if (managed.indexOf(current) === -1) return;
        const movements = toNum_(item.cantidadAcomodos) + toNum_(item.cantidadSurtidos);
        let expected = ST.DISPONIBLE;
        if (movements > 0) {
          expected = item.ultimoMovimientoTipo === "SURTIDO"
            ? (toNum_(item.saldoActual) > 0 ? ST.PARCIAL : ST.SURTIDO)
            : ST.ACOMODADO;
        }
        if (expected !== current) {
          items.push({
            idUnico: item.idUnico,
            codigo: item.codigo,
            descripcion: item.descripcion,
            statusBD: current,
            statusEsperado: expected,
            saldoActual: item.saldoActual,
            ubicacionActual: item.ubicacionActual,
            ultimoMovimiento: item.ultimoMovimientoTipo,
            ultimaFecha: item.ultimaFechaMovimiento
          });
        }
      });
      items.sort(function(a, b) { return compareEs_(a.codigo, b.codigo) || compareEs_(a.idUnico, b.idUnico); });
      const shown = items.slice(0, CFG.MAX_INCONSISTENCIAS);
      perfEnd_(trace, "ok", { total: items.length });
      return { total: items.length, mostradas: shown.length, items: shown };
    } catch (error) {
      perfEnd_(trace, "error", { message: error && error.message });
      throw error;
    }
  }

  return Object.freeze({
    iniciarSesion: startSession,
    cerrarSesion: endSession,
    consultar: getDetail,
    planificar: getPlan,
    aplicar: applyAction,
    listarInconsistencias: listInconsistencies,
    /** Solo pruebas: regla de STATUS por historial. */
    _replayStatus: replayStatus_
  });
})();
