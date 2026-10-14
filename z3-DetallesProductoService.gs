/**
 * z3-DetallesProductoService
 *
 * @fileoverview Servicio de dominio para capturar, validar y consultar las
 * especificaciones técnicas almacenadas en DETALLESPRODUCTO.
 *
 * El servicio resuelve el producto base desde CATALOGO, valida dimensiones,
 * normaliza tipos de hilo y roscado, calcula medidas derivadas y coordina la
 * persistencia mediante DetallesProductoRepository bajo ScriptLock.
 *
 * Responsabilidades:
 * - Leer y normalizar el catálogo maestro de productos.
 * - Resolver productos por ID o código sin confiar en datos descriptivos del
 *   cliente.
 * - Validar tipos de hilo, roscado, dimensiones y peso teórico.
 * - Calcular LARGOTOTAL, ANCHOTOTAL y LARGOROSCADO.
 * - Construir el bootstrap requerido por la interfaz de captura.
 * - Consultar productos y su detalle técnico existente.
 * - Crear o actualizar detalles mediante una operación protegida por bloqueo.
 *
 * Dependencias globales:
 * - getRowsByKey_(sourceKey).
 * - COL.CATALOGO.IDPRODUCTO, CODIGO, DESCRIPCION y STATUS.
 * - toStr_(value) y toStrUpper_(value).
 * - DetallesProductoRepository.
 * - withScriptLock_(operationName, callback, timeoutMs).
 *
 * Reglas de negocio:
 * - El producto debe existir en CATALOGO.
 * - TIPOHILO solo admite METRICO o STANDARD.
 * - ROSCADO solo admite COMPLETO o PARCIAL.
 * - HILO, LARGOCUERPO, ANCHOCUERPO, ANCHOCABEZA y PESOTEORICO deben ser
 *   valores finitos mayores que cero.
 * - LARGOCABEZA puede ser cero, pero nunca negativo.
 * - ROSCADO COMPLETO utiliza LARGOCUERPO como LARGOROSCADO.
 * - ROSCADO PARCIAL exige LARGOROSCADO mayor que cero y menor que LARGOCUERPO.
 * - Los valores calculados se redondean a cuatro decimales.
 * - ID, CODIGO y DESCRIPCION siempre se toman del catálogo autoritativo.
 *
 * Concurrencia:
 * - guardarDetalle() utiliza withScriptLock_().
 * - La lectura y normalización se repiten dentro del bloqueo para evitar
 *   persistir datos construidos con un catálogo desactualizado.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const DetallesProductoService = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    CATALOG_SOURCE_KEY: "CATALOGO",
    LOCK_TIMEOUT_MS: 30000,
    DECIMAL_PLACES: 4,
    LOCALE: "es-MX",
    LOG_PREFIX: "[DetallesProductoService]"
  });

  /** @private @const {!Array<string>} */
  const TIPOS_HILO_VALIDOS = Object.freeze([
    "METRICO",
    "STANDARD"
  ]);

  /** @private @const {!Array<string>} */
  const ROSCADOS_VALIDOS = Object.freeze([
    "COMPLETO",
    "PARCIAL"
  ]);

  /** @private @const {!Array<string>} */
  const REQUIRED_CATALOG_COLUMNS = Object.freeze([
    "IDPRODUCTO",
    "CODIGO",
    "DESCRIPCION",
    "STATUS"
  ]);

  // ==========================================================================
  // VALIDACIÓN DE DEPENDENCIAS Y CONTRATOS
  // ==========================================================================

  /**
   * Verifica que las utilidades y repositorios obligatorios estén disponibles.
   *
   * @return {void}
   * @throws {Error} Si falta alguna dependencia global.
   * @private
   */
  function _assertDependencies_() {
    const functions = [
      ["getRowsByKey_", typeof getRowsByKey_],
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["withScriptLock_", typeof withScriptLock_]
    ];

    const missingFunctions = functions
      .filter(function (dependency) {
        return dependency[1] !== "function";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingFunctions.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan utilidades globales: ` +
          `${missingFunctions.join(", ")}.`
      );
    }

    if (
      typeof DetallesProductoRepository === "undefined" ||
      !DetallesProductoRepository
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} DetallesProductoRepository no está disponible.`
      );
    }
  }

  /**
   * Obtiene y valida el contrato físico de columnas de CATALOGO.
   *
   * @return {!Object} Mapa validado de índices de columna.
   * @throws {Error} Si COL.CATALOGO no existe o contiene índices inválidos.
   * @private
   */
  function _getCatalogColumns_() {
    if (
      typeof COL === "undefined" ||
      !COL ||
      !COL.CATALOGO ||
      typeof COL.CATALOGO !== "object"
    ) {
      throw new Error(`${CFG.LOG_PREFIX} No existe COL.CATALOGO.`);
    }

    const columns = COL.CATALOGO;
    const missingColumns = REQUIRED_CATALOG_COLUMNS.filter(
      function (columnName) {
        return !Object.prototype.hasOwnProperty.call(columns, columnName);
      }
    );

    if (missingColumns.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan columnas de CATALOGO: ` +
          `${missingColumns.join(", ")}.`
      );
    }

    const usedIndexes = Object.create(null);
    REQUIRED_CATALOG_COLUMNS.forEach(function (columnName) {
      const index = columns[columnName];

      if (!Number.isInteger(index) || index < 0) {
        throw new Error(
          `${CFG.LOG_PREFIX} COL.CATALOGO.${columnName} contiene el índice ` +
            `inválido "${index}".`
        );
      }

      if (Object.prototype.hasOwnProperty.call(usedIndexes, index)) {
        throw new Error(
          `${CFG.LOG_PREFIX} Las columnas ${usedIndexes[index]} y ` +
            `${columnName} comparten el índice ${index}.`
        );
      }

      usedIndexes[index] = columnName;
    });

    return columns;
  }

  /**
   * Valida que el valor recibido sea un objeto payload válido.
   *
   * @param {*} payload Valor recibido desde la interfaz.
   * @param {string} operationName Nombre de la operación para diagnóstico.
   * @return {!Object} Payload validado.
   * @throws {TypeError} Si el valor no es un objeto plano.
   * @private
   */
  function _payloadOrThrow_(payload, operationName) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError(`${operationName} requiere un objeto payload válido.`);
    }

    return payload;
  }

  // ==========================================================================
  // NORMALIZACIÓN Y UTILIDADES
  // ==========================================================================

  /**
   * Redondea un valor numérico al número de decimales indicado.
   *
   * @param {*} value Valor que se desea redondear.
   * @param {number=} decimals Número de decimales; por defecto, cuatro.
   * @return {number} Valor finito redondeado.
   * @throws {TypeError} Si el valor o la precisión no son válidos.
   * @private
   */
  function _round_(value, decimals = CFG.DECIMAL_PLACES) {
    const numericValue = Number(value);
    const decimalPlaces = Number(decimals);

    if (!Number.isFinite(numericValue)) {
      throw new TypeError("El valor que se desea redondear no es numérico.");
    }

    if (
      !Number.isInteger(decimalPlaces) ||
      decimalPlaces < 0 ||
      decimalPlaces > 12
    ) {
      throw new TypeError("La precisión de redondeo no es válida.");
    }

    return Number(numericValue.toFixed(decimalPlaces));
  }

  /**
   * Obtiene el primer valor no vacío de una lista de propiedades.
   *
   * Permite que la interfaz utilice nombres en mayúsculas o camelCase sin
   * duplicar la lógica de validación del servicio.
   *
   * @param {!Object} object Objeto de origen.
   * @param {!Array<string>} keys Propiedades que se revisarán en orden.
   * @param {*=} fallback Valor utilizado cuando ninguna propiedad contiene datos.
   * @return {*} Primer valor disponible o el fallback.
   * @private
   */
  function _get_(object, keys, fallback = "") {
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      return fallback;
    }

    if (!Array.isArray(keys)) {
      throw new TypeError("La colección de propiedades debe ser un arreglo.");
    }

    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const value = object[key];

      if (
        value !== null &&
        typeof value !== "undefined" &&
        String(value).trim() !== ""
      ) {
        return value;
      }
    }

    return fallback;
  }

  /**
   * Valida y normaliza un valor numérico obligatorio.
   *
   * @param {*} value Valor que se desea validar.
   * @param {string} fieldName Nombre del campo para mensajes de error.
   * @param {boolean} greaterThanZero true si debe ser estrictamente positivo.
   * @return {number} Número finito validado.
   * @throws {Error} Si el valor no es finito o incumple su límite inferior.
   * @private
   */
  function _numberRequired_(value, fieldName, greaterThanZero) {
    if (value === null || typeof value === "undefined" || value === "") {
      throw new Error(`${fieldName} es obligatorio.`);
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      throw new Error(`${fieldName} debe ser numérico y finito.`);
    }

    if (greaterThanZero && numericValue <= 0) {
      throw new Error(`${fieldName} debe ser mayor que cero.`);
    }

    if (!greaterThanZero && numericValue < 0) {
      throw new Error(`${fieldName} no puede ser negativo.`);
    }

    return numericValue;
  }

  /**
   * Compara dos textos usando orden alfanumérico natural para México.
   *
   * @param {*} left Primer valor.
   * @param {*} right Segundo valor.
   * @return {number} Resultado compatible con Array.prototype.sort().
   * @private
   */
  function _compareText_(left, right) {
    return toStrUpper_(left).localeCompare(
      toStrUpper_(right),
      CFG.LOCALE,
      {
        numeric: true,
        sensitivity: "base"
      }
    );
  }

  // ==========================================================================
  // CATÁLOGO DE PRODUCTOS
  // ==========================================================================

  /**
   * Lee y normaliza los productos utilizables del catálogo maestro.
   *
   * Solo conserva filas con ID y CODIGO. Los identificadores permanecen como
   * texto para evitar pérdidas de formato o de ceros iniciales.
   *
   * @return {!Array<!Object>} Productos normalizados en el orden del catálogo.
   * @throws {Error} Si la fuente o el contrato de columnas son inválidos.
   * @private
   */
  function _leerCatalogo_() {
    _assertDependencies_();
    const columns = _getCatalogColumns_();
    const rows = getRowsByKey_(CFG.CATALOG_SOURCE_KEY);

    if (!Array.isArray(rows)) {
      throw new Error(
        `${CFG.LOG_PREFIX} La fuente ${CFG.CATALOG_SOURCE_KEY} no devolvió ` +
          "un arreglo."
      );
    }

    return rows
      .map(function (row, index) {
        if (!Array.isArray(row)) {
          throw new TypeError(
            `${CFG.LOG_PREFIX} La fila ${index + 1} de CATALOGO es inválida.`
          );
        }

        return Object.freeze({
          ID: toStr_(row[columns.IDPRODUCTO]),
          CODIGO: toStrUpper_(row[columns.CODIGO]),
          DESCRIPCION: toStrUpper_(row[columns.DESCRIPCION]),
          STATUS: toStrUpper_(row[columns.STATUS])
        });
      })
      .filter(function (item) {
        return Boolean(item.ID && item.CODIGO);
      });
  }

  /**
   * Busca un producto mediante coincidencia exacta de código normalizado.
   *
   * @param {*} codigo Código del producto.
   * @param {!Array<!Object>=} catalogo Catálogo previamente leído.
   * @return {?Object} Producto coincidente o null.
   * @private
   */
  function _catalogoPorCodigo_(codigo, catalogo) {
    const normalizedCode = toStrUpper_(codigo);
    if (!normalizedCode) {
      return null;
    }

    const source = Array.isArray(catalogo) ? catalogo : _leerCatalogo_();
    return (
      source.find(function (item) {
        return item.CODIGO === normalizedCode;
      }) || null
    );
  }

  /**
   * Busca un producto mediante coincidencia exacta de identificador textual.
   *
   * @param {*} id Identificador del producto.
   * @param {!Array<!Object>=} catalogo Catálogo previamente leído.
   * @return {?Object} Producto coincidente o null.
   * @private
   */
  function _catalogoPorId_(id, catalogo) {
    const normalizedId = toStr_(id);
    if (!normalizedId) {
      return null;
    }

    const source = Array.isArray(catalogo) ? catalogo : _leerCatalogo_();
    return (
      source.find(function (item) {
        return toStr_(item.ID) === normalizedId;
      }) || null
    );
  }

  /**
   * Resuelve el producto autoritativo indicado en el payload.
   *
   * El ID tiene prioridad. Si no produce coincidencia, se intenta resolver por
   * código. Los datos descriptivos enviados por el cliente se ignoran.
   *
   * @param {!Object} payload Payload validado.
   * @param {!Array<!Object>=} catalogo Catálogo previamente leído.
   * @return {!Object} Producto localizado en CATALOGO.
   * @throws {Error} Si no existe el producto.
   * @private
   */
  function _resolverProductoBase_(payload, catalogo) {
    const id = toStr_(_get_(payload, ["ID", "id"]));
    const codigo = toStrUpper_(_get_(payload, ["CODIGO", "codigo"]));
    const source = Array.isArray(catalogo) ? catalogo : _leerCatalogo_();

    let producto = id ? _catalogoPorId_(id, source) : null;
    if (!producto && codigo) {
      producto = _catalogoPorCodigo_(codigo, source);
    }

    if (!producto) {
      throw new Error("El producto no existe en CATALOGO.");
    }

    return producto;
  }

  // ==========================================================================
  // VALIDACIÓN Y CONSTRUCCIÓN DEL DETALLE
  // ==========================================================================

  /**
   * Valida el payload y construye el contrato persistible del detalle técnico.
   *
   * @param {!Object} payload Datos recibidos desde la interfaz.
   * @param {!Array<!Object>=} catalogo Catálogo previamente leído.
   * @return {!Object} Detalle normalizado y listo para persistencia.
   * @throws {Error} Si alguna regla de negocio no se cumple.
   * @private
   */
  function _normalizarDetalle_(payload, catalogo) {
    const input = _payloadOrThrow_(payload, "_normalizarDetalle_()");
    const producto = _resolverProductoBase_(input, catalogo);
    const tipoHilo = toStrUpper_(
      _get_(input, ["TIPOHILO", "tipoHilo"])
    );
    const roscado = toStrUpper_(
      _get_(input, ["ROSCADO", "roscado"])
    );

    if (!TIPOS_HILO_VALIDOS.includes(tipoHilo)) {
      throw new Error("TIPOHILO debe ser METRICO o STANDARD.");
    }

    if (!ROSCADOS_VALIDOS.includes(roscado)) {
      throw new Error("ROSCADO debe ser COMPLETO o PARCIAL.");
    }

    const hilo = _numberRequired_(
      _get_(input, ["HILO", "hilo"]),
      "HILO",
      true
    );
    const largoCuerpo = _numberRequired_(
      _get_(input, ["LARGOCUERPO", "largoCuerpo"]),
      "LARGOCUERPO",
      true
    );
    const largoCabeza = _numberRequired_(
      _get_(input, ["LARGOCABEZA", "largoCabeza"], 0),
      "LARGOCABEZA",
      false
    );
    const anchoCuerpo = _numberRequired_(
      _get_(input, ["ANCHOCUERPO", "anchoCuerpo"]),
      "ANCHOCUERPO",
      true
    );
    const anchoCabeza = _numberRequired_(
      _get_(input, ["ANCHOCABEZA", "anchoCabeza"]),
      "ANCHOCABEZA",
      true
    );
    const pesoTeorico = _numberRequired_(
      _get_(input, ["PESOTEORICO", "pesoTeorico"]),
      "PESOTEORICO",
      true
    );

    let largoRoscado = Number(
      _get_(input, ["LARGOROSCADO", "largoRoscado"], 0)
    );

    if (roscado === "COMPLETO") {
      largoRoscado = largoCuerpo;
    }

    if (roscado === "PARCIAL") {
      largoRoscado = _numberRequired_(
        largoRoscado,
        "LARGOROSCADO",
        true
      );

      if (largoRoscado >= largoCuerpo) {
        throw new Error(
          "Cuando ROSCADO es PARCIAL, LARGOROSCADO debe ser menor que " +
            "LARGOCUERPO."
        );
      }
    }

    const largoTotal = _round_(largoCuerpo + largoCabeza);
    const anchoTotal = _round_(Math.max(anchoCuerpo, anchoCabeza));

    return {
      ID: producto.ID,
      CODIGO: producto.CODIGO,
      DESCRIPCION: producto.DESCRIPCION,
      TIPOHILO: tipoHilo,
      HILO: _round_(hilo),
      LARGOCUERPO: _round_(largoCuerpo),
      LARGOCABEZA: _round_(largoCabeza),
      ANCHOCUERPO: _round_(anchoCuerpo),
      ANCHOCABEZA: _round_(anchoCabeza),
      LARGOTOTAL: largoTotal,
      ANCHOTOTAL: anchoTotal,
      PESOTEORICO: _round_(pesoTeorico),
      ROSCADO: roscado,
      LARGOROSCADO: _round_(largoRoscado)
    };
  }

  // ==========================================================================
  // API PÚBLICA
  // ==========================================================================

  /**
   * Construye la carga inicial del módulo de detalles de producto.
   *
   * Lee una sola vez el catálogo y una sola vez el repositorio de detalles.
   * También genera índices auxiliares por ID y código para la interfaz.
   *
   * @return {!Object} Catálogo, detalles, listas e índices de consulta.
   */
  function getBootstrap() {
    _assertDependencies_();

    const catalogo = _leerCatalogo_();
    const detalles = DetallesProductoRepository.getAll();

    if (!Array.isArray(detalles)) {
      throw new Error(
        `${CFG.LOG_PREFIX} DetallesProductoRepository.getAll() no devolvió ` +
          "un arreglo."
      );
    }

    const mapaCatalogo = catalogo.reduce(function (accumulator, item) {
      accumulator[item.CODIGO] = item;
      return accumulator;
    }, Object.create(null));

    const mapaDetallesPorId = detalles.reduce(function (accumulator, item) {
      const id = toStr_(item && item.ID);
      if (id) {
        accumulator[id] = item;
      }
      return accumulator;
    }, Object.create(null));

    const mapaDetallesPorCodigo = detalles.reduce(
      function (accumulator, item) {
        const codigo = toStrUpper_(item && item.CODIGO);
        if (codigo) {
          accumulator[codigo] = item;
        }
        return accumulator;
      },
      Object.create(null)
    );

    return {
      catalogo,
      detalles,
      codigos: catalogo
        .map(function (item) {
          return item.CODIGO;
        })
        .filter(Boolean)
        .sort(_compareText_),
      ids: catalogo
        .map(function (item) {
          return item.ID;
        })
        .filter(Boolean)
        .sort(_compareText_),
      mapaCatalogo,
      mapaDetallesPorId,
      mapaDetallesPorCodigo,
      tiposHilo: [...TIPOS_HILO_VALIDOS],
      roscados: [...ROSCADOS_VALIDOS]
    };
  }

  /**
   * Busca un producto por código y obtiene su detalle técnico.
   *
   * @param {*} codigo Código solicitado.
   * @return {!Object} Resultado de búsqueda y detalle existente.
   */
  function buscarProductoPorCodigo(codigo) {
    _assertDependencies_();

    const producto = _catalogoPorCodigo_(codigo);
    if (!producto) {
      return {
        encontrado: false,
        mensaje: "Producto no encontrado en CATALOGO."
      };
    }

    const detalle = DetallesProductoRepository.getUnoPorId(producto.ID);
    return {
      encontrado: true,
      producto,
      detalle: detalle || null
    };
  }

  /**
   * Busca un producto por ID y obtiene su detalle técnico.
   *
   * @param {*} id Identificador solicitado.
   * @return {!Object} Resultado de búsqueda y detalle existente.
   */
  function buscarProductoPorId(id) {
    _assertDependencies_();

    const producto = _catalogoPorId_(id);
    if (!producto) {
      return {
        encontrado: false,
        mensaje: "Producto no encontrado en CATALOGO."
      };
    }

    const detalle = DetallesProductoRepository.getUnoPorId(producto.ID);
    return {
      encontrado: true,
      producto,
      detalle: detalle || null
    };
  }

  /**
   * Crea o actualiza el detalle técnico de un producto.
   *
   * La resolución del catálogo, validación y persistencia se ejecutan dentro del
   * mismo bloqueo para reducir condiciones de carrera.
   *
   * @param {!Object} payload Datos técnicos enviados por la interfaz.
   * @return {!Object} Acción realizada, fila y detalle persistido.
   * @throws {Error} Si el producto, payload o detalle no son válidos.
   */
  function guardarDetalle(payload) {
    _assertDependencies_();
    const input = _payloadOrThrow_(payload, "guardarDetalle()");

    return withScriptLock_(
      "DetallesProductoService.guardarDetalle",
      function () {
        const catalogo = _leerCatalogo_();
        const detalle = _normalizarDetalle_(input, catalogo);
        const result = DetallesProductoRepository.upsert(detalle);

        if (!result || typeof result !== "object") {
          throw new Error(
            `${CFG.LOG_PREFIX} El repositorio no devolvió un resultado válido.`
          );
        }

        return {
          ok: true,
          accion: toStrUpper_(result.accion),
          rowNumber: Number(result.rowNumber || 0),
          detalle: result.item || detalle
        };
      },
      CFG.LOCK_TIMEOUT_MS
    );
  }

  /**
   * Devuelve todos los detalles técnicos disponibles.
   *
   * @return {!Array<!Object>} Detalles proporcionados por el repositorio.
   * @throws {Error} Si el repositorio no devuelve un arreglo.
   */
  function obtenerDetalles() {
    _assertDependencies_();

    const detalles = DetallesProductoRepository.getAll();
    if (!Array.isArray(detalles)) {
      throw new Error(
        `${CFG.LOG_PREFIX} DetallesProductoRepository.getAll() no devolvió ` +
          "un arreglo."
      );
    }

    return detalles;
  }

  return Object.freeze({
    getBootstrap,
    buscarProductoPorCodigo,
    buscarProductoPorId,
    guardarDetalle,
    obtenerDetalles
  });
})();
