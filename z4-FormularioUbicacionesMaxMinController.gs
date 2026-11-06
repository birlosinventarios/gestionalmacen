/**
 * z4-FormularioUbicacionesMaxMinController.gs
 *
 * @fileoverview Controlador RPC de FormularioUbicacionesMaxMin.
 *
 * Expone funciones globales compatibles con google.script.run y coordina el
 * contrato de entrada y salida entre la vista y
 * FormularioUbicacionesMaxMinService.
 *
 * RESPONSABILIDADES
 * - Publicar endpoints globales invocables mediante google.script.run.
 * - Validar la estructura mínima de los argumentos recibidos.
 * - Componer el bootstrap específico de la vista con usuarios y registros
 *   pendientes de UBICACIONES_MAXMIN.
 * - Delegar las reglas de negocio y la persistencia al Service.
 * - Mantener respuestas serializables y errores accionables.
 * - Evitar registrar payloads completos o valores personales.
 *
 * ESTE CONTROLADOR NO DEBE
 * - Leer o escribir Google Sheets directamente.
 * - Consultar repositorios directamente.
 * - Calcular EXISTENCIA, PORCENTAJE, MAXIMO o MINIMO.
 * - Resolver productos desde CATALOGO.
 * - Adquirir ScriptLock.
 * - Confiar en FECHA, HORA o VALIDACION enviados por el navegador.
 *
 * ENDPOINTS RPC
 * - FormularioUbicacionesMaxMinController_getBootstrap().
 * - FormularioUbicacionesMaxMinController_buscarProductoPorCodigo(codigo).
 * - FormularioUbicacionesMaxMinController_obtenerPorCodigo(codigo).
 * - FormularioUbicacionesMaxMinController_obtenerPorIdentidad(
 *     codigo,
 *     bodega,
 *     ubicacion
 *   ).
 * - FormularioUbicacionesMaxMinController_guardar(payload).
 * - FormularioUbicacionesMaxMinController_actualizar(numFila, payload).
 * - FormularioUbicacionesMaxMinController_diagnosticar().
 *
 * DEPENDENCIAS GLOBALES
 * - execController_(operationName, callback).
 * - BootstrapServices.getInfoInicial(forceRefresh).
 * - FormularioUbicacionesMaxMinService.
 *
 * NOTA SOBRE GOOGLE APPS SCRIPT
 * Las funciones RPC se declaran en el ámbito global. No deben encerrarse en un
 * IIFE, clase u objeto porque google.script.run solo publica funciones globales
 * del servidor.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version FORMULARIO-UBICACIONES-MAXMIN-CONTROLLER-2026-11-06-02
 */
"use strict";

/**
 * Configuración interna e inmutable del controlador.
 *
 * @private
 * @const {!Object}
 */
const FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG = Object.freeze({
  NAME: "FormularioUbicacionesMaxMinController",
  VERSION: "FORMULARIO-UBICACIONES-MAXMIN-CONTROLLER-2026-11-06-02",
  LOG_PREFIX: "[FormularioUbicacionesMaxMinController]",
  MIN_DATA_ROW: 2,
  OPERATIONS: Object.freeze({
    GET_BOOTSTRAP: "getBootstrap",
    SEARCH_PRODUCT: "buscarProductoPorCodigo",
    GET_BY_CODE: "obtenerPorCodigo",
    GET_BY_IDENTITY: "obtenerPorIdentidad",
    SAVE: "guardar",
    UPDATE: "actualizar",
    DIAGNOSE: "diagnosticar"
  })
});

// =============================================================================
// UTILIDADES PRIVADAS
// =============================================================================

/**
 * Verifica las dependencias globales comunes del controlador.
 *
 * @return {void}
 * @throws {Error} Si falta una dependencia obligatoria.
 * @private
 */
function FormularioUbicacionesMaxMinController_validateDependencies_() {
  const missing = [];

  if (typeof execController_ !== "function") {
    missing.push("execController_");
  }
  if (
    typeof FormularioUbicacionesMaxMinService === "undefined" ||
    !FormularioUbicacionesMaxMinService
  ) {
    missing.push("FormularioUbicacionesMaxMinService");
  }

  if (missing.length > 0) {
    throw new Error(
      `${FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.LOG_PREFIX} ` +
        `Faltan dependencias globales: ${missing.join(", ")}.`
    );
  }
}

/**
 * Obtiene un método obligatorio del Service.
 *
 * @param {string} methodName Nombre del método.
 * @return {Function} Referencia al método disponible.
 * @throws {Error} Si el método no existe.
 * @private
 */
