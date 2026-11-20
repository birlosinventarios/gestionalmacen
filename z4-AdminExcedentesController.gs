/**
 * z4-AdminExcedentesController.gs
 *
 * @fileoverview Endpoints de la vista AdministracionExcedentes.
 *
 * Cada función pública recibe UN objeto (google.script.run transmite un solo
 * argumento serializable) y responde con el sobre común de la app:
 *
 *   { ok: true, operation, data, metadata: { elapsedMs, perf? } }
 *
 * Los errores llegan al navegador como "[CODIGO] mensaje". Solo se exponen los
 * códigos de ADMIN_EXCEDENTES_CONFIG.ERROR_CODES; cualquier otro error se
 * presenta con un mensaje de servicio (el detalle técnico queda en los logs y
 * en la traza de rendimiento).
 *
 * SEGURIDAD
 * - La contraseña viaja solo en iniciarSesion y aplicar, y nunca se escribe en
 *   logs ni en la bitácora de rendimiento (el registro de payloads de la app
 *   solo guarda el número de argumentos).
 * - El Controller no decide permisos: AdminExcedentesService valida token y
 *   contraseña en cada llamada.
 *
 * RENDIMIENTO
 * - Mismo esquema que Reabastecimiento: el colector de etapas se reinicia al
 *   entrar y, con APPALMACEN_RENDIMIENTO.ENABLED, el desglose del servidor se
 *   adjunta en metadata.perf. Por eso el prefijo AdminExcedentesController_
 *   está excluido del interceptor genérico del navegador.
 *
 * ENDPOINTS
 * - AdminExcedentesController_iniciarSesion({password})
 * - AdminExcedentesController_cerrarSesion({token})
 * - AdminExcedentesController_consultar({token, idUnico})
 * - AdminExcedentesController_planificar({token, idUnico, accion})
 * - AdminExcedentesController_aplicar({token, idUnico, accion, firma, password, responsable, motivo})
 * - AdminExcedentesController_listarInconsistencias({token})
 *
 * @author Sigifredo de la Cruz Ramos
 * @version ADMIN-EXCEDENTES-CONTROLLER-2026-11-20-01
 */

/** @const {!Object} Configuración del Controller. */
const ADMIN_EXCEDENTES_CONTROLLER_CONFIG = Object.freeze({
  VERSION: "ADMIN-EXCEDENTES-CONTROLLER-2026-11-20-01",
  INTERNAL_MESSAGE: "No fue posible completar la operación de administración. Revisa los registros del servidor."
});

/**
 * Convierte cualquier error en uno apto para el navegador.
 *
 * @param {*} error Error original.
 * @return {!Error} "[CODIGO] mensaje" con código conocido o ADMEXC_ERROR_INTERNO.
 * @private
 */
function AdminExcedentesController_publicError_(error) {
  const codes = Object.keys(ADMIN_EXCEDENTES_CONFIG.ERROR_CODES).map(function(key) {
    return ADMIN_EXCEDENTES_CONFIG.ERROR_CODES[key];
  });
  const code = toStrUpper_(error && error.code);
  const known = codes.indexOf(code) !== -1;
  /*
   * Los errores de verificación de identidad de los repositorios ("cambió",
   * "Vuelve a consultar") no traen código pero son útiles para el usuario:
   * se muestran como PLAN_CAMBIO.
   */
  const message = toStr_(error && error.message);
  const isConcurrency = !known && /vuelve a consultar|cambió/i.test(message);
  const publicCode = known ? code : (isConcurrency ? ADMIN_EXCEDENTES_CONFIG.ERROR_CODES.PLAN_CAMBIO : ADMIN_EXCEDENTES_CONFIG.ERROR_CODES.ERROR_INTERNO);
  const publicMessage = known || isConcurrency ? message : ADMIN_EXCEDENTES_CONTROLLER_CONFIG.INTERNAL_MESSAGE;
  const result = new Error("[" + publicCode + "] " + publicMessage);
  result.code = publicCode;
  return result;
}

/**
 * Ejecuta un endpoint con medición, sobre común y errores públicos.
 *
 * @param {string} operation Nombre de la operación (bitácora de rendimiento).
 * @param {*} payload Argumento recibido del navegador.
 * @param {function(!Object):*} executor Lógica del Service.
 * @return {!Object} Sobre { ok, operation, data, metadata }.
 * @private
 */
