/**
 * z4-PrototipoTraspasosController
 *
 * @fileoverview Controlador RPC de la vista PrototipoTraspasos. Expone las
 * funciones globales consumidas por google.script.run, valida los contratos
 * mínimos de entrada y delega la lógica operativa a
 * PrototipoTraspasosService mediante execController_().
 *
 * Responsabilidades:
 * - Obtener el bootstrap requerido por la vista.
 * - Consultar el estado vigente de folios para ACOMODO y SURTIDO.
 * - Normalizar estrictamente la solicitud de actualización forzada.
 * - Validar la estructura general de la cola antes de procesarla.
 * - Invalidar explícitamente la caché de folios cuando esté disponible.
 * - Verificar la disponibilidad del ejecutor y de cada método del servicio.
 * - Mantener nombres de operación estables para trazabilidad y diagnóstico.
 * - Conservar al servicio como autoridad de validación y persistencia.
 *
 * Este controlador no debe:
 * - Leer ni escribir directamente en hojas de cálculo.
 * - Implementar reglas de acomodo, surtido, inventario o idempotencia.
 * - Construir movimientos, etiquetas o trabajos de impresión.
 * - Resolver autorizaciones a partir de información enviada por el cliente.
 * - Duplicar validaciones profundas que pertenecen al servicio de dominio.
 *
 * Dependencias globales:
 * - execController_(controllerName, operationName, callback).
 * - PrototipoTraspasosService.
 * - APPALMACENCache, únicamente para invalidación explícita de folios.
 *
 * Reglas de diseño y seguridad:
 * - Solo el booleano true activa forceRefresh.
 * - La cola debe ser un arreglo no vacío compuesto únicamente por objetos.
 * - Los elementos de la cola se delegan sin modificar sus campos internos.
 * - La ausencia de APPALMACENCache produce false, no un error de referencia.
 * - Cada método del servicio se valida antes de invocarse.
 * - Todos los endpoints públicos pasan por execController_().
 * - Las constantes y el catálogo de operaciones son inmutables.
 *
 * API pública:
 * - getBootstrap().
 * - obtenerEstadoFolios(forceRefresh).
 * - procesarMovimientosFinal(cola).
 * - clearCacheFolios().
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {string} Nombre lógico utilizado por execController_(). */
const CTRL_PROTOTIPO_TRASPASOS = "PrototipoTraspasosController";

/** @const {string} Prefijo uniforme para diagnóstico estructural. */
const CTRL_PROTOTIPO_TRASPASOS_LOG_PREFIX =
  "[APPALMACEN][PROTOTIPO_TRASPASOS_CONTROLLER]";

/**
 * Catálogo inmutable de operaciones públicas y métodos del servicio.
 *
 * @const {!Object<string, string>}
 */
const CTRL_PROTOTIPO_TRASPASOS_OPERATIONS = Object.freeze({
  GET_BOOTSTRAP: "getBootstrap",
  GET_FOLIO_STATE: "obtenerEstadoFolios",
  PROCESS_FINAL_MOVEMENTS: "procesarMovimientosFinal",
  CLEAR_FOLIO_CACHE: "clearCacheFolios"
});

// =============================================================================
// NORMALIZACIÓN Y VALIDACIÓN PRIVADA
// =============================================================================

/**
 * Normaliza de forma estricta el indicador de actualización forzada.
 *
 * Solo el valor booleano true activa la actualización. Cadenas como "true",
 * números distintos de cero y otros valores truthy se interpretan como false.
 *
 * @param {*} forceRefresh Valor recibido desde la interfaz.
 * @return {boolean} Indicador seguro para el servicio.
 * @private
 */
function _prototipoTraspasosNormalizeForceRefresh_(forceRefresh) {
  return forceRefresh === true;
}

/**
 * Determina si un movimiento tiene una estructura inspeccionable.
 *
 * Esta función no valida campos ni reglas operativas. Únicamente descarta
 * valores nulos, primitivos y arreglos anidados.
 *
 * @param {*} item Movimiento recibido desde la interfaz.
 * @return {boolean} true cuando es un objeto no nulo y no es un arreglo.
 * @private
 */
function _prototipoTraspasosIsMovement_(item) {
  return Boolean(
    item &&
    typeof item === "object" &&
    !Array.isArray(item)
  );
}