function FormularioUbicacionesMaxMinController_requireServiceMethod_(
  methodName
) {
  FormularioUbicacionesMaxMinController_validateDependencies_();

  const method = FormularioUbicacionesMaxMinService[methodName];
  if (typeof method !== "function") {
    throw new Error(
      `${FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.LOG_PREFIX} ` +
        `FormularioUbicacionesMaxMinService.${methodName} no está disponible.`
    );
  }
  return method;
}

/**
 * Ejecuta una operación mediante el wrapper transversal del proyecto.
 *
 * @param {string} operationName Nombre corto de la operación.
 * @param {function(): *} callback Operación delegada.
 * @return {*} Respuesta serializable.
 * @private
 */
function FormularioUbicacionesMaxMinController_execute_(
  operationName,
  callback
) {
  FormularioUbicacionesMaxMinController_validateDependencies_();

  if (typeof operationName !== "string" || !operationName.trim()) {
    throw new TypeError(
      `${FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.LOG_PREFIX} ` +
        "El nombre de la operación es obligatorio."
    );
  }
  if (typeof callback !== "function") {
    throw new TypeError(
      `${FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.LOG_PREFIX} ` +
        "El callback de la operación debe ser una función."
    );
  }

  return execController_(
    `${FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.NAME}.` +
      `${operationName}`,
    callback
  );
}

/**
 * Normaliza un texto obligatorio en mayúsculas.
 *
 * @param {*} value Valor original.
 * @param {string} fieldName Nombre del campo.
 * @return {string} Texto normalizado.
 * @throws {TypeError} Si el valor está vacío.
 * @private
 */
function FormularioUbicacionesMaxMinController_requireUpperText_(
  value,
  fieldName
) {
  const normalized = String(value == null ? "" : value)
    .trim()
    .toUpperCase();

  if (!normalized) {
    throw new TypeError(
      `${FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.LOG_PREFIX} ` +
        `${fieldName} es obligatorio.`
    );
  }
  return normalized;
}

/**
 * Valida que un payload sea un objeto simple no vacío.
 *
 * @param {*} payload Valor recibido mediante RPC.
 * @return {!Object} Mismo objeto validado.
 * @throws {TypeError} Si el payload es inválido.
 * @private
 */
function FormularioUbicacionesMaxMinController_requirePayload_(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError(
      `${FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.LOG_PREFIX} ` +
        "El payload debe ser un objeto válido."
    );
  }
  if (Object.keys(payload).length === 0) {
    throw new TypeError(
      `${FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.LOG_PREFIX} ` +
        "El payload no puede estar vacío."
    );
  }
  return payload;
}

/**
 * Valida un número físico de fila de datos.
 *
 * @param {*} numFila Valor recibido.
 * @return {number} Número de fila validado.
 * @throws {TypeError} Si no es un entero mayor o igual a dos.
 * @private
 */
function FormularioUbicacionesMaxMinController_requireRowNumber_(numFila) {
  const rowNumber = Number(numFila);
  if (
    !Number.isInteger(rowNumber) ||
    rowNumber < FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.MIN_DATA_ROW
  ) {
    throw new TypeError(
      `${FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.LOG_PREFIX} ` +
        `numFila debe ser un entero mayor o igual a ` +
        `${FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.MIN_DATA_ROW}.`
    );
  }
  return rowNumber;
}

/**
 * Obtiene el bootstrap general desde BootstrapServices.
 *
 * @return {!Object} Bootstrap general o contrato vacío estable.
 * @private
 */
function FormularioUbicacionesMaxMinController_getGeneralBootstrap_() {
  if (
    typeof BootstrapServices === "undefined" ||
    !BootstrapServices ||
    typeof BootstrapServices.getInfoInicial !== "function"
  ) {
    return {
      usuarios: [],
      registrosPendientesUbicacionesMaxMin: [],
      codigosPendientesUbicacionesMaxMin: []
    };
  }

  const bootstrap = BootstrapServices.getInfoInicial(false);
  return bootstrap && typeof bootstrap === "object"
    ? bootstrap
    : {
        usuarios: [],
        registrosPendientesUbicacionesMaxMin: [],
        codigosPendientesUbicacionesMaxMin: []
      };
}

/**
 * Proyecta un usuario al contrato estable de la vista.
 *
 * No filtra por rol. Todos los usuarios obtenidos del repositorio permanecen
 * seleccionables, conforme al requisito funcional del formulario.
 *
 * @param {!Object} user Usuario de origen.
 * @return {!Object} Usuario serializable.
 * @private
 */
function FormularioUbicacionesMaxMinController_projectUser_(user) {
  return {
    idUsuarios: String(
      user.idUsuarios ||
      user.idusuarios ||
      user.IDUSUARIOS ||
      ""
    ).trim(),
    nombre: String(user.nombre || user.NOMBRE || "").trim(),
    rol: String(user.rol || user.ROL || "").trim()
  };
}

