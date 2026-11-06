/**
 * z3-FormularioUbicacionesMaxMinService.gs
 *
 * @fileoverview Servicio de dominio para la captura inicial de existencias y
 * capacidad física de los registros de UBICACIONES_MAXMIN.
 *
 * Este módulo coordina CatalogoRepository, UsuariosRepository y
 * UbicacionesMaxMinRepository. La vista proporciona la fila seleccionada, el
 * usuario responsable, la existencia observada y el porcentaje estimado de
 * ocupación. El servicio valida esos datos, resuelve las entidades autoritativas
 * y calcula MAXIMO antes de delegar la escritura al repositorio.
 *
 * RESPONSABILIDADES
 * - Validar el contrato funcional del formulario.
 * - Verificar que el producto exista y esté activo en CATALOGO.
 * - Verificar que el usuario seleccionado exista en USUARIOS, sin filtrar por rol.
 * - Obtener la fila autoritativa desde UbicacionesMaxMinRepository.
 * - Conservar BODEGA, UBICACION, MINIMO, zonas y VALIDACION de la fila existente.
 * - Aceptar PORCENTAJE como dato capturado por el usuario.
 * - Calcular MAXIMO cuando PORCENTAJE es menor que 100.
 * - Usar EXISTENCIA como MAXIMO cuando PORCENTAJE es 100 y MAXIMO está vacío.
 * - Delegar la persistencia y el control de concurrencia al Repository.
 * - Entregar respuestas planas y serializables al Controller.
 *
 * REGLAS DE DOMINIO
 * - CODIGO, USUARIO y numFila son obligatorios para actualizar.
 * - EXISTENCIA debe ser un entero no negativo.
 * - PORCENTAJE debe ser un entero entre 1 y 100.
 * - Si PORCENTAJE < 100:
 *     MAXIMO = redondearADecena((EXISTENCIA / PORCENTAJE) * 100).
 * - Si PORCENTAJE = 100:
 *     MAXIMO = valor capturado; si está vacío, MAXIMO = EXISTENCIA.
 * - MAXIMO debe ser un entero no negativo y no puede ser menor que EXISTENCIA.
 * - USUARIO se valida por coincidencia exacta contra UsuariosRepository.
 * - VALIDACION no se modifica durante esta captura.
 * - FECHA y HORA son generadas por UbicacionesMaxMinRepository.
 *
 * ESTE SERVICIO NO DEBE
 * - Leer ni escribir Google Sheets directamente.
 * - Adquirir ScriptLock.
 * - Confiar en DESCRIPCION, BODEGA, UBICACION, MINIMO, zonas o VALIDACION enviados
 *   por el navegador durante una actualización por fila.
 * - Confiar en FECHA u HORA enviadas por el navegador.
 * - Filtrar usuarios por rol.
 * - Exponer IDs de Spreadsheet ni objetos de Google Apps Script.
 *
 * DEPENDENCIAS GLOBALES
 * - CatalogoRepository.
 * - UsuariosRepository.
 * - UbicacionesMaxMinRepository.
 * - UBICACIONES_MAXMIN_CONFIG.
 * - toStr_(value) y toStrUpper_(value).
 *
 * @author Sigifredo de la Cruz Ramos
 * @version FORMULARIO-UBICACIONES-MAXMIN-SERVICE-2026-11-06-02
 */