/**
 * Construye metadatos agregados y no sensibles de la cola recibida.
 *
 * No registra folios, códigos, cantidades, ubicaciones, solicitantes, IdUnicos
 * ni contenido de los movimientos. Solo describe la forma general del RPC.
 *
 * @param {*} queue Valor recibido desde la vista.
 * @return {{
 *   esArreglo: boolean,
 *   total: number,
 *   movimientosObjeto: number,
 *   movimientosInvalidos: number
 * }} Metadatos estructurales de la solicitud.
 * @private
 */
function _prototipoTraspasosGetQueueMetadata_(queue) {
  if (!Array.isArray(queue)) {
    return {
      esArreglo: false,
      total: 0,
      movimientosObjeto: 0,
      movimientosInvalidos: 0
    };
  }

  const movimientosObjeto = queue.reduce(function (total, item) {
    return total + (_prototipoTraspasosIsMovement_(item) ? 1 : 0);
  }, 0);

  return {
    esArreglo: true,
    total: queue.length,
    movimientosObjeto,
    movimientosInvalidos: queue.length - movimientosObjeto
  };
}

/**
 * Valida únicamente la estructura general de la cola de movimientos.
 *
 * El servicio conserva la responsabilidad de validar tipo, solicitante, folio,
 * SKU, cantidad, ubicación, saldo, idempotencia, inventario e impresión.
 *
 * @param {*} queue Cola recibida desde la interfaz.
 * @param {!Object} metadata Metadatos calculados previamente.
 * @return {!Array<!Object>} Cola estructuralmente válida y sin modificaciones.
 * @throws {Error} Si no es un arreglo, está vacía o contiene valores inválidos.
 * @private
 */
function _prototipoTraspasosValidateQueue_(queue, metadata) {
  if (!metadata.esArreglo) {
    throw new Error("La cola de movimientos debe ser un arreglo.");
  }

  if (metadata.total === 0) {
    throw new Error("La cola de movimientos está vacía.");
  }

  if (metadata.movimientosObjeto !== metadata.total) {
    throw new Error(
      "La cola de movimientos contiene elementos inválidos."
    );
  }

  return queue;
}

/**
 * Obtiene y valida el servicio de dominio y el método solicitado.
 *
 * @param {string} methodName Método público que será invocado.
 * @return {!Object} Servicio disponible y compatible.
 * @throws {Error} Si el servicio o el método no están disponibles.
 * @private
 */
function _prototipoTraspasosGetService_(methodName) {
  if (
    typeof PrototipoTraspasosService === "undefined" ||
    !PrototipoTraspasosService
  ) {
    throw new Error("PrototipoTraspasosService no está disponible.");
  }

  if (
    !methodName ||
    typeof PrototipoTraspasosService[methodName] !== "function"
  ) {
    throw new Error(
      "El servicio del prototipo no implementa la operación: " +
        methodName + "."
    );
  }

  return PrototipoTraspasosService;
}

/**
 * Obtiene la función opcional de invalidación de caché, si está disponible.
 *
 * La función se devuelve enlazada al objeto administrador para conservar su
 * contexto de ejecución en caso de que la implementación utilice this.
 *
 * @return {?function(): *} Función enlazada o null cuando no está disponible.
 * @private
 */
function _prototipoTraspasosGetCacheInvalidator_() {
  if (
    typeof APPALMACENCache === "undefined" ||
    !APPALMACENCache ||
    typeof APPALMACENCache.clearPrototipoFolios !== "function"
  ) {
    return null;
  }

  return APPALMACENCache.clearPrototipoFolios.bind(APPALMACENCache);
}

// =============================================================================
// EJECUCIÓN Y DELEGACIÓN COMÚN
// =============================================================================

/**
 * Ejecuta un endpoint mediante el wrapper común de controladores.
 *
 * @param {string} operationName Nombre estable de la operación.
 * @param {function(): *} callback Trabajo delegado.
 * @return {*} Resultado devuelto por execController_().
 * @throws {Error} Si execController_ no está disponible.
 * @throws {TypeError} Si callback no es una función.
 * @private
 */
function _prototipoTraspasosExecute_(operationName, callback) {
  if (typeof execController_ !== "function") {
    throw new Error("execController_ no está disponible.");
  }

  if (typeof callback !== "function") {
    throw new TypeError("La operación del controlador requiere un callback.");
  }

  return execController_(
    CTRL_PROTOTIPO_TRASPASOS,
    operationName,
    callback
  );
}