/**
 * Proyecta un registro pendiente al contrato consumido por la vista.
 *
 * @param {!Object} item Registro de UBICACIONES_MAXMIN.
 * @return {!Object} Registro serializable.
 * @private
 */
function FormularioUbicacionesMaxMinController_projectPendingRecord_(item) {
  return {
    numFila: Number(item.numFila || 0),
    codigo: String(item.codigo || "").trim().toUpperCase(),
    descripcion: String(item.descripcion || "").trim().toUpperCase(),
    bodega: String(item.bodega || "").trim().toUpperCase(),
    ubicacion: String(item.ubicacion || "").trim().toUpperCase(),
    existencia: Number(item.existencia || 0),
    porcentaje: Number(item.porcentaje || 0),
    maximo: Number(item.maximo || 0),
    minimo: Number(item.minimo || 0),
    zonaBodega: String(item.zonaBodega || "").trim().toUpperCase(),
    zonaAbastecimiento: String(item.zonaAbastecimiento || "")
      .trim()
      .toUpperCase(),
    zonaNivel: String(item.zonaNivel || "").trim().toUpperCase(),
    fecha: String(item.fecha || "").trim(),
    hora: String(item.hora || "").trim(),
    usuario: String(item.usuario || "").trim(),
    validacion: String(item.validacion || "").trim().toUpperCase()
  };
}

// =============================================================================
// ENDPOINTS RPC GLOBALES
// =============================================================================

/**
 * Obtiene el bootstrap específico de FormularioUbicacionesMaxMin.
 *
 * Combina el contrato técnico del Service con usuarios y registros pendientes
 * del bootstrap general. El resultado coincide con lo esperado por la vista:
 *
 * {
 *   usuarios: Array<Object>,
 *   registrosPendientes: Array<Object>,
 *   codigosPendientes: Array<string>,
 *   configuracion: Object
 * }
 *
 * @return {!Object} Bootstrap serializable de la vista.
 */
function FormularioUbicacionesMaxMinController_getBootstrap() {
  return FormularioUbicacionesMaxMinController_execute_(
    FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.OPERATIONS.GET_BOOTSTRAP,
    function () {
      const getModuleBootstrap =
        FormularioUbicacionesMaxMinController_requireServiceMethod_(
          "getBootstrap"
        );
      const moduleBootstrap = getModuleBootstrap.call(
        FormularioUbicacionesMaxMinService
      );
      const generalBootstrap =
        FormularioUbicacionesMaxMinController_getGeneralBootstrap_();

      const usuarios = (Array.isArray(generalBootstrap.usuarios)
        ? generalBootstrap.usuarios
        : [])
        .map(FormularioUbicacionesMaxMinController_projectUser_)
        .filter(function (user) {
          return Boolean(user.nombre);
        });

      const registrosPendientes = (
        Array.isArray(
          generalBootstrap.registrosPendientesUbicacionesMaxMin
        )
          ? generalBootstrap.registrosPendientesUbicacionesMaxMin
          : []
      )
        .map(
          FormularioUbicacionesMaxMinController_projectPendingRecord_
        )
        .filter(function (item) {
          return Boolean(item.codigo && item.numFila >= 2);
        });

      const codigosPendientes = Array.isArray(
        generalBootstrap.codigosPendientesUbicacionesMaxMin
      )
        ? generalBootstrap.codigosPendientesUbicacionesMaxMin.slice()
        : [];

      return {
        usuarios: usuarios,
        registrosPendientes: registrosPendientes,
        codigosPendientes: codigosPendientes,
        configuracion: moduleBootstrap || {}
      };
    }
  );
}

/**
 * Busca un producto por código y devuelve sus ubicaciones registradas.
 *
 * @param {*} codigo Código de producto.
 * @return {!Object} Producto y ubicaciones.
 */
function FormularioUbicacionesMaxMinController_buscarProductoPorCodigo(
  codigo
) {
  const normalizedCode =
    FormularioUbicacionesMaxMinController_requireUpperText_(
      codigo,
      "CODIGO"
    );

  return FormularioUbicacionesMaxMinController_execute_(
    FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.OPERATIONS.SEARCH_PRODUCT,
    function () {
      const method =
        FormularioUbicacionesMaxMinController_requireServiceMethod_(
          "buscarProductoPorCodigo"
        );
      return method.call(
        FormularioUbicacionesMaxMinService,
        normalizedCode
      );
    }
  );
}

/**
 * Obtiene los registros asociados a un código.
 *
 * @param {*} codigo Código de producto.
 * @return {!Array<!Object>} Registros encontrados.
 */