function AdminExcedentesController_execute_(operation, payload, executor) {
  const startedAt = Date.now();
  if (typeof appPerfSinkReset_ === "function") appPerfSinkReset_();
  const trace = perfStart_("ADMIN_EXCEDENTES_CONTROLLER_" + operation, {});
  try {
    const input = payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
    if (!input) {
      const invalid = new Error("La solicitud debe ser un objeto.");
      invalid.code = ADMIN_EXCEDENTES_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO;
      throw invalid;
    }
    if (typeof AdminExcedentesService === "undefined") {
      throw new Error("AdminExcedentesService no está disponible.");
    }
    const data = executor(input);
    perfEnd_(trace, "ok", { elapsedMs: Date.now() - startedAt });
    const response = {
      ok: true,
      operation: operation,
      data: data,
      metadata: {
        controllerVersion: ADMIN_EXCEDENTES_CONTROLLER_CONFIG.VERSION,
        elapsedMs: Date.now() - startedAt
      }
    };
    const stages = typeof appPerfSinkDrain_ === "function" ? appPerfSinkDrain_() : [];
    if (typeof isPerformanceLoggingEnabled_ === "function" && isPerformanceLoggingEnabled_()) {
      response.metadata.perf = { serverMs: response.metadata.elapsedMs, controller: [], services: stages };
    }
    return response;
  } catch (error) {
    perfEnd_(trace, "error", { code: toStr_(error && error.code), message: toStr_(error && error.message) });
    if (typeof appPerfSinkDrain_ === "function") appPerfSinkDrain_();
    console.error("[AdminExcedentesController] " + operation, error && error.stack ? error.stack : error);
    const publicError = AdminExcedentesController_publicError_(error);
    if (typeof isPerformanceLoggingEnabled_ === "function" && isPerformanceLoggingEnabled_()) {
      publicError.message = publicError.message + " ⟦serverMs=" + (Date.now() - startedAt) + "⟧";
    }
    throw publicError;
  }
}

/**
 * Abre la sesión de administración con la contraseña.
 * @param {{password:string}} payload
 * @return {!Object} Sobre con {token, expiraEnSegundos}.
 */
function AdminExcedentesController_iniciarSesion(payload) {
  return AdminExcedentesController_execute_("INICIAR_SESION", payload, function(input) {
    return AdminExcedentesService.iniciarSesion({ password: input.password });
  });
}

/**
 * Cierra la sesión de administración.
 * @param {{token:string}} payload
 * @return {!Object} Sobre con {cerrada:true}.
 */
function AdminExcedentesController_cerrarSesion(payload) {
  return AdminExcedentesController_execute_("CERRAR_SESION", payload, function(input) {
    return AdminExcedentesService.cerrarSesion({ token: input.token });
  });
}

/**
 * Detalle de un IDUNICO: estado, historial, sincronizaciones y acciones.
 * @param {{token:string, idUnico:string}} payload
 * @return {!Object} Sobre con el detalle.
 */
function AdminExcedentesController_consultar(payload) {
  return AdminExcedentesController_execute_("CONSULTAR", payload, function(input) {
    return AdminExcedentesService.consultar({ token: input.token, idUnico: input.idUnico });
  });
}

/**
 * Plan de una acción (qué se revertirá y cómo quedará la etiqueta).
 * @param {{token:string, idUnico:string, accion:string}} payload
 * @return {!Object} Sobre con el plan y su firma.
 */
function AdminExcedentesController_planificar(payload) {
  return AdminExcedentesController_execute_("PLANIFICAR", payload, function(input) {
    return AdminExcedentesService.planificar({ token: input.token, idUnico: input.idUnico, accion: input.accion });
  });
}

/**
 * Aplica una acción confirmada con contraseña.
 * @param {{token:string, idUnico:string, accion:string, firma:string,
 *     password:string, responsable:string, motivo:string}} payload
 * @return {!Object} Sobre con el resumen y el detalle actualizado.
 */
function AdminExcedentesController_aplicar(payload) {
  return AdminExcedentesController_execute_("APLICAR", payload, function(input) {
    return AdminExcedentesService.aplicar({
      token: input.token,
      idUnico: input.idUnico,
      accion: input.accion,
      firma: input.firma,
      password: input.password,
      responsable: input.responsable,
      motivo: input.motivo
    });
  });
}

/**
 * Etiquetas cuyo STATUS no coincide con su historial.
 * @param {{token:string}} payload
 * @return {!Object} Sobre con {total, mostradas, items}.
 */
function AdminExcedentesController_listarInconsistencias(payload) {
  return AdminExcedentesController_execute_("INCONSISTENCIAS", payload, function(input) {
    return AdminExcedentesService.listarInconsistencias({ token: input.token });
  });
}
