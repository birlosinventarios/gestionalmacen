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
 * - Construir el bootstrap específico del formulario desde los repositorios.
 * - Entregar usuarios y códigos elegibles con CODIGO y DESCRIPCION.
 * - Segmentar códigos por STATUS=ACTIVO y captura completa en UBICACIONES_MAXMIN.
 * - Entregar respuestas planas y serializables al Controller.
 * - Correlacionar tiempos de bootstrap y escritura con Repository y Controller.
 * - Medir consultas, filtros, proyecciones, validaciones e invalidaciones sin
 *   registrar nombres, códigos, ubicaciones ni payloads completos.
 *
 * REGLAS DE DOMINIO
 * - CODIGO, USUARIO y numFila son obligatorios para actualizar.
 * - EXISTENCIA debe ser un entero no negativo.
 * - PORCENTAJE debe ser un entero entre 1 y 100.
 * - Si PORCENTAJE < 100:
 *     MAXIMO = redondearADecena((EXISTENCIA / PORCENTAJE) * 100).
 * - Si PORCENTAJE = 100:
 *     MAXIMO = valor capturado; si está vacío, MAXIMO = EXISTENCIA.
 * - MAXIMO debe ser un entero no negativo.
 * - Si PORCENTAJE < 100, MAXIMO no puede ser menor que EXISTENCIA.
 * - Si PORCENTAJE = 100, MAXIMO puede ser menor que EXISTENCIA para representar
 *   material excedente.
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
 * - Depender de BootstrapServices para cargar usuarios o códigos pendientes.
 *
 * DEPENDENCIAS GLOBALES
 * - CatalogoRepository.
 * - UsuariosRepository.
 * - UbicacionesMaxMinRepository.
 * - UBICACIONES_MAXMIN_CONFIG.
 * - toStr_(value) y toStrUpper_(value).
 * - perfStart_(), perfMark_(), perfMeasure_(), perfEnd_() y perfFail_().
 *
 * @author Sigifredo de la Cruz Ramos
 * @version FORMULARIO-UBICACIONES-MAXMIN-SERVICE-2026-11-07-04
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
    FIRST_DATA_ROW: 2,
    COMPLETE_CAPTURE_FIELDS: Object.freeze([
      "fecha",
      "hora",
      "usuario"
    ])
  });

  /** Nombre estable del módulo para seleccionar umbrales de rendimiento. */
  const PERF_MODULE = "UBICACIONES_MAXMIN";

  /**
   * Crea o reutiliza una traza de rendimiento.
   *
   * Si el Controller proporciona una traza, el Service agrega marcas a esa misma
   * correlación. Cuando se invoca directamente, el Service crea y finaliza su
   * propia traza.
   *
   * @param {string} operation Operación lógica del Service.
   * @param {?Object=} parentTrace Traza opcional del Controller.
   * @return {{trace:!Object,owned:boolean}} Contexto de trazabilidad.
   * @private
   */
  function _traceContext_(operation, parentTrace) {
    if (parentTrace && typeof parentTrace === "object") {
      perfMark_(parentTrace, "SERVICE_" + operation + "_STARTED", {
        module: PERF_MODULE,
        layer: "SERVICE"
      });
      return { trace: parentTrace, owned: false };
    }

    return {
      trace: perfStart_("UBICACIONES_MAXMIN_SERVICE_" + operation, {
        module: PERF_MODULE,
        layer: "SERVICE"
      }),
      owned: true
    };
  }

  /** Finaliza una traza propia o marca la conclusión en una traza heredada. */
  function _finishTrace_(context, status, metadata) {
    if (!context || !context.trace) return;
    if (context.owned) {
      perfEnd_(context.trace, status, metadata || {});
      return;
    }
    perfMark_(context.trace, "SERVICE_STAGE_COMPLETED", Object.assign({
      status: status || "ok"
    }, metadata || {}));
  }

  /** Registra un error sin finalizar trazas pertenecientes al Controller. */
  function _failTrace_(context, error, stage) {
    if (!context || !context.trace) return;
    if (context.owned) {
      perfFail_(context.trace, error, { stage: stage || "SERVICE" });
      return;
    }
    perfMark_(context.trace, String(stage || "SERVICE") + "_FAILED", {
      message: error && error.message ? error.message : String(error || "")
    });
  }

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
    [
      ["perfStart_", typeof perfStart_],
      ["perfMark_", typeof perfMark_],
      ["perfMeasure_", typeof perfMeasure_],
      ["perfEnd_", typeof perfEnd_],
      ["perfFail_", typeof perfFail_],
      ["perfMeasureJsonChars_", typeof perfMeasureJsonChars_]
    ].forEach(function(dependency) {
      if (dependency[1] !== "function") {
        missing.push(dependency[0]);
      }
    });
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
   * Solo STATUS=ACTIVO es elegible para este formulario.
   *
   * @param {!Object} product Producto normalizado.
   * @return {boolean} true únicamente cuando STATUS es ACTIVO.
   * @private
   */
  function _isActiveProduct_(product) {
    const status = toStrUpper_(product && product.status);
    return status === CFG.PRODUCT_STATUS_ACTIVE;
  }

  /**
   * Resuelve un producto único y activo desde CATALOGO.
   *
   * @param {*} codigo Código solicitado.
   * @return {!Object} Producto autoritativo.
   * @throws {Error} Si no existe, está inactivo o es ambiguo.
   * @private
   */
  function _resolveProduct_(codigo, trace) {
    const normalizedCode = toStrUpper_(codigo);
    if (!normalizedCode) {
      throw _domainError_(
        _errorCode_("CODIGO_REQUERIDO", "UBMAXMIN_CODIGO_REQUERIDO"),
        "CODIGO es obligatorio."
      );
    }

    const methodName = typeof CatalogoRepository.getPorCodigoDirecto === "function"
      ? "getPorCodigoDirecto"
      : "getPorCodigo";
    const getByCode = _requireMethod_(
      CatalogoRepository,
      "CatalogoRepository",
      methodName
    );
    const matches = getByCode.call(
      CatalogoRepository,
      normalizedCode,
      trace
    );
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
  function _resolveUser_(usuario, trace) {
    const normalizedName = toStrUpper_(usuario);
    if (!normalizedName) {
      throw _domainError_(
        _errorCode_("PAYLOAD_INVALIDO", "UBMAXMIN_PAYLOAD_INVALIDO"),
        "USUARIO es obligatorio."
      );
    }

    const methodName = typeof UsuariosRepository.getPorNombreDirecto === "function"
      ? "getPorNombreDirecto"
      : "getPorNombre";
    const getByName = _requireMethod_(
      UsuariosRepository,
      "UsuariosRepository",
      methodName
    );
    const matches = getByName.call(
      UsuariosRepository,
      normalizedName,
      trace
    );
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
  function _resolveExistingRow_(numFila, trace) {
    const rowNumber = _requireRowNumber_(numFila);
    const methodName =
      typeof UbicacionesMaxMinRepository.getPorNumeroFilaDirecto === "function"
        ? "getPorNumeroFilaDirecto"
        : "getPorNumeroFila";
    const getByRow = _requireMethod_(
      UbicacionesMaxMinRepository,
      "UbicacionesMaxMinRepository",
      methodName
    );
    const current = getByRow.call(
      UbicacionesMaxMinRepository,
      rowNumber,
      trace
    );
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
    if (porcentaje < CFG.MAX_PERCENTAGE && maximum < existencia) {
      throw _domainError_(
        _errorCode_("RANGO_INVALIDO", "UBMAXMIN_RANGO_INVALIDO"),
        "Con PORCENTAJE menor a 100, MAXIMO no puede ser menor que EXISTENCIA."
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
  function _buildUpdateCommand_(numFila, payload, trace) {
    const source = perfMeasure_(trace, "SERVICE_PAYLOAD_VALIDATED", function() {
      return _requirePayload_(payload);
    });
    const rowNumber = perfMeasure_(trace, "SERVICE_ROW_NUMBER_VALIDATED", function() {
      return _requireRowNumber_(numFila);
    });
    const current = perfMeasure_(trace, "SERVICE_ROW_RESOLVED", function() {
      return _resolveExistingRow_(rowNumber, trace);
    });
    const product = perfMeasure_(trace, "SERVICE_PRODUCT_RESOLVED", function() {
      return _resolveProduct_(source.codigo || current.codigo, trace);
    });
    const user = perfMeasure_(trace, "SERVICE_USER_RESOLVED", function() {
      return _resolveUser_(source.usuario, trace);
    });
    const existence = perfMeasure_(trace, "SERVICE_EXISTENCE_VALIDATED", function() {
      return _toNonNegativeInteger_(
        source.existencia,
        "EXISTENCIA",
        _errorCode_("EXISTENCIA_INVALIDA", "UBMAXMIN_EXISTENCIA_INVALIDA")
      );
    });
    const percentage = perfMeasure_(trace, "SERVICE_PERCENTAGE_VALIDATED", function() {
      return _resolvePercentage_(source.porcentaje);
    });
    const maximum = perfMeasure_(trace, "SERVICE_MAXIMUM_CALCULATED", function() {
      return _calculateMaximum_(existence, percentage, source.maximo);
    });
    perfMeasure_(trace, "SERVICE_ROW_PRODUCT_VALIDATED", function() {
      _assertRowProduct_(current, product);
    });

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

  /**
   * Determina si la captura inicial de una fila ya está completa.
   *
   * VALIDACION no interviene en esta etapa. Una fila deja de estar pendiente
   * únicamente cuando FECHA, HORA y USUARIO tienen contenido.
   *
   * @param {!Object} record Registro normalizado del Repository.
   * @return {boolean} true cuando la captura está completa.
   * @private
   */
  function _isInitialCaptureComplete_(record) {
    return CFG.COMPLETE_CAPTURE_FIELDS.every(function(fieldName) {
      return Boolean(toStr_(record && record[fieldName]));
    });
  }

  /**
   * Proyecta un usuario al contrato estable consumido por la vista.
   *
   * No aplica filtro por rol.
   *
   * @param {!Object} user Usuario normalizado.
   * @return {!Object} Usuario serializable.
   * @private
   */
  function _projectUser_(user) {
    return {
      idusuario: Number(user && user.idusuario || 0),
      nombre: toStrUpper_(user && user.nombre),
      rol: toStrUpper_(user && user.rol)
    };
  }

  /**
   * Proyecta una fila pendiente con los datos requeridos por la vista.
   *
   * CODIGO y DESCRIPCION alimentan el datalist. numFila permanece como identidad
   * técnica para actualizar la fila correcta sin exponerla en el texto visible.
   *
   * @param {!Object} record Registro normalizado.
   * @return {!Object} Registro serializable.
   * @private
   */
  function _projectPendingRecord_(record) {
    return {
      numFila: Number(record && record.numFila || 0),
      codigo: toStrUpper_(record && record.codigo),
      descripcion: toStrUpper_(record && record.descripcion),
      bodega: toStrUpper_(record && record.bodega),
      ubicacion: toStrUpper_(record && record.ubicacion),
      minimo: Number(record && record.minimo || 0),
      zonaBodega: toStrUpper_(record && record.zonaBodega),
      zonaAbastecimiento: toStrUpper_(record && record.zonaAbastecimiento),
      zonaNivel: toStrUpper_(record && record.zonaNivel)
    };
  }

  /**
   * Ordena registros pendientes por CODIGO y después por numFila.
   *
   * Este orden permite que la vista seleccione de manera determinista la fila
   * física menor cuando un código aparece más de una vez.
   *
   * @param {!Object} a Primer registro.
   * @param {!Object} b Segundo registro.
   * @return {number} Resultado de comparación.
   * @private
   */
  function _comparePendingRecords_(a, b) {
    const codeComparison = toStrUpper_(a && a.codigo).localeCompare(
      toStrUpper_(b && b.codigo),
      "es-MX",
      { numeric: true, sensitivity: "base" }
    );

    return codeComparison !== 0
      ? codeComparison
      : Number(a && a.numFila || 0) - Number(b && b.numFila || 0);
  }

  /**
   * Construye la lista única de códigos visibles en el datalist.
   *
   * Cada elemento contiene únicamente CODIGO y DESCRIPCION. Si existen varias
   * filas pendientes con el mismo código, se conserva la descripción de la fila
   * física menor, consistente con la selección determinista de la vista.
   *
   * @param {!Array<!Object>} pendingRecords Registros pendientes ordenados.
   * @return {!Array<!Object>} Códigos únicos para presentación.
   * @private
   */
  function _buildPendingCodes_(pendingRecords) {
    const seen = new Set();
    const result = [];

    pendingRecords.forEach(function(record) {
      const code = toStrUpper_(record && record.codigo);
      if (!code || seen.has(code)) return;

      seen.add(code);
      result.push({
        codigo: code,
        descripcion: toStrUpper_(record && record.descripcion)
      });
    });

    return result;
  }

  // ===========================================================================
  // API DE CONSULTA
  // ===========================================================================

  /**
   * Entrega la configuración técnica del formulario.
   *
   * Consulta directamente UsuariosRepository y UbicacionesMaxMinRepository.
   * Devuelve usuarios, registros pendientes y códigos visibles con CODIGO y
   * DESCRIPCION, sin depender del bootstrap general de APPALMACEN.
   *
   * @return {!Object} Bootstrap completo y serializable del formulario.
   */
  function getBootstrap(parentTrace) {
    const context = _traceContext_("GET_BOOTSTRAP", parentTrace);
    try {
      perfMeasure_(context.trace, "SERVICE_DEPENDENCIES_VALIDATED", _validateDependencies_);
      const getUsers = _requireMethod_(UsuariosRepository, "UsuariosRepository", "getAll");
      const rawUsers = perfMeasure_(context.trace, "SERVICE_USERS_READ", function() {
        return getUsers.call(UsuariosRepository);
      });
      const usuarios = perfMeasure_(context.trace, "SERVICE_USERS_PROJECTED", function() {
        return rawUsers.map(_projectUser_).filter(function(user) {
          return Boolean(user.nombre);
        }).sort(function(a, b) {
          return a.nombre.localeCompare(b.nombre, "es-MX", {
            numeric: true,
            sensitivity: "base"
          });
        });
      });
      const limits = UBICACIONES_MAXMIN_CONFIG.LIMITS;
      const result = {
        version: UBICACIONES_MAXMIN_CONFIG.VERSION,
        usuarios: usuarios,
        rules: {
          minimumSearchLength: Number(limits.BUSQUEDA_MIN_LENGTH || 2),
          maximumSearchLength: Number(limits.BUSQUEDA_MAX_LENGTH || 100),
          maximumResults: Number(limits.BUSQUEDA_MAX_RESULTADOS || 100),
          debounceMs: Number(limits.BUSQUEDA_DEBOUNCE_MS || 300),
          catalogoSoloStatusActivo: true,
          seleccionDeterministaPorFilaMenor: true
        },
        diagnostics: {
          totalUsuarios: usuarios.length,
          recordsIncluded: 0,
          searchMode: "ON_DEMAND"
        }
      };
      const responseChars = perfMeasureJsonChars_(result);
      perfMark_(context.trace, "SERVICE_RESPONSE_READY", {
        responseChars: responseChars,
        users: usuarios.length,
        recordsIncluded: 0
      });
      _finishTrace_(context, "ok", { responseChars: responseChars, users: usuarios.length });
      return result;
    } catch (error) {
      _failTrace_(context, error, "SERVICE_GET_BOOTSTRAP");
      throw error;
    }
  }

  /**
   * Busca registros pendientes y conserva solo productos activos.
   *
   * @param {*} criterio Código o descripción parcial.
   * @param {*} limite Máximo solicitado por el cliente.
   * @param {?Object=} parentTrace Traza opcional del Controller.
   * @return {!Object} Resultado compacto y limitado.
   */
  function buscarPendientes(criterio, limite, parentTrace) {
    const context = _traceContext_("SEARCH_PENDING", parentTrace);
    try {
      _validateDependencies_();
      const limits = UBICACIONES_MAXMIN_CONFIG.LIMITS;
      const query = toStrUpper_(criterio);
      const minimumLength = Number(limits.BUSQUEDA_MIN_LENGTH || 2);
      const maximumLength = Number(limits.BUSQUEDA_MAX_LENGTH || 100);
      const maximumResults = Number(limits.BUSQUEDA_MAX_RESULTADOS || 100);
      if (query.length < minimumLength || query.length > maximumLength) {
        throw _domainError_(
          _errorCode_("PAYLOAD_INVALIDO", "UBMAXMIN_PAYLOAD_INVALIDO"),
          `El criterio debe contener entre ${minimumLength} y ${maximumLength} caracteres.`
        );
      }
      const safeLimit = Math.min(
        maximumResults,
        Math.max(1, Math.floor(Number(limite || maximumResults)))
      );
      const search = _requireMethod_(
        UbicacionesMaxMinRepository,
        "UbicacionesMaxMinRepository",
        "buscarPendientes"
      );
      const candidates = perfMeasure_(context.trace, "SERVICE_PENDING_CANDIDATES_READ", function() {
        return search.call(UbicacionesMaxMinRepository, query, safeLimit * 3, context.trace);
      });
      const getCatalog = typeof CatalogoRepository.getAllRaw === "function"
        ? CatalogoRepository.getAllRaw
        : _requireMethod_(CatalogoRepository, "CatalogoRepository", "getAll");
      const catalog = perfMeasure_(context.trace, "SERVICE_CATALOG_READ", function() {
        return getCatalog.call(CatalogoRepository);
      });
      const activeCodes = new Set(catalog.filter(_isActiveProduct_).map(function(product) {
        return toStrUpper_(product && product.codigo);
      }).filter(Boolean));
      const registros = candidates
        .filter(function(record) { return activeCodes.has(toStrUpper_(record.codigo)); })
        .map(_projectPendingRecord_)
        .sort(_comparePendingRecords_)
        .slice(0, safeLimit);
      const result = {
        registros: registros,
        totalDevueltos: registros.length,
        limite: safeLimit,
        truncado: candidates.length > registros.length || registros.length === safeLimit
      };
      const responseChars = perfMeasureJsonChars_(result);
      _finishTrace_(context, "ok", {
        responseChars: responseChars,
        results: registros.length,
        limit: safeLimit
      });
      return result;
    } catch (error) {
      _failTrace_(context, error, "SERVICE_SEARCH_PENDING");
      throw error;
    }
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
  function guardar(payload, parentTrace) {
    const context = _traceContext_("SAVE", parentTrace);
    try {
      perfMeasure_(context.trace, "SERVICE_DEPENDENCIES_VALIDATED", function() {
        _validateDependencies_();
      });
      const source = perfMeasure_(
        context.trace,
        "SERVICE_PAYLOAD_REQUIRED",
        function() { return _requirePayload_(payload); }
      );
      const result = actualizar(source.numFila, source, context.trace);
      _finishTrace_(context, "ok", { saved: true });
      return result;
    } catch (error) {
      _failTrace_(context, error, "SERVICE_SAVE");
      throw error;
    }
  }

  /**
   * Actualiza una fila existente con datos de captura validados.
   *
   * La traza opcional se comparte con Controller y Repository para distinguir
   * validación de dominio, persistencia e invalidación de cachés.
   *
   * @param {*} numFila Número físico de fila.
   * @param {*} payload Datos del formulario.
   * @param {?Object=} parentTrace Traza opcional del Controller.
   * @return {!Object} Registro actualizado.
   */
  function actualizar(numFila, payload, parentTrace) {
    const context = _traceContext_("UPDATE", parentTrace);
    try {
      perfMeasure_(context.trace, "SERVICE_DEPENDENCIES_VALIDATED", function() {
        _validateDependencies_();
      });

      const command = perfMeasure_(
        context.trace,
        "SERVICE_UPDATE_COMMAND_BUILT",
        function() {
          return _buildUpdateCommand_(numFila, payload, context.trace);
        }
      );

      const update = perfMeasure_(
        context.trace,
        "SERVICE_UPDATE_METHOD_RESOLVED",
        function() {
          return _requireMethod_(
            UbicacionesMaxMinRepository,
            "UbicacionesMaxMinRepository",
            "actualizar"
          );
        }
      );

      const updatedRecord = perfMeasure_(
        context.trace,
        "SERVICE_REPOSITORY_UPDATE",
        function() {
          return update.call(
            UbicacionesMaxMinRepository,
            command.rowNumber,
            command.record,
            context.trace
          );
        }
      );

      perfMeasure_(context.trace, "SERVICE_CACHES_INVALIDATED", function() {
        if (typeof clearUbicacionesMaxMinCaches_ === "function") {
          return clearUbicacionesMaxMinCaches_({ skipRepository: true });
        }
        if (
          typeof APPALMACENCache !== "undefined" &&
          APPALMACENCache &&
          typeof APPALMACENCache.clearUbicacionesMaxMin === "function"
        ) {
          return APPALMACENCache.clearUbicacionesMaxMin();
        }
        return false;
      });

      const responseChars = perfMeasureJsonChars_(updatedRecord);
      perfMark_(context.trace, "SERVICE_UPDATE_RESPONSE_READY", {
        responseChars,
        updated: Boolean(updatedRecord)
      });
      _finishTrace_(context, "ok", {
        responseChars,
        updated: Boolean(updatedRecord)
      });
      return updatedRecord;
    } catch (error) {
      _failTrace_(context, error, "SERVICE_UPDATE");
      throw error;
    }
  }

  // ===========================================================================
  // API PÚBLICA
  // ===========================================================================

  return Object.freeze({
    getBootstrap,
    buscarPendientes,
    buscarProductoPorCodigo,
    obtenerPorCodigo,
    obtenerPorIdentidad,
    guardar,
    actualizar
  });
})();
