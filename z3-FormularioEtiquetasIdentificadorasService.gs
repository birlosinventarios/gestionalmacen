/**
 * z3-FormularioEtiquetasIdentificadorasService
 *
 * @fileoverview Servicio de dominio para validar y generar etiquetas
 * identificadoras de productos en modos de impresión LOCAL y ONLINE.
 *
 * El servicio consulta el catálogo autoritativo de productos, obtiene medidas de
 * etiquetas compatibles, normaliza cada elemento solicitado, genera folios de
 * impresión y renderiza el documento mediante EtiquetaIdentificadoraImpresa.
 *
 * Responsabilidades:
 * - Construir el bootstrap requerido por la interfaz.
 * - Consultar códigos y productos desde CatalogoRepository.
 * - Consultar tipos y medidas desde EtiquetasRepository.
 * - Mantener el contrato fijo de 150 x 100 mm para IDENTIFICADORA.
 * - Validar código, tipo, descripción, ID y dimensiones de cada etiqueta.
 * - Generar un folio único y trazable por cada elemento del lote.
 * - Renderizar HTML para impresión LOCAL y ONLINE.
 * - Retirar bloques script del HTML destinado al puente online.
 * - Construir metadatos consistentes del trabajo de impresión.
 *
 * Dependencias globales:
 * - CatalogoRepository y EtiquetasRepository.
 * - getSpreadsheetByFileKey_(fileKey).
 * - SHEETS.ETIQUETAS.file.
 * - HtmlService y Utilities de Google Apps Script.
 * - toStr_(value), toStrUpper_(value) y toNum_(value).
 * - Plantilla EtiquetaIdentificadoraImpresa.
 *
 * Reglas de integridad:
 * - El lote no puede estar vacío ni superar el máximo configurado.
 * - Cada elemento debe ser un objeto plano.
 * - El código debe existir en el catálogo vigente.
 * - IDENTIFICADORA utiliza siempre 150 x 100 mm.
 * - Otros tipos deben existir en el catálogo de medidas.
 * - Alto y ancho deben ser valores finitos mayores que cero.
 * - ID y descripción se obtienen del catálogo autoritativo.
 * - Los folios no se repiten dentro del mismo lote.
 * - El HTML ONLINE no debe contener bloques script.
 * - El servicio no realiza escrituras en hojas ni modifica inventarios.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const FormularioEtiquetasIdentificadorasService = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    TEMPLATE_FILE: "EtiquetaIdentificadoraImpresa",
    IDENTIFIER_TYPE: "IDENTIFICADORA",
    IDENTIFIER_WIDTH_MM: 150,
    IDENTIFIER_HEIGHT_MM: 100,
    SAFE_AREA_WIDTH_MM: 145,
    SAFE_AREA_HEIGHT_MM: 95,
    LOCAL_MODE: "LOCAL",
    ONLINE_MODE: "ONLINE",
    MAX_BATCH_ITEMS: 500,
    DEFAULT_TIME_ZONE: "America/Mexico_City",
    DATE_FORMAT: "dd/MM/yyyy",
    TIME_FORMAT: "HH:mm:ss",
    LOCALE: "es-MX",
    PRINT_JOB_TYPE: "ETIQUETAS_IDENTIFICADORAS",
    MODULE_NAME: "FormularioEtiquetasIdentificadoras",
    LABEL_FORMAT: "IDENTIFICADORA",
    OUTPUT_FORMAT: "HTML",
    PAPER_SIZE: "150x100mm",
    FOLIO_SUFFIX: "ETIQ",
    LOG_PREFIX: "[FormularioEtiquetasIdentificadorasService]"
  });

  // ==========================================================================
  // VALIDACIÓN DE DEPENDENCIAS Y CONTRATOS
  // ==========================================================================

  /**
   * Verifica que las utilidades, repositorios y servicios estén disponibles.
   *
   * @return {void}
   * @throws {Error} Si falta una dependencia obligatoria.
   * @private
   */
  function _assertDependencies_() {
    const functions = [
      ["getSpreadsheetByFileKey_", typeof getSpreadsheetByFileKey_],
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_]
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

    const repositories = [
      ["CatalogoRepository", typeof CatalogoRepository],
      ["EtiquetasRepository", typeof EtiquetasRepository]
    ];

    const missingRepositories = repositories
      .filter(function (dependency) {
        return dependency[1] === "undefined";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingRepositories.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan repositorios obligatorios: ` +
          `${missingRepositories.join(", ")}.`
      );
    }

    if (
      typeof HtmlService === "undefined" ||
      typeof Utilities === "undefined"
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} HtmlService y Utilities son obligatorios.`
      );
    }
  }

  /**
   * Obtiene y valida la clave del archivo configurado para etiquetas.
   *
   * @return {string} Clave lógica del archivo.
   * @throws {Error} Si SHEETS.ETIQUETAS.file no está configurado.
   * @private
   */
  function _getEtiquetasFileKey_() {
    if (
      typeof SHEETS === "undefined" ||
      !SHEETS ||
      !SHEETS.ETIQUETAS ||
      !toStr_(SHEETS.ETIQUETAS.file)
    ) {
      throw new Error(`${CFG.LOG_PREFIX} No existe SHEETS.ETIQUETAS.file.`);
    }

    return toStr_(SHEETS.ETIQUETAS.file);
  }

  /**
   * Valida la estructura general del lote solicitado.
   *
   * @param {*} batch Valor recibido desde la interfaz.
   * @return {!Array<!Object>} El mismo lote validado.
   * @throws {Error} Si está vacío, excede el límite o contiene tipos inválidos.
   * @private
   */
  function _validateBatch_(batch) {
    if (!Array.isArray(batch) || batch.length === 0) {
      throw new Error("El lote de etiquetas está vacío.");
    }

    if (batch.length > CFG.MAX_BATCH_ITEMS) {
      throw new Error(
        `El lote supera el máximo de ${CFG.MAX_BATCH_ITEMS} etiquetas.`
      );
    }

    if (
      !batch.every(function (item) {
        return item && typeof item === "object" && !Array.isArray(item);
      })
    ) {
      throw new Error("El lote contiene elementos inválidos.");
    }

    return batch;
  }

  // ==========================================================================
  // CONTEXTO TEMPORAL Y CATÁLOGOS
  // ==========================================================================

  /**
   * Obtiene la fecha y hora con la zona horaria del archivo de etiquetas.
   *
   * @param {!GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet Archivo origen.
   * @return {!Object} Fecha, hora, instante y zona horaria utilizada.
   * @throws {TypeError} Si el Spreadsheet no es válido.
   * @private
   */
  function _obtenerContextoTemporal_(spreadsheet) {
    if (
      !spreadsheet ||
      typeof spreadsheet.getSpreadsheetTimeZone !== "function"
    ) {
      throw new TypeError(`${CFG.LOG_PREFIX} Se requiere un Spreadsheet válido.`);
    }

    const timeZone =
      toStr_(spreadsheet.getSpreadsheetTimeZone()) || CFG.DEFAULT_TIME_ZONE;
    const now = new Date();

    return {
      fecha: Utilities.formatDate(now, timeZone, CFG.DATE_FORMAT),
      hora: Utilities.formatDate(now, timeZone, CFG.TIME_FORMAT),
      ahora: new Date(now.getTime()),
      zonaHoraria: timeZone
    };
  }

  /**
   * Lee y valida todos los registros del catálogo de productos.
   *
   * @return {!Array<!Object>} Catálogo completo.
   * @throws {Error} Si el repositorio no devuelve un arreglo.
   * @private
   */
  function _getCatalogRows_() {
    const rows = CatalogoRepository.getAll();
    if (!Array.isArray(rows)) {
      throw new Error(
        `${CFG.LOG_PREFIX} CatalogoRepository.getAll() no devolvió un arreglo.`
      );
    }
    return rows;
  }

  /**
   * Lee y valida todos los registros del catálogo de etiquetas.
   *
   * @return {!Array<!Object>} Tipos y medidas disponibles.
   * @throws {Error} Si el repositorio no devuelve un arreglo.
   * @private
   */
  function _getEtiquetaRows_() {
    const rows = EtiquetasRepository.getAll();
    if (!Array.isArray(rows)) {
      throw new Error(
        `${CFG.LOG_PREFIX} EtiquetasRepository.getAll() no devolvió un arreglo.`
      );
    }
    return rows;
  }

  /**
   * Compara textos mediante orden alfanumérico natural para México.
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

  /**
   * Construye la lista única y ordenada de códigos disponibles.
   *
   * @param {!Array<!Object>=} catalogRows Catálogo leído previamente.
   * @return {!Array<string>} Códigos normalizados y únicos.
   * @private
   */
  function _buildCodigos_(catalogRows) {
    const rows = Array.isArray(catalogRows)
      ? catalogRows
      : _getCatalogRows_();
    const values = rows
      .map(function (item) {
        return toStrUpper_(item && item.codigo);
      })
      .filter(Boolean);

    return Array.from(new Set(values)).sort(_compareText_);
  }

  /**
   * Construye un índice seguro del catálogo por código normalizado.
   *
   * @param {!Array<!Object>=} catalogRows Catálogo leído previamente.
   * @return {!Object<string,!Object>} Índice de productos por código.
   * @private
   */
  function _buildMapaCatalogo_(catalogRows) {
    const rows = Array.isArray(catalogRows)
      ? catalogRows
      : _getCatalogRows_();

    return rows.reduce(function (index, item) {
      const code = toStrUpper_(item && item.codigo);
      if (!code) {
        return index;
      }

      index[code] = Object.freeze({
        idproducto: toStr_(item.idproducto),
        codigo: code,
        descripcion: toStrUpper_(item.descripcion),
        status: toStrUpper_(item.status)
      });
      return index;
    }, Object.create(null));
  }

  /**
   * Construye el índice de medidas por nombre de etiqueta.
   *
   * IDENTIFICADORA se incorpora con su contrato fijo aunque no exista en el
   * repositorio, para que la vista siempre reciba la medida vigente.
   *
   * @param {!Array<!Object>=} etiquetaRows Catálogo leído previamente.
   * @return {!Object<string,!Object>} Medidas disponibles por nombre.
   * @private
   */
  function _buildMapaMedidas_(etiquetaRows) {
    const rows = Array.isArray(etiquetaRows)
      ? etiquetaRows
      : _getEtiquetaRows_();
    const index = rows.reduce(function (accumulator, item) {
      const name = toStrUpper_(item && item.nombre);
      if (!name) {
        return accumulator;
      }

      const width = Number(item.ancho);
      const height = Number(item.alto);
      if (Number.isFinite(width) && width > 0 &&
          Number.isFinite(height) && height > 0) {
        accumulator[name] = Object.freeze({
          ancho: width,
          alto: height
        });
      }
      return accumulator;
    }, Object.create(null));

    index[CFG.IDENTIFIER_TYPE] = Object.freeze({
      ancho: CFG.IDENTIFIER_WIDTH_MM,
      alto: CFG.IDENTIFIER_HEIGHT_MM
    });

    return index;
  }

  /**
   * Construye los nombres únicos y ordenados de etiquetas disponibles.
   *
   * @param {!Array<!Object>=} etiquetaRows Catálogo leído previamente.
   * @return {!Array<string>} Nombres normalizados, incluida IDENTIFICADORA.
   * @private
   */
  function _buildNombresEtiquetas_(etiquetaRows) {
    const rows = Array.isArray(etiquetaRows)
      ? etiquetaRows
      : _getEtiquetaRows_();
    const values = rows
      .map(function (item) {
        return toStrUpper_(item && item.nombre);
      })
      .filter(Boolean);

    values.push(CFG.IDENTIFIER_TYPE);
    return Array.from(new Set(values)).sort(_compareText_);
  }

  // ==========================================================================
  // VALIDACIÓN Y NORMALIZACIÓN DEL LOTE
  // ==========================================================================

  /**
   * Valida que un código exista en el índice autoritativo.
   *
   * @param {*} codigo Código recibido.
   * @param {!Object<string,!Object>} mapaCatalogo Índice del catálogo.
   * @return {!Object} Código normalizado y producto localizado.
   * @throws {Error} Si el código está vacío o no existe.
   * @private
   */
  function _validarCodigo_(codigo, mapaCatalogo) {
    const normalizedCode = toStrUpper_(codigo);
    if (!normalizedCode) {
      throw new Error("El código es obligatorio.");
    }

    const product = mapaCatalogo[normalizedCode];
    if (!product) {
      throw new Error(
        `El código "${normalizedCode}" no existe en el catálogo.`
      );
    }

    return {
      codigo: normalizedCode,
      producto: product
    };
  }

  /**
   * Valida un tipo de etiqueta y resuelve sus dimensiones autorizadas.
   *
   * IDENTIFICADORA siempre utiliza 150 x 100 mm. Los demás tipos dependen del
   * catálogo de medidas para conservar compatibilidad con el modelo anterior.
   *
   * @param {*} tipo Tipo solicitado.
   * @param {!Object<string,!Object>} mapaMedidas Índice de medidas.
   * @return {!Object} Tipo normalizado y medida autorizada.
   * @throws {Error} Si el tipo está vacío o no existe.
   * @private
   */
  function _validarTipoEtiqueta_(tipo, mapaMedidas) {
    const normalizedType = toStrUpper_(tipo);
    if (!normalizedType) {
      throw new Error("El tipo de etiqueta es obligatorio.");
    }

    if (normalizedType === CFG.IDENTIFIER_TYPE) {
      return {
        tipo: CFG.IDENTIFIER_TYPE,
        medida: {
          ancho: CFG.IDENTIFIER_WIDTH_MM,
          alto: CFG.IDENTIFIER_HEIGHT_MM
        }
      };
    }

    const measure = mapaMedidas[normalizedType];
    if (!measure) {
      throw new Error(`El tipo de etiqueta "${normalizedType}" no existe.`);
    }

    return {
      tipo: normalizedType,
      medida: measure
    };
  }

  /**
   * Valida una dimensión física en milímetros.
   *
   * @param {*} value Valor recibido.
   * @param {string} fieldName Nombre utilizado en mensajes de error.
   * @param {string} code Código del producto relacionado.
   * @return {number} Dimensión finita y positiva.
   * @throws {Error} Si el valor no es válido.
   * @private
   */
  function _validarDimension_(value, fieldName, code) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      throw new Error(
        `${fieldName} del código "${code}" debe ser mayor que cero.`
      );
    }
    return numericValue;
  }

  /**
   * Construye la marca temporal base utilizada por los folios.
   *
   * @param {!Object} temporal Contexto con fecha y hora formateadas.
   * @return {string} Marca en formato yyyyMMddHHmmssSSS.
   * @private
   */
  function _buildTimestampBase_(temporal) {
    return (
      temporal.fecha.split("/").reverse().join("") +
      temporal.hora.replace(/:/g, "") +
      String(temporal.ahora.getMilliseconds()).padStart(3, "0")
    );
  }

  /**
   * Construye un folio único dentro del lote.
   *
   * @param {string} timestampBase Marca temporal común del lote.
   * @param {string} code Código del producto.
   * @param {number} itemIndex Índice base cero del elemento.
   * @return {string} Folio trazable del elemento.
   * @private
   */
  function _buildFolio_(timestampBase, code, itemIndex) {
    return [
      timestampBase,
      code,
      String(itemIndex + 1).padStart(4, "0"),
      CFG.FOLIO_SUFFIX
    ].join("&");
  }

  /**
   * Normaliza un elemento del lote utilizando datos autoritativos.
   *
   * La descripción y el ID se toman siempre del catálogo. Para IDENTIFICADORA,
   * el cliente no puede sobrescribir las dimensiones físicas oficiales.
   *
   * @param {!Object} item Elemento solicitado.
   * @param {number} itemIndex Índice del elemento dentro del lote.
   * @param {!Object<string,!Object>} mapaCatalogo Índice de productos.
   * @param {!Object<string,!Object>} mapaMedidas Índice de medidas.
   * @param {string} timestampBase Marca temporal común del lote.
   * @return {!Object} Elemento normalizado para la plantilla.
   * @throws {Error} Si falta algún dato obligatorio.
   * @private
   */
  function _normalizarItem_(
    item,
    itemIndex,
    mapaCatalogo,
    mapaMedidas,
    timestampBase
  ) {
    const codeValidation = _validarCodigo_(item.codigo, mapaCatalogo);
    const typeValidation = _validarTipoEtiqueta_(item.tipo, mapaMedidas);
    const code = codeValidation.codigo;
    const product = codeValidation.producto;
    const type = typeValidation.tipo;
    const measure = typeValidation.medida;
    const description = toStrUpper_(product.descripcion);
    const productId = toStr_(product.idproducto);

    if (!description) {
      throw new Error(`El código "${code}" no tiene descripción.`);
    }
    if (!productId) {
      throw new Error(`El código "${code}" no tiene ID producto.`);
    }

    const width =
      type === CFG.IDENTIFIER_TYPE
        ? CFG.IDENTIFIER_WIDTH_MM
        : _validarDimension_(item.ancho || measure.ancho, "El ancho", code);
    const height =
      type === CFG.IDENTIFIER_TYPE
        ? CFG.IDENTIFIER_HEIGHT_MM
        : _validarDimension_(item.alto || measure.alto, "El alto", code);

    return {
      tipo: type,
      codigo: code,
      descripcion: description,
      id: productId,
      alto: height,
      ancho: width,
      folio: _buildFolio_(timestampBase, code, itemIndex)
    };
  }

  // ==========================================================================
  // RENDERIZADO Y DOCUMENTO DE IMPRESIÓN
  // ==========================================================================

  /**
   * Retira bloques script del HTML destinado al puente online.
   *
   * Esta medida no sustituye un sanitizador especializado. La plantilla debe ser
   * controlada por el proyecto y no interpolar HTML arbitrario sin escapar.
   *
   * @param {*} html HTML generado por la plantilla.
   * @return {string} HTML sin bloques script.
   * @private
   */
  function _prepararHtmlOnline_(html) {
    return String(html || "").replace(
      /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
      ""
    );
  }

  /**
   * Renderiza la plantilla de etiquetas identificadoras.
   *
   * @param {!Array<!Object>} normalizedBatch Lote ya validado.
   * @param {string} dateTime Fecha y hora visibles.
   * @param {string} printMode LOCAL u ONLINE.
   * @return {string} HTML evaluado.
   * @throws {Error} Si el lote está vacío o la plantilla no genera contenido.
   * @private
   */
  function _renderEtiquetaIdentificadora_(
    normalizedBatch,
    dateTime,
    printMode
  ) {
    if (!Array.isArray(normalizedBatch) || normalizedBatch.length === 0) {
      throw new Error("No existe un lote válido para renderizar.");
    }

    const mode =
      printMode === CFG.ONLINE_MODE ? CFG.ONLINE_MODE : CFG.LOCAL_MODE;
    const template = HtmlService.createTemplateFromFile(CFG.TEMPLATE_FILE);

    template.lote = normalizedBatch;
    template.fechaHora = toStr_(dateTime);
    template.modoImpresion = mode;

    const content = template.evaluate().getContent();
    if (!toStr_(content)) {
      throw new Error("La plantilla identificadora no generó contenido.");
    }

    return content;
  }

  // ==========================================================================
  // API PÚBLICA
  // ==========================================================================

  /**
   * Construye la carga inicial de la vista.
   *
   * Cada repositorio se lee una sola vez durante la operación.
   *
   * @return {!Object} Códigos, productos, medidas y tipos disponibles.
   */
  function getBootstrap() {
    _assertDependencies_();

    const catalogRows = _getCatalogRows_();
    const etiquetaRows = _getEtiquetaRows_();

    return {
      codigos: _buildCodigos_(catalogRows),
      mapaCatalogo: _buildMapaCatalogo_(catalogRows),
      mapaMedidas: _buildMapaMedidas_(etiquetaRows),
      nombresEtiquetas: _buildNombresEtiquetas_(etiquetaRows),
      contratoIdentificadora: {
        ancho: CFG.IDENTIFIER_WIDTH_MM,
        alto: CFG.IDENTIFIER_HEIGHT_MM,
        areaSeguraAncho: CFG.SAFE_AREA_WIDTH_MM,
        areaSeguraAlto: CFG.SAFE_AREA_HEIGHT_MM
      }
    };
  }

  /**
   * Busca un producto mediante código exacto normalizado.
   *
   * @param {*} codigo Código solicitado.
   * @return {!Object} Resultado de búsqueda y datos normalizados.
   */
  function buscarProductoPorCodigo(codigo) {
    _assertDependencies_();

    const normalizedCode = toStrUpper_(codigo);
    if (!normalizedCode) {
      return { encontrado: false };
    }

    const product = _getCatalogRows_().find(function (item) {
      return toStrUpper_(item && item.codigo) === normalizedCode;
    });

    if (!product) {
      return { encontrado: false };
    }

    return {
      encontrado: true,
      codigo: normalizedCode,
      idproducto: toStr_(product.idproducto),
      descripcion: toStrUpper_(product.descripcion),
      status: toStrUpper_(product.status)
    };
  }

  /**
   * Valida un lote y genera documentos para impresión LOCAL y ONLINE.
   *
   * @param {!Array<!Object>} lote Solicitudes enviadas por la interfaz.
   * @return {!Object} HTML local, trabajo online y metadatos.
   * @throws {Error} Si algún elemento o dependencia no es válido.
   */
  function procesarLote(lote) {
    _assertDependencies_();
    const input = _validateBatch_(lote);
    const catalogRows = _getCatalogRows_();
    const etiquetaRows = _getEtiquetaRows_();
    const mapaCatalogo = _buildMapaCatalogo_(catalogRows);
    const mapaMedidas = _buildMapaMedidas_(etiquetaRows);
    const spreadsheet = getSpreadsheetByFileKey_(
      _getEtiquetasFileKey_()
    );
    const temporal = _obtenerContextoTemporal_(spreadsheet);
    const dateTime = `${temporal.fecha} ${temporal.hora}`;
    const timestampBase = _buildTimestampBase_(temporal);

    const normalizedBatch = input.map(function (item, index) {
      return _normalizarItem_(
        item,
        index,
        mapaCatalogo,
        mapaMedidas,
        timestampBase
      );
    });

    const folios = new Set();
    normalizedBatch.forEach(function (item) {
      if (folios.has(item.folio)) {
        throw new Error(`El folio ${item.folio} se generó más de una vez.`);
      }
      folios.add(item.folio);
    });

    const localHtml = _renderEtiquetaIdentificadora_(
      normalizedBatch,
      dateTime,
      CFG.LOCAL_MODE
    );
    const onlineHtml = _prepararHtmlOnline_(
      _renderEtiquetaIdentificadora_(
        normalizedBatch,
        dateTime,
        CFG.ONLINE_MODE
      )
    );

    const printJob = {
      tipo: CFG.PRINT_JOB_TYPE,
      origen: CFG.MODULE_NAME,
      formato: CFG.OUTPUT_FORMAT,
      html: onlineHtml,
      content: onlineHtml,
      meta: {
        modulo: CFG.MODULE_NAME,
        total: normalizedBatch.length,
        fechaHora: dateTime,
        zonaHoraria: temporal.zonaHoraria,
        etiqueta: CFG.LABEL_FORMAT,
        formatoEtiqueta: CFG.OUTPUT_FORMAT,
        papel: CFG.PAPER_SIZE,
        anchoMm: CFG.IDENTIFIER_WIDTH_MM,
        altoMm: CFG.IDENTIFIER_HEIGHT_MM,
        areaSeguraAnchoMm: CFG.SAFE_AREA_WIDTH_MM,
        areaSeguraAltoMm: CFG.SAFE_AREA_HEIGHT_MM
      }
    };

    return {
      ok: true,
      modoCompatible: [CFG.LOCAL_MODE, CFG.ONLINE_MODE],
      htmlImpresion: localHtml,
      printJob,
      total: normalizedBatch.length
    };
  }

  return Object.freeze({
    getBootstrap,
    buscarProductoPorCodigo,
    procesarLote
  });
})();
