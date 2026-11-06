/**
 * z3-FormularioUbicacionesMaxMinService.gs
 *
 * @fileoverview Servicio de dominio para registrar y consultar ubicaciones,
 * existencias y parámetros máximos y mínimos por producto.
 *
 * Este módulo coordina CatalogoRepository y UbicacionesMaxMinRepository. Resuelve
 * la identidad y descripción autoritativas del producto desde CATALOGO, valida el
 * contrato funcional del formulario, calcula el porcentaje de existencia respecto
 * al máximo y delega la persistencia transaccional al repositorio.
 *
 * RESPONSABILIDADES
 * - Entregar el bootstrap requerido por FormularioUbicacionesMaxMin.
 * - Buscar productos activos por código.
 * - Consultar ubicaciones registradas por código.
 * - Validar y normalizar los datos de captura.
 * - Calcular PORCENTAJE en el servidor.
 * - Resolver DESCRIPCION desde CATALOGO.
 * - Delegar insertar, actualizar o upsert al repositorio.
 * - Entregar respuestas planas y estables para el Controller.
 *
 * ESTE SERVICIO NO DEBE
 * - Leer o escribir Google Sheets directamente.
 * - Confiar en DESCRIPCION, PORCENTAJE, FECHA, HORA o USUARIO enviados por el cliente.
 * - Adquirir ScriptLock. UbicacionesMaxMinRepository protege las escrituras.
 * - Exponer arreglos físicos, Spreadsheet IDs ni objetos de Apps Script.
 *
 * REGLAS DE DOMINIO
 * - CODIGO, BODEGA y UBICACION son obligatorios.
 * - EXISTENCIA, MINIMO y MAXIMO son números finitos no negativos.
 * - MINIMO no puede ser mayor que MAXIMO.
 * - PORCENTAJE = EXISTENCIA / MAXIMO * 100 cuando MAXIMO > 0; en otro caso 0.
 * - El porcentaje se redondea a dos decimales y puede superar 100 cuando la
 *   existencia rebasa el máximo configurado.
 * - CODIGO + BODEGA + UBICACION constituye la identidad funcional.
 *
 * DEPENDENCIAS GLOBALES
 * - CatalogoRepository.
 * - UbicacionesMaxMinRepository.
 * - UBICACIONES_MAXMIN_CONFIG.
 * - toStr_(value), toStrUpper_(value) y toNum_(value).
 *
 * @author Sigifredo de la Cruz Ramos
 * @version FORMULARIO-UBICACIONES-MAXMIN-SERVICE-2026-11-06-01
 */
