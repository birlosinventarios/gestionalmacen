/**
 * z4-FormularioEtiquetasExcedentesReimpresionController
 *
 * @fileoverview Controlador RPC del formulario de reimpresión de etiquetas de
 * excedentes. Expone las funciones globales consumidas por google.script.run,
 * valida los contratos mínimos de entrada y delega toda la lógica de negocio a
 * FormularioEtiquetasExcedentesReimpresionService mediante execController_().
 *
 * Responsabilidades:
 * - Obtener el bootstrap requerido por la vista de reimpresión.
 * - Consultar la base vigente de etiquetas disponibles para reimprimir.
 * - Validar la estructura general de la lista antes de delegarla.
 * - Construir metadatos estructurales sin registrar información sensible.
 * - Verificar la disponibilidad del ejecutor y de cada método del servicio.
 * - Mantener nombres de operación estables para trazabilidad y diagnóstico.
 * - Conservar al servicio como autoridad de las reglas de reimpresión.
 *
 * Este controlador no debe:
 * - Leer o escribir directamente en hojas de cálculo.
 * - Validar la existencia o vigencia definitiva de los IdUnicos.
 * - Construir contratos físicos de persistencia.
 * - Generar documentos HTML de impresión.
 * - Resolver cantidades, productos, responsables o reglas de negocio.
 *
 * Dependencias globales:
 * - execController_(controllerName, operationName, callback).
 * - FormularioEtiquetasExcedentesReimpresionService.
 *
 * Reglas de diseño y seguridad:
 * - La lista de reimpresión debe ser un arreglo no vacío.
 * - Todos los elementos deben ser objetos no nulos y no pueden ser arreglos.
 * - Los metadatos registrados no incluyen códigos, IdUnicos ni cantidades.
 * - Cada método del servicio se valida antes de invocarse.
 * - Todos los endpoints públicos pasan por execController_().
 * - Las constantes y el catálogo de operaciones son inmutables.
 * - Las reglas definitivas de autorización y reimpresión pertenecen al servicio.
 *
 * API pública:
 * - getBootstrap().
 * - obtenerBase().
 * - procesarReimpresion(lista).
 *
 * @author Sigifredo de la Cruz Ramos
 */

"use strict";

/** @const {string} Nombre lógico utilizado por execController_(). */
const CTRL_EXCEDENTES_REIMPRESION =
  "FormularioEtiquetasExcedentesReimpresionController";

/** @const {string} Prefijo uniforme para diagnóstico estructural. */
const CTRL_EXCEDENTES_REIMPRESION_LOG_PREFIX =
  "[APPALMACEN][ETIQUETAS_EXCEDENTES_REIMPRESION]";

/**
 * Catálogo inmutable de operaciones públicas y métodos del servicio.
 *
 * @const {!Object<string, string>}
 */
const CTRL_EXCEDENTES_REIMPRESION_OPERATIONS = Object.freeze({
  GET_BOOTSTRAP: "getBootstrap",
  GET_BASE: "obtenerBase",
  PROCESS_REPRINT: "procesarReimpresion"
});

// =============================================================================
// VALIDACIÓN E INSPECCIÓN PRIVADA
// =============================================================================

/**
 * Determina si un elemento de la lista tiene una estructura inspeccionable.
 *
 * Esta comprobación no valida campos ni reglas de dominio. Solo evita delegar
 * valores nulos, primitivos o arreglos anidados como solicitudes individuales.
 *
 * @param {*} item Elemento recibido desde la interfaz.
 * @return {boolean} true cuando es un objeto no nulo y no es un arreglo.
 * @private
 */
function FormularioEtiquetasExcedentesReimpresionController_isListItem_(
  item
) {
  return Boolean(
    item &&
    typeof item === "object" &&
    !Array.isArray(item)
  );
}

/**
 * Construye metadatos agregados y no sensibles de la lista recibida.
 *
 * No inspecciona ni registra códigos, IdUnicos, cantidades, descripciones,
 * ubicaciones o responsables. Su propósito es facilitar el diagnóstico del
 * contrato RPC sin exponer datos operativos.
 *
 * @param {*} lista Valor recibido desde la vista.
 * @return {{
 *   esArreglo: boolean,
 *   total: number,
 *   elementosObjeto: number,
 *   elementosInvalidos: number
 * }} Metadatos estructurales de la solicitud.
 * @private
 */
function FormularioEtiquetasExcedentesReimpresionController_getListMetadata_(
  lista
) {
  if (!Array.isArray(lista)) {
    return {
      esArreglo: false,
      total: 0,
      elementosObjeto: 0,
      elementosInvalidos: 0
    };
  }

  const elementosObjeto = lista.reduce(function (total, item) {
    return total + (
      FormularioEtiquetasExcedentesReimpresionController_isListItem_(item)
        ? 1
        : 0
    );
  }, 0);

  return {
    esArreglo: true,
    total: lista.length,
    elementosObjeto,
    elementosInvalidos: lista.length - elementosObjeto
  };
}