const FormularioUbicacionesMaxMinService = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    LOG_PREFIX: "[FormularioUbicacionesMaxMinService]",
    PRODUCT_STATUS_ACTIVE: "ACTIVO",
    MIN_PERCENTAGE: 1,
    MAX_PERCENTAGE: 100,
    ROUNDING_MULTIPLE: 10,
    FIRST_DATA_ROW: 2
  });

  // ===========================================================================
  // DEPENDENCIAS Y ERRORES
  // ===========================================================================

  /**
   * Verifica las dependencias funcionales obligatorias.
   *
   * @return {void}
   * @throws {Error} Si falta una dependencia global.
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
    if (typeof CatalogoRepository === "undefined" || !CatalogoRepository) {
      missing.push("CatalogoRepository");
    }
    if (typeof UsuariosRepository === "undefined" || !UsuariosRepository) {
      missing.push("UsuariosRepository");
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
   * Obtiene un método obligatorio de una dependencia.
   *
   * @param {!Object} target Dependencia.
   * @param {string} dependencyName Nombre lógico de la dependencia.
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

  /**
   * Obtiene un código configurado o utiliza un respaldo estable.
   *
   * @param {string} key Clave de UBICACIONES_MAXMIN_CONFIG.ERROR_CODES.
   * @param {string} fallback Código de respaldo.
   * @return {string} Código disponible.
   * @private
   */
  function _errorCode_(key, fallback) {
    return String(
      UBICACIONES_MAXMIN_CONFIG.ERROR_CODES?.[key] || fallback
    );
  }

  // ===========================================================================
  // NORMALIZACIÓN E IDENTIDADES AUTORITATIVAS
  // ===========================================================================

  /**
   * Valida un payload de entrada como objeto simple no vacío.
   *
   * @param {*} payload Datos recibidos.
   * @return {!Object} Mismo objeto validado.
   * @throws {Error} Si el payload es inválido.
   * @private
   */
  function _requirePayload_(payload) {
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).length === 0
    ) {
      throw _domainError_(
        _errorCode_("PAYLOAD_INVALIDO", "UBMAXMIN_PAYLOAD_INVALIDO"),
        "El payload debe ser un objeto válido y no puede estar vacío."
      );
    }
    return payload;
  }

  /**
   * Convierte un valor obligatorio a entero no negativo sin ocultar texto inválido.
   *
   * @param {*} value Valor original.
   * @param {string} fieldName Nombre del campo.
   * @param {string} errorCode Código de error.
   * @return {number} Entero validado.
   * @throws {Error} Si el valor está vacío, no es finito, no es entero o es negativo.
   * @private
   */
  function _toNonNegativeInteger_(value, fieldName, errorCode) {
    if (value === "" || value === null || value === undefined) {
      throw _domainError_(errorCode, `${fieldName} es obligatorio.`);
    }

    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0) {
      throw _domainError_(
        errorCode,
        `${fieldName} debe ser un número entero mayor o igual a cero.`
      );
    }
    return number;
  }

  /**
   * Convierte y valida un número físico de fila.
   *
   * @param {*} value Número recibido.
   * @return {number} Fila validada.
   * @throws {Error} Si no corresponde a una fila de datos.
   * @private
   */
  function _requireRowNumber_(value) {
    const rowNumber = Number(value);
    if (!Number.isInteger(rowNumber) || rowNumber < CFG.FIRST_DATA_ROW) {
      throw _domainError_(
        _errorCode_("REGISTRO_NO_ENCONTRADO", "UBMAXMIN_REGISTRO_NO_ENCONTRADO"),
        "El número de fila es inválido."
      );
    }
    return rowNumber;
  }

  /**
   * Determina si un producto puede utilizarse en el formulario.
   *
   * Un estado vacío se mantiene compatible con catálogos históricos.
   *
   * @param {!Object} product Producto normalizado.
   * @return {boolean} true cuando está activo o carece de estado.
   * @private
   */
  function _isActiveProduct_(product) {
    const status = toStrUpper_(product && product.status);
    return !status || status === CFG.PRODUCT_STATUS_ACTIVE;
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
        _errorCode_("CODIGO_REQUERIDO", "UBMAXMIN_CODIGO_REQUERIDO"),
        "CODIGO es obligatorio."
      );
    }

    const getByCode = _requireMethod_(
      CatalogoRepository,
      "CatalogoRepository",
      "getPorCodigo"
    );
    const matches = getByCode.call(CatalogoRepository, normalizedCode);
    if (!Array.isArray(matches)) {
      throw new Error(
        `${CFG.LOG_PREFIX} CatalogoRepository.getPorCodigo no devolvió un arreglo.`
      );
    }
    if (matches.length === 0) {
      throw _domainError_(
        _errorCode_("REGISTRO_NO_ENCONTRADO", "UBMAXMIN_REGISTRO_NO_ENCONTRADO"),
        `El código ${normalizedCode} no existe en CATALOGO.`
      );
    }

    const activeMatches = matches.filter(_isActiveProduct_);
    if (activeMatches.length === 0) {
      throw _domainError_(
        _errorCode_("REGISTRO_NO_ENCONTRADO", "UBMAXMIN_REGISTRO_NO_ENCONTRADO"),
        `El código ${normalizedCode} no está activo en CATALOGO.`
      );
    }
    if (activeMatches.length > 1) {
      throw _domainError_(
        _errorCode_("PAYLOAD_INVALIDO", "UBMAXMIN_PAYLOAD_INVALIDO"),
        `El código ${normalizedCode} tiene ${activeMatches.length} registros activos en CATALOGO.`
      );
    }

    const product = activeMatches[0];
    return Object.freeze({
      idProducto: toStr_(product.idproducto || product.idProducto),
      codigo: toStrUpper_(product.codigo),
      descripcion: toStrUpper_(product.descripcion),
      status: toStrUpper_(product.status)
    });
  }

  /**
   * Resuelve un usuario único mediante coincidencia exacta de nombre.
   *
   * No se aplica filtro por rol. El rol se conserva únicamente como dato
   * descriptivo del catálogo de usuarios.
   *
   * @param {*} usuario Nombre seleccionado.
   * @return {!Object} Usuario autoritativo.
   * @throws {Error} Si no existe o está duplicado.
   * @private
   */
  function _resolveUser_(usuario) {
    const normalizedName = toStrUpper_(usuario);
    if (!normalizedName) {
      throw _domainError_(
        _errorCode_("PAYLOAD_INVALIDO", "UBMAXMIN_PAYLOAD_INVALIDO"),
        "USUARIO es obligatorio."
      );
    }

    const getByName = _requireMethod_(
      UsuariosRepository,
      "UsuariosRepository",
      "getPorNombre"
    );
    const matches = getByName.call(UsuariosRepository, normalizedName);
    if (!Array.isArray(matches)) {
      throw new Error(
        `${CFG.LOG_PREFIX} UsuariosRepository.getPorNombre no devolvió un arreglo.`
      );
    }
    if (matches.length === 0) {
      throw _domainError_(
        _errorCode_("PAYLOAD_INVALIDO", "UBMAXMIN_PAYLOAD_INVALIDO"),
        `El usuario ${normalizedName} no existe en USUARIOS.`
      );
    }
    if (matches.length > 1) {
      throw _domainError_(
        _errorCode_("PAYLOAD_INVALIDO", "UBMAXMIN_PAYLOAD_INVALIDO"),
        `El usuario ${normalizedName} está duplicado en USUARIOS.`
      );
    }

    const user = matches[0];
    return Object.freeze({
      idusuario: Number(user.idusuario || 0),
      nombre: toStrUpper_(user.nombre),
      rol: toStrUpper_(user.rol)
    });
  }

  /**
   * Obtiene un registro autoritativo mediante su fila física.
   *
   * @param {*} numFila Número de fila.
   * @return {!Object} Registro existente.
   * @throws {Error} Si la fila no existe.
   * @private
   */
  function _resolveExistingRow_(numFila) {
    const rowNumber = _requireRowNumber_(numFila);
    const getByRow = _requireMethod_(
      UbicacionesMaxMinRepository,
      "UbicacionesMaxMinRepository",
      "getPorNumeroFila"
    );
    const current = getByRow.call(UbicacionesMaxMinRepository, rowNumber);
    if (!current) {
      throw _domainError_(
        _errorCode_("REGISTRO_NO_ENCONTRADO", "UBMAXMIN_REGISTRO_NO_ENCONTRADO"),
        `No existe un registro en la fila ${rowNumber}.`
      );
    }
    return current;
  }

  // ===========================================================================
  // CÁLCULOS DEL DOMINIO
  // ===========================================================================

  /**
   * Valida el porcentaje de ocupación capturado.
   *
   * @param {*} value Porcentaje recibido.
   * @return {number} Entero entre 1 y 100.
   * @throws {Error} Si queda fuera del rango.
   * @private
   */
  function _resolvePercentage_(value) {
    const percentage = _toNonNegativeInteger_(
      value,
      "PORCENTAJE",
      _errorCode_("PORCENTAJE_INVALIDO", "UBMAXMIN_PORCENTAJE_INVALIDO")
    );
    if (
      percentage < CFG.MIN_PERCENTAGE ||
      percentage > CFG.MAX_PERCENTAGE
    ) {
      throw _domainError_(
        _errorCode_("PORCENTAJE_INVALIDO", "UBMAXMIN_PORCENTAJE_INVALIDO"),
        `PORCENTAJE debe estar entre ${CFG.MIN_PERCENTAGE} y ${CFG.MAX_PERCENTAGE}.`
      );
    }
    return percentage;
  }

  /**
   * Redondea un valor a la decena más cercana.
   *
   * @param {number} value Valor finito.
   * @return {number} Entero múltiplo de diez.
   * @private
   */
  function _roundToNearestTen_(value) {
    return Math.round(value / CFG.ROUNDING_MULTIPLE) * CFG.ROUNDING_MULTIPLE;
  }

  /**
   * Calcula el máximo conforme al porcentaje capturado.
   *
   * @param {number} existencia Existencia observada.
   * @param {number} porcentaje Porcentaje de ocupación.
   * @param {*} maximoCapturado Máximo opcional cuando porcentaje es 100.
   * @return {number} Máximo validado.
   * @throws {Error} Si el máximo manual es inválido o menor que la existencia.
   * @private
   */
  function _calculateMaximum_(existencia, porcentaje, maximoCapturado) {
    let maximum;

    if (porcentaje === CFG.MAX_PERCENTAGE) {
      maximum =
        maximoCapturado === "" ||
        maximoCapturado === null ||
        maximoCapturado === undefined
          ? existencia
          : _toNonNegativeInteger_(
              maximoCapturado,
              "MAXIMO",
              _errorCode_("MAXIMO_INVALIDO", "UBMAXMIN_MAXIMO_INVALIDO")
            );
    } else {
      maximum = _roundToNearestTen_((existencia / porcentaje) * 100);
    }

    if (!Number.isFinite(maximum) || !Number.isInteger(maximum) || maximum < 0) {
      throw _domainError_(
        _errorCode_("MAXIMO_INVALIDO", "UBMAXMIN_MAXIMO_INVALIDO"),
        "MAXIMO no pudo calcularse como un entero no negativo."
      );
    }
    if (maximum < existencia) {
      throw _domainError_(
        _errorCode_("RANGO_INVALIDO", "UBMAXMIN_RANGO_INVALIDO"),
        "MAXIMO no puede ser menor que EXISTENCIA."
      );
    }
    return maximum;
  }

  /**
   * Comprueba que el código del payload corresponda a la fila seleccionada.
   *
   * @param {!Object} current Registro actual.
   * @param {!Object} product Producto resuelto.
   * @return {void}
   * @throws {Error} Si la fila y el producto no coinciden.
   * @private
   */
  function _assertRowProduct_(current, product) {
    if (toStrUpper_(current.codigo) !== product.codigo) {
      throw _domainError_(
        _errorCode_("PAYLOAD_INVALIDO", "UBMAXMIN_PAYLOAD_INVALIDO"),
        "El código enviado no corresponde a la fila seleccionada."
      );
    }
  }

  /**
   * Construye el registro autorizado para actualizar una fila existente.
   *
   * Los datos estructurales se toman del Repository, no del navegador.
   *
   * @param {*} numFila Número físico de fila.
   * @param {*} payload Datos de captura.
   * @return {{rowNumber:number,record:!Object}} Registro listo para persistencia.
   * @private
   */
  function _buildUpdateCommand_(numFila, payload) {
    const source = _requirePayload_(payload);
    const rowNumber = _requireRowNumber_(numFila);
    const current = _resolveExistingRow_(rowNumber);
    const product = _resolveProduct_(source.codigo || current.codigo);
    const user = _resolveUser_(source.usuario);
    const existence = _toNonNegativeInteger_(
      source.existencia,
      "EXISTENCIA",
      _errorCode_("EXISTENCIA_INVALIDA", "UBMAXMIN_EXISTENCIA_INVALIDA")
    );
    const percentage = _resolvePercentage_(source.porcentaje);
    const maximum = _calculateMaximum_(
      existence,
      percentage,
      source.maximo
    );

    _assertRowProduct_(current, product);

    return {
      rowNumber,
      record: {
        numFila: rowNumber,
        codigo: current.codigo,
        descripcion: product.descripcion,
        bodega: current.bodega,
        ubicacion: current.ubicacion,
        existencia: existence,
        porcentaje: percentage,
        maximo: maximum,
        minimo: Number(current.minimo || 0),
        zonaBodega: current.zonaBodega,
        zonaAbastecimiento: current.zonaAbastecimiento,
        zonaNivel: current.zonaNivel,
        usuario: user.nombre,
        validacion: current.validacion
      }
    };
  }

  // ===========================================================================
  // API DE CONSULTA
  // ===========================================================================

  /**
   * Entrega la configuración técnica del formulario.
   *
   * Los usuarios y registros pendientes se componen en el Controller a partir de
   * BootstrapServices. Este método valida además que la hoja física cumpla A:O.
   *
   * @return {!Object} Bootstrap técnico serializable.
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
        porcentajeCapturadoPorUsuario: true,
        porcentajeMinimo: CFG.MIN_PERCENTAGE,
        porcentajeMaximo: CFG.MAX_PERCENTAGE,
        maximoCalculadoEnServidor: true,
        maximoEditableAlCienPorCiento: true,
        maximoVacioAlCienUsaExistencia: true,
        redondeoMaximoMultiplo: CFG.ROUNDING_MULTIPLE,
        usuarioValidadoContraCatalogo: true,
        usuariosSinFiltroDeRol: true,
        descripcionAutoritativaDesdeCatalogo: true,
        datosEstructuralesAutoritativosDesdeFila: true,
        validacionConservada: true
      },
      source: {
        sheetName: contract.sheetName,
        width: contract.width,
        headers: Array.isArray(contract.headers)
          ? contract.headers.slice()
          : []
      }
    };
  }

  /**
   * Busca un producto activo y devuelve sus ubicaciones registradas.
   *
   * @param {*} codigo Código de producto.
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
      producto: { ...product },
      ubicaciones: Array.isArray(locations) ? locations : []
    };
  }

  /**
   * Obtiene los registros asociados a un código.
   *
   * @param {*} codigo Código de producto.
   * @return {!Array<!Object>} Registros encontrados.
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
   * Guarda un registro existente mediante la fila incluida en el payload.
   *
   * La captura de este formulario opera sobre filas previamente creadas en
   * UBICACIONES_MAXMIN. Por seguridad, este método no realiza inserciones.
   *
   * @param {*} payload Datos del formulario con numFila.
   * @return {!Object} Registro actualizado.
   */
  function guardar(payload) {
    _validateDependencies_();
    const source = _requirePayload_(payload);
    return actualizar(source.numFila, source);
  }

  /**
   * Actualiza una fila existente con datos de captura validados.
   *
   * @param {*} numFila Número físico de fila.
   * @param {*} payload Datos del formulario.
   * @return {!Object} Registro actualizado.
   */
  function actualizar(numFila, payload) {
    _validateDependencies_();
    const command = _buildUpdateCommand_(numFila, payload);
    const update = _requireMethod_(
      UbicacionesMaxMinRepository,
      "UbicacionesMaxMinRepository",
      "actualizar"
    );

    return update.call(
      UbicacionesMaxMinRepository,
      command.rowNumber,
      command.record
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