const FormularioUbicacionesMaxMinService = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    LOG_PREFIX: "[FormularioUbicacionesMaxMinService]",
    PERCENT_DECIMALS: 2,
    PRODUCT_STATUS_ACTIVE: "ACTIVO"
  });

  // ===========================================================================
  // DEPENDENCIAS Y CONTRATOS
  // ===========================================================================

  /**
   * Verifica las dependencias funcionales del servicio.
   *
   * @return {void}
   * @throws {Error} Si falta una dependencia obligatoria.
   * @private
   */
  function _validateDependencies_() {
    const missing = [];

    if (typeof toStr_ !== "function") {
      missing.push("toStr_");
    }
    if (typeof toStrUpper_ !== "function") {
      missing.push("toStrUpper_");
    }
    if (typeof toNum_ !== "function") {
      missing.push("toNum_");
    }
    if (typeof CatalogoRepository === "undefined" || !CatalogoRepository) {
      missing.push("CatalogoRepository");
    }
    if (
      typeof UbicacionesMaxMinRepository === "undefined" ||
      !UbicacionesMaxMinRepository
    ) {
      missing.push("UbicacionesMaxMinRepository");
    }
    if (
      typeof UBICACIONES_MAXMIN_CONFIG === "undefined" ||
      !UBICACIONES_MAXMIN_CONFIG
    ) {
      missing.push("UBICACIONES_MAXMIN_CONFIG");
    }

    if (missing.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan dependencias globales: ${missing.join(", ")}.`
      );
    }
  }

  /**
   * Obtiene un método obligatorio de un objeto global.
   *
   * @param {!Object} target Dependencia.
   * @param {string} dependencyName Nombre lógico.
   * @param {string} methodName Método requerido.
   * @return {Function} Método disponible.
   * @throws {Error} Si el método no existe.
   * @private
   */
  function _requireMethod_(target, dependencyName, methodName) {
    if (!target || typeof target[methodName] !== "function") {
      throw new Error(
        `${CFG.LOG_PREFIX} ${dependencyName}.${methodName} no está disponible.`
      );
    }
    return target[methodName];
  }

  /**
   * Crea un error de dominio con código estable.
   *
   * @param {string} code Código público.
   * @param {string} message Mensaje accionable.
   * @return {!Error} Error preparado.
   * @private
   */
  function _domainError_(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  // ===========================================================================
  // NORMALIZACIÓN Y VALIDACIÓN
  // ===========================================================================

  /**
   * Convierte un valor obligatorio a número finito no negativo.
   *
   * @param {*} value Valor de entrada.
   * @param {string} fieldName Nombre del campo.
   * @param {string} errorCode Código de error.
   * @return {number} Número validado.
   * @throws {Error} Si el valor es vacío, no finito o negativo.
   * @private
   */
  function _toNonNegativeNumber_(value, fieldName, errorCode) {
    if (value === "" || value === null || value === undefined) {
      throw _domainError_(errorCode, `${fieldName} es obligatorio.`);
    }

    const number = toNum_(value);
    if (!Number.isFinite(number) || number < 0) {
      throw _domainError_(
        errorCode,
        `${fieldName} debe ser un número finito mayor o igual a cero.`
      );
    }
    return number;
  }

  /**
   * Limita y valida la longitud de un texto normalizado.
   *
   * @param {*} value Valor original.
   * @param {string} fieldName Nombre del campo.
   * @param {number} maxLength Longitud máxima.
   * @param {boolean=} uppercase Convierte a mayúsculas.
   * @return {string} Texto normalizado.
   * @throws {Error} Si excede la longitud permitida.
   * @private
   */
  function _normalizeText_(value, fieldName, maxLength, uppercase = false) {
    const normalized = uppercase ? toStrUpper_(value) : toStr_(value);
    if (normalized.length > maxLength) {
      throw _domainError_(
        UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO,
        `${fieldName} excede la longitud máxima de ${maxLength} caracteres.`
      );
    }
    return normalized;
  }

  /**
   * Calcula el porcentaje de existencia respecto al máximo.
   *
   * @param {number} existencia Existencia actual.
   * @param {number} maximo Máximo configurado.
   * @return {number} Porcentaje redondeado a dos decimales.
   * @private
   */
  function _calculatePercentage_(existencia, maximo) {
    if (maximo <= 0) {
      return 0;
    }
    const factor = Math.pow(10, CFG.PERCENT_DECIMALS);
    return Math.round((existencia / maximo) * 100 * factor) / factor;
  }

  /**
   * Determina si un producto está activo.
   *
   * Un status vacío se conserva como compatible con catálogos históricos.
   *
   * @param {!Object} product Producto normalizado por CatalogoRepository.
   * @return {boolean} true si puede capturarse.
   * @private
   */
  function _isActiveProduct_(product) {
    const status = toStrUpper_(product && product.status);
    return !status || status === CFG.PRODUCT_STATUS_ACTIVE;
  }

  /**
   * Busca coincidencias exactas en el catálogo usando la API disponible.
   *
   * @param {string} codigo Código normalizado.
   * @return {!Array<!Object>} Coincidencias de catálogo.
   * @private
   */
  function _findCatalogProducts_(codigo) {
    const getByCode = _requireMethod_(
      CatalogoRepository,
      "CatalogoRepository",
      "getPorCodigo"
    );
    const result = getByCode.call(CatalogoRepository, codigo);
    if (!Array.isArray(result)) {
      throw new Error(
        `${CFG.LOG_PREFIX} CatalogoRepository.getPorCodigo no devolvió un arreglo.`
      );
    }
    return result;
  }

  /**
   * Resuelve un producto único y activo desde CATALOGO.
   *
   * @param {*} codigo Código solicitado.
   * @return {!Object} Producto autoritativo.
   * @throws {Error} Si no existe, está inactivo o es ambiguo.
   * @private
   */
  function _resolveProduct_(codigo) {
    const normalizedCode = toStrUpper_(codigo);
    if (!normalizedCode) {
      throw _domainError_(
        UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.CODIGO_REQUERIDO,
        "CODIGO es obligatorio."
      );
    }

    const matches = _findCatalogProducts_(normalizedCode);
    if (matches.length === 0) {
      throw _domainError_(
        UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.REGISTRO_NO_ENCONTRADO,
        `El código ${normalizedCode} no existe en CATALOGO.`
      );
    }

    const active = matches.filter(_isActiveProduct_);
    if (active.length === 0) {
      throw _domainError_(
        UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.REGISTRO_NO_ENCONTRADO,
        `El código ${normalizedCode} no está activo en CATALOGO.`
      );
    }
    if (active.length > 1) {
      throw _domainError_(
        UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO,
        `El código ${normalizedCode} tiene ${active.length} registros activos en CATALOGO.`
      );
    }

    const product = active[0];
    return {
      idProducto: toStr_(product.idProducto || product.idproducto),
      codigo: toStrUpper_(product.codigo),
      descripcion: toStr_(product.descripcion),
      status: toStrUpper_(product.status)
    };
  }

  /**
   * Normaliza y valida el payload completo de captura.
   *
   * @param {*} payload Datos del formulario.
   * @return {!Object} Registro listo para el repositorio.
   * @private
   */
  function _normalizeSavePayload_(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw _domainError_(
        UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO,
        "El payload debe ser un objeto válido."
      );
    }

    const limits = UBICACIONES_MAXMIN_CONFIG.LIMITS;
    const product = _resolveProduct_(payload.codigo);
    const bodega = _normalizeText_(
      payload.bodega,
      "BODEGA",
      limits.BODEGA_MAX_LENGTH,
      true
    );
    const ubicacion = _normalizeText_(
      payload.ubicacion,
      "UBICACION",
      limits.UBICACION_MAX_LENGTH,
      true
    );

    if (!bodega) {
      throw _domainError_(
        UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.BODEGA_REQUERIDA,
        "BODEGA es obligatoria."
      );
    }
    if (!ubicacion) {
      throw _domainError_(
        UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.UBICACION_REQUERIDA,
        "UBICACION es obligatoria."
      );
    }

    const existencia = _toNonNegativeNumber_(
      payload.existencia,
      "EXISTENCIA",
      UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.EXISTENCIA_INVALIDA
    );
    const maximo = _toNonNegativeNumber_(
      payload.maximo,
      "MAXIMO",
      UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.MAXIMO_INVALIDO
    );
    const minimo = _toNonNegativeNumber_(
      payload.minimo,
      "MINIMO",
      UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.MINIMO_INVALIDO
    );

    if (minimo > maximo) {
      throw _domainError_(
        UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.RANGO_INVALIDO,
        "MINIMO no puede ser mayor que MAXIMO."
      );
    }

    return {
      numFila: Number.isInteger(Number(payload.numFila))
        ? Number(payload.numFila)
        : 0,
      codigo: product.codigo,
      descripcion: product.descripcion,
      bodega: bodega,
      ubicacion: ubicacion,
      existencia: existencia,
      porcentaje: _calculatePercentage_(existencia, maximo),
      maximo: maximo,
      minimo: minimo,
      zonaBodega: _normalizeText_(
        payload.zonaBodega,
        "ZONA_BODEGA",
        limits.ZONA_MAX_LENGTH,
        true
      ),
      zonaAbastecimiento: _normalizeText_(
        payload.zonaAbastecimiento,
        "ZONA_ABASTECIMIENTO",
        limits.ZONA_MAX_LENGTH,
        true
      ),
      zonaNivel: _normalizeText_(
        payload.zonaNivel,
        "ZONA_NIVEL",
        limits.ZONA_MAX_LENGTH,
        true
      )
    };
  }

  // ===========================================================================
  // API DE CONSULTA
  // ===========================================================================

  /**
   * Entrega la configuración inicial del formulario.
   *
   * No transporta el catálogo completo. La vista debe consultar el producto por
   * código para reducir el tamaño de respuesta y evitar datos obsoletos.
   *
   * @return {!Object} Bootstrap serializable.
   */
  function getBootstrap() {
    _validateDependencies_();
    const validateContract = _requireMethod_(
      UbicacionesMaxMinRepository,
      "UbicacionesMaxMinRepository",
      "validarContrato"
    );
    const contract = validateContract.call(UbicacionesMaxMinRepository);

    return {
      version: UBICACIONES_MAXMIN_CONFIG.VERSION,
      identityFields: UBICACIONES_MAXMIN_CONFIG.IDENTITY_FIELDS.slice(),
      serverManagedFields:
        UBICACIONES_MAXMIN_CONFIG.SERVER_MANAGED_FIELDS.slice(),
      rules: {
        porcentajeCalculadoEnServidor: true,
        porcentajePuedeSuperarCien: true,
        minimoNoMayorQueMaximo: true,
        descripcionAutoritativaDesdeCatalogo: true
      },
      source: {
        sheetName: contract.sheetName,
        width: contract.width
      }
    };
  }

  /**
   * Busca un producto en CATALOGO y sus ubicaciones ya registradas.
   *
   * @param {*} codigo Código del producto.
   * @return {{producto:!Object,ubicaciones:!Array<!Object>}} Resultado.
   */
  function buscarProductoPorCodigo(codigo) {
    _validateDependencies_();
    const product = _resolveProduct_(codigo);
    const getByCode = _requireMethod_(
      UbicacionesMaxMinRepository,
      "UbicacionesMaxMinRepository",
      "getPorCodigo"
    );
    const locations = getByCode.call(
      UbicacionesMaxMinRepository,
      product.codigo
    );

    return {
      producto: product,
      ubicaciones: Array.isArray(locations) ? locations : []
    };
  }

  /**
   * Obtiene todas las ubicaciones registradas para un código.
   *
   * @param {*} codigo Código del producto.
   * @return {!Array<!Object>} Ubicaciones registradas.
   */
  function obtenerPorCodigo(codigo) {
    _validateDependencies_();
    const normalizedCode = toStrUpper_(codigo);
    if (!normalizedCode) {
      return [];
    }
    const getByCode = _requireMethod_(
      UbicacionesMaxMinRepository,
      "UbicacionesMaxMinRepository",
      "getPorCodigo"
    );
    const result = getByCode.call(
      UbicacionesMaxMinRepository,
      normalizedCode
    );
    return Array.isArray(result) ? result : [];
  }

  /**
   * Obtiene un registro por su identidad funcional exacta.
   *
   * @param {*} codigo Código.
   * @param {*} bodega Bodega.
   * @param {*} ubicacion Ubicación.
   * @return {?Object} Registro o null.
   */
  function obtenerPorIdentidad(codigo, bodega, ubicacion) {
    _validateDependencies_();
    const getByIdentity = _requireMethod_(
      UbicacionesMaxMinRepository,
      "UbicacionesMaxMinRepository",
      "getPorIdentidad"
    );
    return getByIdentity.call(
      UbicacionesMaxMinRepository,
      codigo,
      bodega,
      ubicacion
    );
  }

  // ===========================================================================
  // API DE ESCRITURA
  // ===========================================================================

  /**
   * Guarda un registro mediante upsert por CODIGO + BODEGA + UBICACION.
   *
   * @param {*} payload Datos del formulario.
   * @return {{operation:string,record:!Object}} Resultado de persistencia.
   */
  function guardar(payload) {
    _validateDependencies_();
    const normalized = _normalizeSavePayload_(payload);
    const upsert = _requireMethod_(
      UbicacionesMaxMinRepository,
      "UbicacionesMaxMinRepository",
      "upsert"
    );
    return upsert.call(UbicacionesMaxMinRepository, normalized);
  }

  /**
   * Actualiza explícitamente una fila existente.
   *
   * Este método se reserva para flujos donde la vista ya posee numFila. El
   * repositorio vuelve a validar existencia y colisiones bajo ScriptLock.
   *
   * @param {*} numFila Número físico de fila.
   * @param {*} payload Datos del formulario.
   * @return {!Object} Registro actualizado.
   */
  function actualizar(numFila, payload) {
    _validateDependencies_();
    const rowNumber = Number(numFila);
    if (!Number.isInteger(rowNumber) || rowNumber < 2) {
      throw _domainError_(
        UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.REGISTRO_NO_ENCONTRADO,
        "El número de fila es inválido."
      );
    }

    const normalized = _normalizeSavePayload_(payload);
    const update = _requireMethod_(
      UbicacionesMaxMinRepository,
      "UbicacionesMaxMinRepository",
      "actualizar"
    );
    return update.call(
      UbicacionesMaxMinRepository,
      rowNumber,
      normalized
    );
  }

  // ===========================================================================
  // API PÚBLICA
  // ===========================================================================

  return Object.freeze({
    getBootstrap,
    buscarProductoPorCodigo,
    obtenerPorCodigo,
    obtenerPorIdentidad,
    guardar,
    actualizar
  });
})();