/**
 * Valida únicamente la estructura general de una solicitud de reimpresión.
 *
 * El servicio conserva la responsabilidad de validar IdUnicos, productos,
 * cantidades, vigencia, autorización y generación de impresión.
 *
 * @param {*} lista Lista recibida desde la interfaz.
 * @param {!Object} metadata Metadatos calculados previamente.
 * @return {!Array<!Object>} Lista estructuralmente válida.
 * @throws {Error} Si no es un arreglo, está vacío o contiene valores inválidos.
 * @private
 */
function FormularioEtiquetasExcedentesReimpresionController_validateList_(
  lista,
  metadata
) {
  if (!metadata.esArreglo) {
    throw new Error(
      "La solicitud de reimpresión debe ser un arreglo."
    );
  }

  if (metadata.total === 0) {
    throw new Error("La solicitud de reimpresión está vacía.");
  }

  if (metadata.elementosObjeto !== metadata.total) {
    throw new Error(
      "La solicitud de reimpresión contiene elementos inválidos."
    );
  }

  return lista;
}

/**
 * Obtiene y valida el servicio de dominio y el método solicitado.
 *
 * @param {string} methodName Método público que será invocado.
 * @return {!Object} Servicio disponible y compatible.
 * @throws {Error} Si el servicio o el método no están disponibles.
 * @private
 */
function FormularioEtiquetasExcedentesReimpresionController_getService_(
  methodName
) {
  if (
    typeof FormularioEtiquetasExcedentesReimpresionService === "undefined" ||
    !FormularioEtiquetasExcedentesReimpresionService
  ) {
    throw new Error(
      "FormularioEtiquetasExcedentesReimpresionService no está disponible."
    );
  }

  if (
    !methodName ||
    typeof FormularioEtiquetasExcedentesReimpresionService[methodName] !==
      "function"
  ) {
    throw new Error(
      "El servicio de reimpresión no implementa la operación: " +
        methodName + "."
    );
  }

  return FormularioEtiquetasExcedentesReimpresionService;
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
function FormularioEtiquetasExcedentesReimpresionController_execute_(
  operationName,
  callback
) {
  if (typeof execController_ !== "function") {
    throw new Error("execController_ no está disponible.");
  }

  if (typeof callback !== "function") {
    throw new TypeError("La operación del controlador requiere un callback.");
  }

  return execController_(
    CTRL_EXCEDENTES_REIMPRESION,
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
function FormularioEtiquetasExcedentesReimpresionController_executeServiceMethod_(
  operationName,
  serviceMethod
) {
  return FormularioEtiquetasExcedentesReimpresionController_execute_(
    operationName,
    function () {
      const service =
        FormularioEtiquetasExcedentesReimpresionController_getService_(
          serviceMethod
        );
      return service[serviceMethod]();
    }
  );
}

// =============================================================================
// API PÚBLICA DEL FORMULARIO
// =============================================================================

/**
 * Obtiene catálogos y configuración inicial para la vista de reimpresión.
 *
 * @return {*} Bootstrap generado por el servicio de dominio.
 */
function FormularioEtiquetasExcedentesReimpresionController_getBootstrap() {
  return FormularioEtiquetasExcedentesReimpresionController_executeServiceMethod_(
    CTRL_EXCEDENTES_REIMPRESION_OPERATIONS.GET_BOOTSTRAP,
    CTRL_EXCEDENTES_REIMPRESION_OPERATIONS.GET_BOOTSTRAP
  );
}

/**
 * Obtiene la base vigente de etiquetas que puede consultar la vista.
 *
 * El servicio determina el contenido y las reglas definitivas de disponibilidad.
 * El controlador únicamente coordina la llamada RPC.
 *
 * @return {*} Base de reimpresión generada por el servicio.
 */
function FormularioEtiquetasExcedentesReimpresionController_obtenerBase() {
  return FormularioEtiquetasExcedentesReimpresionController_executeServiceMethod_(
    CTRL_EXCEDENTES_REIMPRESION_OPERATIONS.GET_BASE,
    CTRL_EXCEDENTES_REIMPRESION_OPERATIONS.GET_BASE
  );
}

/**
 * Procesa una lista de etiquetas seleccionadas para reimpresión.
 *
 * El controlador valida únicamente que se reciba un arreglo no vacío compuesto
 * por objetos. El servicio valida el contenido de cada elemento y genera los
 * contratos de impresión LOCAL y ONLINE aplicables.
 *
 * @param {*} lista Solicitudes preparadas por la vista.
 * @return {*} Resultado de la preparación de reimpresión.
 */
function FormularioEtiquetasExcedentesReimpresionController_procesarReimpresion(
  lista
) {
  const operationName =
    CTRL_EXCEDENTES_REIMPRESION_OPERATIONS.PROCESS_REPRINT;

  return FormularioEtiquetasExcedentesReimpresionController_execute_(
    operationName,
    function () {
      const metadata =
        FormularioEtiquetasExcedentesReimpresionController_getListMetadata_(
          lista
        );

      console.log(
        CTRL_EXCEDENTES_REIMPRESION_LOG_PREFIX +
          "[SOLICITUD] " +
          JSON.stringify(metadata)
      );

      const validatedList =
        FormularioEtiquetasExcedentesReimpresionController_validateList_(
          lista,
          metadata
        );
      const service =
        FormularioEtiquetasExcedentesReimpresionController_getService_(
          operationName
        );

      return service.procesarReimpresion(validatedList);
    }
  );
}