function FormularioUbicacionesMaxMinController_obtenerPorCodigo(codigo) {
  const normalizedCode =
    FormularioUbicacionesMaxMinController_requireUpperText_(
      codigo,
      "CODIGO"
    );

  return FormularioUbicacionesMaxMinController_execute_(
    FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.OPERATIONS.GET_BY_CODE,
    function () {
      const method =
        FormularioUbicacionesMaxMinController_requireServiceMethod_(
          "obtenerPorCodigo"
        );
      return method.call(
        FormularioUbicacionesMaxMinService,
        normalizedCode
      );
    }
  );
}

/**
 * Obtiene un registro por su identidad funcional exacta.
 *
 * @param {*} codigo Código de producto.
 * @param {*} bodega Bodega.
 * @param {*} ubicacion Ubicación.
 * @return {?Object} Registro encontrado o null.
 */
function FormularioUbicacionesMaxMinController_obtenerPorIdentidad(
  codigo,
  bodega,
  ubicacion
) {
  const normalizedCode =
    FormularioUbicacionesMaxMinController_requireUpperText_(
      codigo,
      "CODIGO"
    );
  const normalizedWarehouse =
    FormularioUbicacionesMaxMinController_requireUpperText_(
      bodega,
      "BODEGA"
    );
  const normalizedLocation =
    FormularioUbicacionesMaxMinController_requireUpperText_(
      ubicacion,
      "UBICACION"
    );

  return FormularioUbicacionesMaxMinController_execute_(
    FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.OPERATIONS.GET_BY_IDENTITY,
    function () {
      const method =
        FormularioUbicacionesMaxMinController_requireServiceMethod_(
          "obtenerPorIdentidad"
        );
      return method.call(
        FormularioUbicacionesMaxMinService,
        normalizedCode,
        normalizedWarehouse,
        normalizedLocation
      );
    }
  );
}

/**
 * Inserta o actualiza un registro por su identidad funcional.
 *
 * @param {*} payload Datos del formulario.
 * @return {!Object} Resultado de persistencia.
 */
function FormularioUbicacionesMaxMinController_guardar(payload) {
  const validatedPayload =
    FormularioUbicacionesMaxMinController_requirePayload_(payload);

  return FormularioUbicacionesMaxMinController_execute_(
    FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.OPERATIONS.SAVE,
    function () {
      const method =
        FormularioUbicacionesMaxMinController_requireServiceMethod_(
          "guardar"
        );
      return method.call(
        FormularioUbicacionesMaxMinService,
        validatedPayload
      );
    }
  );
}

/**
 * Actualiza una fila existente de UBICACIONES_MAXMIN.
 *
 * @param {*} numFila Número físico de fila.
 * @param {*} payload Datos del formulario.
 * @return {!Object} Registro actualizado.
 */
function FormularioUbicacionesMaxMinController_actualizar(
  numFila,
  payload
) {
  const rowNumber =
    FormularioUbicacionesMaxMinController_requireRowNumber_(numFila);
  const validatedPayload =
    FormularioUbicacionesMaxMinController_requirePayload_(payload);

  return FormularioUbicacionesMaxMinController_execute_(
    FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.OPERATIONS.UPDATE,
    function () {
      const method =
        FormularioUbicacionesMaxMinController_requireServiceMethod_(
          "actualizar"
        );
      return method.call(
        FormularioUbicacionesMaxMinService,
        rowNumber,
        validatedPayload
      );
    }
  );
}

/**
 * Devuelve un diagnóstico seguro de disponibilidad de las capas del módulo.
 *
 * No incluye Spreadsheet IDs, nombres de usuario ni contenido de registros.
 *
 * @return {!Object} Estado de las dependencias.
 */
function FormularioUbicacionesMaxMinController_diagnosticar() {
  return FormularioUbicacionesMaxMinController_execute_(
    FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.OPERATIONS.DIAGNOSE,
    function () {
      return {
        controller: {
          name: FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.NAME,
          version: FORMULARIO_UBICACIONES_MAXMIN_CONTROLLER_CONFIG.VERSION,
          available: true
        },
        dependencies: {
          execController: typeof execController_ === "function",
          bootstrapServices:
            typeof BootstrapServices !== "undefined" &&
            BootstrapServices !== null &&
            typeof BootstrapServices.getInfoInicial === "function",
          service:
            typeof FormularioUbicacionesMaxMinService !== "undefined" &&
            FormularioUbicacionesMaxMinService !== null,
          serviceBootstrap:
            typeof FormularioUbicacionesMaxMinService !== "undefined" &&
            FormularioUbicacionesMaxMinService !== null &&
            typeof FormularioUbicacionesMaxMinService.getBootstrap ===
              "function",
          repository:
            typeof UbicacionesMaxMinRepository !== "undefined" &&
            UbicacionesMaxMinRepository !== null
        },
        generatedAt: new Date().toISOString()
      };
    }
  );
}
