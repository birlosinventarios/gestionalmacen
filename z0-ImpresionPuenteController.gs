/**
 * z0-ImpresionPuenteController.gs
 *
 * Controlador global de Google Apps Script para la infraestructura de
 * impresión ONLINE de APPALMACEN.
 *
 * Responsabilidades:
 * - Exponer funciones globales invocables mediante google.script.run.
 * - Delegar la lógica de impresión y diagnóstico a ImpresionPuenteService.
 * - Ejecutar cada operación mediante el envoltorio estándar execController_().
 * - Mantener nombres estables para los consumidores del navegador.
 * - Evitar que la capa Controller implemente reglas de negocio o transporte.
 *
 * Dependencias globales:
 * - execController_().
 * - ImpresionPuenteService.imprimir(printJob).
 * - ImpresionPuenteService.health().
 * - ImpresionPuenteService.debugConfig().
 *
 * Contratos públicos:
 * - ImpresionPuenteController_imprimir(printJob).
 * - ImpresionPuenteController_health().
 * - ImpresionPuenteController_debugConfig().
 *
 * Consideraciones de seguridad:
 * - El Controller no debe registrar ni devolver credenciales sensibles.
 * - La validación completa del printJob corresponde al Service.
 * - debugConfig() debe exponer únicamente configuración saneada.
 * - Los errores deben normalizarse mediante execController_().
 *
 * Invariantes:
 * - Las funciones deben permanecer en el ámbito global para google.script.run.
 * - Los nombres de capa y operación enviados a execController_() son estables.
 * - El Controller no accede directamente a PropertiesService ni UrlFetchApp.
 * - Un printJob nulo continúa normalizándose como objeto vacío.
 */

/** Nombre estable de la capa utilizado por la infraestructura de Controller. */
const IMPRESION_PUENTE_CONTROLLER_NAME_ = "ImpresionPuenteController";

/**
 * Envía un trabajo de impresión al puente ONLINE.
 *
 * El Controller únicamente normaliza la ausencia del argumento y delega la
 * validación, autenticación, transporte y respuesta al Service.
 *
 * @param {Object=} printJob Trabajo de impresión generado por el Builder.
 * @return {*} Respuesta normalizada por execController_().
 */
function ImpresionPuenteController_imprimir(printJob) {
  return execController_(
    IMPRESION_PUENTE_CONTROLLER_NAME_,
    "imprimir",
    function () {
      return ImpresionPuenteService.imprimir(printJob || {});
    }
  );
}

/**
 * Consulta el estado de salud del puente de impresión.
 *
 * @return {*} Respuesta normalizada por execController_().
 */
function ImpresionPuenteController_health() {
  return execController_(
    IMPRESION_PUENTE_CONTROLLER_NAME_,
    "health",
    function () {
      return ImpresionPuenteService.health();
    }
  );
}

/**
 * Obtiene la configuración no sensible interpretada por el Service.
 *
 * Este endpoint debe utilizarse únicamente para diagnóstico autorizado. El
 * Service es responsable de ocultar tokens, credenciales y valores privados.
 *
 * @return {*} Configuración saneada y normalizada por execController_().
 */
function ImpresionPuenteController_debugConfig() {
  return execController_(
    IMPRESION_PUENTE_CONTROLLER_NAME_,
    "debugConfig",
    function () {
      return ImpresionPuenteService.debugConfig();
    }
  );
}