/**
 * Delega una operación sin argumentos al servicio de dominio.
 *
 * @param {string} operationName Nombre estable para trazabilidad.
 * @param {string} serviceMethod Método público del servicio.
 * @return {*} Resultado de la operación delegada.
 * @private
 */
function _prototipoTraspasosExecuteServiceMethod_(
  operationName,
  serviceMethod
) {
  return _prototipoTraspasosExecute_(operationName, function () {
    const service = _prototipoTraspasosGetService_(serviceMethod);
    return service[serviceMethod]();
  });
}

// =============================================================================
// API PÚBLICA DEL PROTOTIPO
// =============================================================================

/**
 * Obtiene la información inicial requerida por PrototipoTraspasos.
 *
 * El contenido y las reglas del bootstrap pertenecen al servicio de dominio. El
 * controlador únicamente coordina la llamada mediante el estándar transversal.
 *
 * @return {*} Bootstrap preparado por PrototipoTraspasosService.
 */
function PrototipoTraspasosController_getBootstrap() {
  return _prototipoTraspasosExecuteServiceMethod_(
    CTRL_PROTOTIPO_TRASPASOS_OPERATIONS.GET_BOOTSTRAP,
    CTRL_PROTOTIPO_TRASPASOS_OPERATIONS.GET_BOOTSTRAP
  );
}

/**
 * Obtiene el estado vigente de los folios disponibles para acomodo y surtido.
 *
 * Solo el booleano true activa una actualización forzada. Cualquier otro valor
 * conserva la política normal de caché definida por el servicio.
 *
 * @param {*} forceRefresh Indicador recibido desde la vista.
 * @return {*} Estado de folios construido por el servicio.
 */
function PrototipoTraspasosController_obtenerEstadoFolios(forceRefresh) {
  const operationName =
    CTRL_PROTOTIPO_TRASPASOS_OPERATIONS.GET_FOLIO_STATE;

  return _prototipoTraspasosExecute_(operationName, function () {
    const normalizedForceRefresh =
      _prototipoTraspasosNormalizeForceRefresh_(forceRefresh);
    const service = _prototipoTraspasosGetService_(operationName);

    return service.obtenerEstadoFolios(normalizedForceRefresh);
  });
}

/**
 * Procesa la cola final de movimientos preparada por la vista.
 *
 * El controlador valida únicamente que se reciba un arreglo no vacío compuesto
 * por objetos y registra metadatos no sensibles. El servicio valida el contrato
 * completo, aplica inventario idempotente, persiste bitácoras y genera impresión.
 *
 * @param {*} cola Movimientos de acomodo o surtido por procesar.
 * @return {*} Resultado operativo e información de impresión aplicable.
 */
function PrototipoTraspasosController_procesarMovimientosFinal(cola) {
  const operationName =
    CTRL_PROTOTIPO_TRASPASOS_OPERATIONS.PROCESS_FINAL_MOVEMENTS;

  return _prototipoTraspasosExecute_(operationName, function () {
    const metadata = _prototipoTraspasosGetQueueMetadata_(cola);

    console.log(
      CTRL_PROTOTIPO_TRASPASOS_LOG_PREFIX +
        "[COLA_RECIBIDA] " +
        JSON.stringify(metadata)
    );

    const validatedQueue = _prototipoTraspasosValidateQueue_(
      cola,
      metadata
    );
    const service = _prototipoTraspasosGetService_(operationName);

    return service.procesarMovimientosFinal(validatedQueue);
  });
}

/**
 * Invalida la caché de folios utilizada por PrototipoTraspasos.
 *
 * La operación es tolerante cuando APPALMACENCache o su método especializado no
 * están disponibles. En ese escenario devuelve false. Si la función existe y
 * falla, execController_ administra y propaga el error correspondiente.
 *
 * @return {boolean|*} Resultado de clearPrototipoFolios() o false.
 */
function PrototipoTraspasosController_clearCacheFolios() {
  const operationName =
    CTRL_PROTOTIPO_TRASPASOS_OPERATIONS.CLEAR_FOLIO_CACHE;

  return _prototipoTraspasosExecute_(operationName, function () {
    const clearCache = _prototipoTraspasosGetCacheInvalidator_();

    if (!clearCache) {
      console.warn(
        CTRL_PROTOTIPO_TRASPASOS_LOG_PREFIX +
          " APPALMACENCache.clearPrototipoFolios no está disponible."
      );
      return false;
    }

    return clearCache();
  });
}
