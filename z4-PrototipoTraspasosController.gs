/**
 * PrototipoTraspasosController.gs
 *
 * Controlador público de la vista PrototipoTraspasos.
 *
 * Responsabilidades:
 * - Exponer los endpoints consumidos por google.script.run.
 * - Delegar la lógica de negocio a PrototipoTraspasosService.
 * - Normalizar parámetros simples antes de enviarlos al Service.
 * - Mantener el manejo uniforme de errores, métricas y trazabilidad mediante
 *   execController_().
 * - Exponer una operación administrativa para invalidar la caché de folios.
 *
 * Este Controller no debe:
 * - Leer ni escribir directamente en hojas de cálculo.
 * - Implementar reglas de acomodo o surtido.
 * - Construir movimientos, etiquetas o trabajos de impresión.
 * - Confiar en datos del cliente como fuente definitiva de autorización.
 * - Duplicar validaciones que pertenecen al Service.
 *
 * Dependencias:
 * - execController_()
 * - PrototipoTraspasosService
 * - APPALMACENCache, únicamente para invalidación explícita de caché
 *
 * Endpoints públicos:
 * - PrototipoTraspasosController_getBootstrap()
 * - PrototipoTraspasosController_obtenerEstadoFolios(forceRefresh)
 * - PrototipoTraspasosController_procesarMovimientosFinal(cola)
 * - PrototipoTraspasosController_clearCacheFolios()
 */

"use strict";

/**
 * Nombre lógico del Controller utilizado por execController_ para identificar
 * operaciones, errores y métricas del módulo.
 *
 * @type {string}
 * @const
 */
const CTRL_PROTOTIPO_TRASPASOS = "PrototipoTraspasosController";

/**
 * Obtiene la información inicial requerida por la vista de traspasos.
 *
 * El contenido y las reglas del bootstrap pertenecen al Service. El Controller
 * conserva únicamente la responsabilidad de exponer el endpoint público y
 * ejecutar la operación dentro del estándar transversal del proyecto.
 *
 * @return {Object} Bootstrap preparado por PrototipoTraspasosService.
 * @throws {Error} Error normalizado por execController_ cuando la operación
 *     no puede completarse.
 */
function PrototipoTraspasosController_getBootstrap() {
  return execController_(
    CTRL_PROTOTIPO_TRASPASOS,
    "getBootstrap",
    function() {
      return PrototipoTraspasosService.getBootstrap();
    }
  );
}

/**
 * Obtiene el estado vigente de los folios disponibles para acomodo y surtido.
 *
 * El parámetro se normaliza de forma estricta. Solamente el valor booleano
 * true activa una actualización forzada; cualquier otro valor se interpreta
 * como false. Esto evita que cadenas como "true" o valores truthy modifiquen
 * accidentalmente la política de caché.
 *
 * @param {*} forceRefresh Indicador recibido desde la vista.
 * @return {Object} Estado de folios construido por el Service.
 * @throws {Error} Error normalizado por execController_ cuando la operación
 *     no puede completarse.
 */
function PrototipoTraspasosController_obtenerEstadoFolios(forceRefresh) {
  return execController_(
    CTRL_PROTOTIPO_TRASPASOS,
    "obtenerEstadoFolios",
    function() {
      return PrototipoTraspasosService.obtenerEstadoFolios(
        forceRefresh === true
      );
    }
  );
}

/**
 * Procesa la fila final de movimientos preparada por la vista.
 *
 * La validación detallada de estructura, usuarios, folios, cantidades,
 * ubicaciones, idempotencia, inventario e impresión corresponde al Service.
 * El Controller conserva intacto el contrato recibido y lo delega sin
 * transformaciones que puedan alterar la intención operativa.
 *
 * @param {Array<Object>} cola Movimientos de acomodo o surtido por procesar.
 * @return {Object} Resultado del procesamiento, incluida la información de
 *     impresión cuando se genera una etiqueta de remanente.
 * @throws {Error} Error normalizado por execController_ cuando la operación
 *     no puede completarse.
 */
function PrototipoTraspasosController_procesarMovimientosFinal(cola) {
  return execController_(
    CTRL_PROTOTIPO_TRASPASOS,
    "procesarMovimientosFinal",
    function() {
      return PrototipoTraspasosService.procesarMovimientosFinal(cola);
    }
  );
}

/**
 * Invalida la caché de folios utilizada por PrototipoTraspasos.
 *
 * La operación es tolerante a instalaciones donde APPALMACENCache todavía no
 * esté disponible. En ese escenario devuelve false sin provocar un error de
 * referencia. Los errores internos de una implementación existente continúan
 * siendo administrados por execController_.
 *
 * @return {boolean|*} Resultado devuelto por clearPrototipoFolios(), o false
 *     cuando el administrador de caché no está disponible.
 * @throws {Error} Error normalizado por execController_ cuando la función de
 *     invalidación existe, pero falla durante su ejecución.
 */
function PrototipoTraspasosController_clearCacheFolios() {
  return execController_(
    CTRL_PROTOTIPO_TRASPASOS,
    "clearCacheFolios",
    function() {
      const cacheDisponible =
        typeof APPALMACENCache !== "undefined" &&
        APPALMACENCache !== null &&
        typeof APPALMACENCache.clearPrototipoFolios === "function";

      if (!cacheDisponible) {
        return false;
      }

      return APPALMACENCache.clearPrototipoFolios();
    }
  );
}
