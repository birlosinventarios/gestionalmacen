/**
 * z3-FormularioEtiquetasExcedentesReimpresionService
 *
 * @fileoverview Servicio de dominio para consultar excedentes vigentes y generar
 * trabajos de reimpresión de etiquetas en modos LOCAL y ONLINE.
 *
 * El servicio utiliza EstadoActualExcedentesService como fuente autoritativa,
 * adapta el modelo consolidado al contrato de la vista, valida cada elemento del
 * lote y renderiza el HTML mediante la plantilla EtiquetaExcedentesImpresa.
 *
 * Responsabilidades:
 * - Obtener el catálogo vigente disponible para reimpresión.
 * - Convertir el estado canónico al contrato esperado por la interfaz.
 * - Construir listas únicas de IDs, códigos y ubicaciones.
 * - Validar estructura, identidad, descripción, cantidad y ubicación del lote.
 * - Revalidar los IdUnicos contra la fuente autoritativa antes de imprimir.
 * - Renderizar HTML para impresión local y para el trabajo online.
 * - Retirar scripts del HTML enviado a servicios de impresión remotos.
 * - Construir metadatos uniformes del trabajo de impresión.
 *
 * Dependencias globales:
 * - EstadoActualExcedentesService como fuente principal.
 * - ExcedentesRepository como respaldo defensivo.
 * - getSpreadsheetByFileKey_(fileKey).
 * - SHEETS.EXCEDENTES.file.
 * - HtmlService y Utilities de Google Apps Script.
 * - toStr_(value), toStrUpper_(value) y toNum_(value).
 *
 * Reglas de integridad:
 * - Solo se imprimen elementos con IdUnico, código, descripción y cantidad.
 * - La cantidad debe ser finita y mayor que cero.
 * - Los IdUnicos duplicados dentro del lote se rechazan.
 * - El lote no puede exceder el máximo configurado.
 * - Los datos autoritativos prevalecen sobre valores descriptivos del cliente.
 * - Los elementos que dejaron de estar vigentes se rechazan antes de renderizar.
 * - El HTML ONLINE no incluye etiquetas script.
 * - El servicio no modifica existencias, saldos, ubicaciones ni movimientos.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const FormularioEtiquetasExcedentesReimpresionService = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    TEMPLATE_FILE: "EtiquetaExcedentesImpresa",
    DEFAULT_TIME_ZONE: "America/Mexico_City",
    DATE_FORMAT: "dd/MM/yyyy",
    TIME_FORMAT: "HH:mm:ss",
    LOCAL_MODE: "LOCAL",
    ONLINE_MODE: "ONLINE",
    MAX_BATCH_ITEMS: 500,
    PAPER_SIZE: "150x100mm",
    PRINT_JOB_TYPE: "REIMPRESION_ETIQUETAS_EXCEDENTES",
    MODULE_NAME: "FormularioEtiquetasExcedentesReimpresion",
    LABEL_FORMAT: "EXCEDENTES_REIMPRESION",
    LOG_PREFIX: "[FormularioEtiquetasExcedentesReimpresionService]"
  });

  // ==========================================================================
  // VALIDACIÓN DE DEPENDENCIAS Y CONTRATOS
  // ==========================================================================

  /**
   * Verifica las utilidades y servicios obligatorios del módulo.
   *
   * EstadoActualExcedentesService es preferido, pero ExcedentesRepository se
   * acepta como fuente de respaldo para conservar compatibilidad operativa.
   *
   * @return {void}
   * @throws {Error} Si faltan utilidades o no existe ninguna fuente compatible.
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

    if (
      typeof HtmlService === "undefined" ||
      typeof Utilities === "undefined"
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} HtmlService y Utilities son obligatorios.`
      );
    }

    const hasCanonicalSource =
      typeof EstadoActualExcedentesService !== "undefined" &&
      EstadoActualExcedentesService &&
      typeof EstadoActualExcedentesService.getVigentes === "function";
    const hasFallbackSource =
      typeof ExcedentesRepository !== "undefined" &&
      ExcedentesRepository &&
      typeof ExcedentesRepository.getAll === "function";

    if (!hasCanonicalSource && !hasFallbackSource) {
      throw new Error(
        `${CFG.LOG_PREFIX} No existe una fuente compatible de excedentes.`
      );
    }
  }

  /**
   * Obtiene la clave del archivo de excedentes configurado.
   *
   * @return {string} Clave lógica del archivo.
   * @throws {Error} Si SHEETS.EXCEDENTES.file no está configurado.
   * @private
   */
  function _getExcedentesFileKey_() {
    if (
      typeof SHEETS === "undefined" ||
      !SHEETS ||
      !SHEETS.EXCEDENTES ||
      !toStr_(SHEETS.EXCEDENTES.file)
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} No existe SHEETS.EXCEDENTES.file.`
      );
    }

    return toStr_(SHEETS.EXCEDENTES.file);
  }

  // ==========================================================================
  // CONTEXTO TEMPORAL Y NORMALIZACIÓN DE LA FUENTE
  // ==========================================================================

  /**
   * Construye la fecha y hora de impresión con la zona del archivo.
   *
   * Si el archivo no expone una zona horaria válida, utiliza la zona predeterminada
   * configurada para mantener una salida determinista.
   *
   * @param {!GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet Archivo origen.
   * @return {!Object} Fecha, hora y zona horaria usadas en la impresión.
   * @throws {TypeError} Si el objeto no representa un Spreadsheet válido.
   * @private
   */
  function _obtenerContextoTemporal_(spreadsheet) {
    if (
      !spreadsheet ||
      typeof spreadsheet.getSpreadsheetTimeZone !== "function"
    ) {
      throw new TypeError(
        `${CFG.LOG_PREFIX} Se requiere un Spreadsheet válido.`
      );
    }

    const timeZone =
      toStr_(spreadsheet.getSpreadsheetTimeZone()) || CFG.DEFAULT_TIME_ZONE;
    const now = new Date();

    return {
      fecha: Utilities.formatDate(now, timeZone, CFG.DATE_FORMAT),
      hora: Utilities.formatDate(now, timeZone, CFG.TIME_FORMAT),
      zonaHoraria: timeZone
    };
  }

  /**
   * Adapta un registro consolidado al contrato de la vista de reimpresión.
   *
   * UBICACION contiene el texto mostrado por la interfaz. La ubicación física real
   * permanece en ESTADOACTUALEXCEDENTES para conservar trazabilidad.
   *
   * @param {!Object} item Registro de EstadoActualExcedentesService.
   * @return {!Object} Registro normalizado para la vista.
   * @throws {TypeError} Si el elemento no es un objeto válido.
   * @private
   */
  function _mapEstadoActualToView_(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError(
        `${CFG.LOG_PREFIX} El registro consolidado es inválido.`
      );
    }

    const currentLocation = toStrUpper_(item.ubicacionActual);
    const recordStatus = toStrUpper_(item.estatusRegistro);
    const logicalStatus = toStrUpper_(item.estatusLogico);

    let visibleLocation = "SIN UBICACION";
    if (currentLocation) {
      visibleLocation = currentLocation;
    } else if (recordStatus === "DISPONIBLE") {
      visibleLocation = "DISPONIBLE";
    }

    return {
      IDUNICO: toStr_(item.idUnico),
      CODIGO: toStrUpper_(item.codigo),
      DESCRIPCION: toStrUpper_(item.descripcion),
      CANTIDAD: toNum_(item.saldoActual || item.saldoBase || 0),
      UBICACION: visibleLocation,
      ESTADOACTUALEXCEDENTES: currentLocation,
      ESTATUS: recordStatus || "DISPONIBLE",
      ESTATUSLOGICO: logicalStatus,
      BODEGAACTUAL: toStrUpper_(item.bodegaActual),
      IDPRODUCTO: toStr_(item.idproducto)
    };
  }

  /**
   * Adapta un registro histórico cuando el servicio canónico no está disponible.
   *
   * Este respaldo no puede inferir la ubicación vigente mediante traspasos, por lo
   * que ESTADOACTUALEXCEDENTES y BODEGAACTUAL se devuelven vacíos.
   *
   * @param {!Object} item Registro proveniente de ExcedentesRepository.
   * @return {!Object} Registro compatible con la vista.
   * @private
   */
  function _mapFallbackToView_(item) {
    const status = toStrUpper_(item && item.status);

    return {
      IDUNICO: toStr_(item && item.idunico),
      CODIGO: toStrUpper_(item && item.codigo),
      DESCRIPCION: toStrUpper_(item && item.descripcion),
      CANTIDAD: toNum_(item && item.cantidad),
      UBICACION: status === "DISPONIBLE" ? "DISPONIBLE" : "SIN UBICACION",
      ESTADOACTUALEXCEDENTES: "",
      ESTATUS: status || "DISPONIBLE",
      ESTATUSLOGICO: "",
      BODEGAACTUAL: "",
      IDPRODUCTO: toStr_(item && item.idproducto)
    };
  }

  /**
   * Obtiene la base normalizada disponible para reimpresión.
   *
   * Prioriza el estado consolidado vigente. El repositorio histórico se utiliza
   * únicamente como respaldo defensivo y genera una advertencia diagnóstica.
   *
   * @return {!Array<!Object>} Registros válidos para búsqueda y selección.
   * @throws {Error} Si la fuente devuelve un valor distinto de un arreglo.
   * @private
   */
  function _obtenerBaseNormalizada_() {
    _assertDependencies_();

    if (
      typeof EstadoActualExcedentesService !== "undefined" &&
      EstadoActualExcedentesService &&
      typeof EstadoActualExcedentesService.getVigentes === "function"
    ) {
      const vigentes = EstadoActualExcedentesService.getVigentes();
      if (!Array.isArray(vigentes)) {
        throw new Error(
          `${CFG.LOG_PREFIX} getVigentes() no devolvió un arreglo.`
        );
      }

      return vigentes
        .filter(function (item) {
          return Boolean(item && item.idUnico && item.codigo);
        })
        .map(_mapEstadoActualToView_);
    }

    console.warn(
      `${CFG.LOG_PREFIX} Se utilizará ExcedentesRepository como respaldo. ` +
        "La ubicación vigente podría no estar disponible."
    );

    const historicalRows = ExcedentesRepository.getAll();
    if (!Array.isArray(historicalRows)) {
      throw new Error(
        `${CFG.LOG_PREFIX} ExcedentesRepository.getAll() no devolvió un arreglo.`
      );
    }

    return historicalRows
      .filter(function (item) {
        return Boolean(item && item.idunico && item.codigo);
      })
      .map(_mapFallbackToView_);
  }

  /**
   * Obtiene valores únicos, no vacíos y ordenados de una propiedad.
   *
   * @param {!Array<!Object>} list Colección de origen.
   * @param {string} field Propiedad que se desea proyectar.
   * @return {!Array<string>} Valores únicos en orden alfanumérico natural.
   * @private
   */
  function _obtenerValoresUnicos_(list, field) {
    if (!Array.isArray(list)) {
      throw new TypeError(`${CFG.LOG_PREFIX} La colección debe ser un arreglo.`);
    }

    const values = list
      .map(function (item) {
        return toStr_(item && item[field]);
      })
      .filter(Boolean);

    return Array.from(new Set(values)).sort(function (left, right) {
      return left.localeCompare(right, "es-MX", {
        numeric: true,
        sensitivity: "base"
      });
    });
  }

  // ==========================================================================
  // VALIDACIÓN DEL LOTE DE REIMPRESIÓN
  // ==========================================================================

  /**
   * Valida la estructura general de la lista solicitada.
   *
   * @param {*} list Lista recibida desde la interfaz.
   * @return {void}
   * @throws {Error} Si está vacía, supera el límite o contiene tipos inválidos.
   * @private
   */
  function _validarListaReimpresion_(list) {
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error("La lista de reimpresión está vacía.");
    }

    if (list.length > CFG.MAX_BATCH_ITEMS) {
      throw new Error(
        `La lista supera el máximo de ${CFG.MAX_BATCH_ITEMS} etiquetas.`
      );
    }

    if (
      !list.every(function (item) {
        return item && typeof item === "object" && !Array.isArray(item);
      })
    ) {
      throw new Error("La lista contiene elementos inválidos.");
    }
  }

  /**
   * Valida y normaliza una solicitud individual de reimpresión.
   *
   * Soporta nombres camelCase y en mayúsculas para mantener compatibilidad con la
   * vista y con integraciones existentes.
   *
   * @param {!Object} item Elemento recibido desde la interfaz.
   * @return {!Object} Elemento normalizado.
   * @throws {Error} Si falta identidad, información descriptiva o cantidad.
   * @private
   */
  function _validarItemReimpresion_(item) {
    const uniqueId = toStr_(item.idUnico || item.IDUNICO);
    const code = toStrUpper_(item.codigo || item.CODIGO);
    const description = toStrUpper_(
      item.descripcion || item.DESCRIPCION
    );
    const quantity = Number(item.cantidad ?? item.CANTIDAD);
    const location = toStrUpper_(item.ubicacion || item.UBICACION);

    if (!uniqueId) {
      throw new Error("Uno de los elementos no tiene ID único.");
    }
    if (!code) {
      throw new Error(`El elemento ${uniqueId} no tiene código.`);
    }
    if (!description) {
      throw new Error(`El elemento ${uniqueId} no tiene descripción.`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`El elemento ${uniqueId} tiene cantidad inválida.`);
    }

    return {
      idUnico: uniqueId,
      codigo: code,
      descripcion: description,
      cantidad: quantity,
      ubicacion: location || "SIN UBICACION"
    };
  }

  /**
   * Normaliza el lote, detecta IdUnicos duplicados y revalida su vigencia.
   *
   * Los datos retornados por la fuente autoritativa sustituyen código,
   * descripción, cantidad y ubicación enviados por el cliente.
   *
   * @param {!Array<!Object>} list Lista validada estructuralmente.
   * @return {!Array<!Object>} Lote autoritativo listo para renderizar.
   * @throws {Error} Si hay duplicados o un IdUnico dejó de estar vigente.
   * @private
   */
  function _construirLoteAutoritativo_(list) {
    const requested = list.map(_validarItemReimpresion_);
    const seen = new Set();

    requested.forEach(function (item) {
      const key = toStrUpper_(item.idUnico);
      if (seen.has(key)) {
        throw new Error(`El IdUnico ${item.idUnico} está duplicado en el lote.`);
      }
      seen.add(key);
    });

    const source = _obtenerBaseNormalizada_();
    const byId = source.reduce(function (index, item) {
      const key = toStrUpper_(item.IDUNICO);
      if (key && !Object.prototype.hasOwnProperty.call(index, key)) {
        index[key] = item;
      }
      return index;
    }, Object.create(null));

    return requested.map(function (item) {
      const current = byId[toStrUpper_(item.idUnico)];
      if (!current) {
        throw new Error(
          `El IdUnico ${item.idUnico} ya no está vigente para reimpresión.`
        );
      }

      const quantity = Number(current.CANTIDAD);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(
          `El IdUnico ${item.idUnico} ya no tiene saldo disponible.`
        );
      }

      return {
        idUnico: toStr_(current.IDUNICO),
        codigo: toStrUpper_(current.CODIGO),
        descripcion: toStrUpper_(current.DESCRIPCION),
        cantidad: quantity,
        ubicacion: toStrUpper_(current.UBICACION) || "SIN UBICACION"
      };
    });
  }

  // ==========================================================================
  // RENDERIZADO Y TRABAJO DE IMPRESIÓN
  // ==========================================================================

  /**
   * Prepara HTML para distribución online retirando etiquetas script.
   *
   * Esta función reduce contenido ejecutable básico, pero no sustituye un
   * sanitizador HTML especializado. La plantilla debe permanecer bajo control del
   * proyecto y no debe interpolar HTML arbitrario sin escapar.
   *
   * @param {*} html Contenido HTML generado por la plantilla.
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
   * Renderiza el lote mediante la plantilla de etiquetas.
   *
   * @param {!Array<!Object>} validatedBatch Lote autoritativo validado.
   * @param {string} dateTime Fecha y hora visibles en la etiqueta.
   * @param {string} printMode LOCAL u ONLINE.
   * @return {string} HTML completamente evaluado.
   * @throws {Error} Si la plantilla no genera contenido.
   * @private
   */
  function _renderEtiquetaExcedentesReimpresion_(
    validatedBatch,
    dateTime,
    printMode
  ) {
    if (!Array.isArray(validatedBatch) || validatedBatch.length === 0) {
      throw new Error("No existe un lote válido para renderizar.");
    }

    const mode =
      printMode === CFG.ONLINE_MODE ? CFG.ONLINE_MODE : CFG.LOCAL_MODE;
    const template = HtmlService.createTemplateFromFile(CFG.TEMPLATE_FILE);

    template.lote = validatedBatch.map(function (item) {
      return {
        codigo: item.codigo,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        ubicacion: item.ubicacion,
        id: item.idUnico,
        idUnico: item.idUnico
      };
    });
    template.fechaHora = toStr_(dateTime);
    template.modoImpresion = mode;

    const content = template.evaluate().getContent();
    if (!toStr_(content)) {
      throw new Error("La plantilla de etiquetas no generó contenido.");
    }

    return content;
  }

  // ==========================================================================
  // API PÚBLICA
  // ==========================================================================

  /**
   * Construye los filtros iniciales de la vista de reimpresión.
   *
   * @return {!Object} Totales y catálogos únicos de búsqueda.
   */
  function getBootstrap() {
    const base = _obtenerBaseNormalizada_();

    return {
      totalRegistros: base.length,
      ids: _obtenerValoresUnicos_(base, "IDUNICO"),
      codigos: _obtenerValoresUnicos_(base, "CODIGO"),
      ubicaciones: _obtenerValoresUnicos_(base, "UBICACION")
    };
  }

  /**
   * Devuelve la base normalizada disponible para selección.
   *
   * @return {!Array<!Object>} Excedentes vigentes compatibles con la vista.
   */
  function obtenerBase() {
    return _obtenerBaseNormalizada_();
  }

  /**
   * Valida un lote y genera entregables de impresión local y online.
   *
   * @param {!Array<!Object>} lista Elementos seleccionados por el usuario.
   * @return {!Object} HTML local, trabajo online y metadatos del lote.
   * @throws {Error} Si el lote es inválido o dejó de estar vigente.
   */
  function procesarReimpresion(lista) {
    _assertDependencies_();
    _validarListaReimpresion_(lista);

    const spreadsheet = getSpreadsheetByFileKey_(
      _getExcedentesFileKey_()
    );
    const temporalContext = _obtenerContextoTemporal_(spreadsheet);
    const dateTime =
      `${temporalContext.fecha} ${temporalContext.hora}`;
    const validatedBatch = _construirLoteAutoritativo_(lista);

    const localHtml = _renderEtiquetaExcedentesReimpresion_(
      validatedBatch,
      dateTime,
      CFG.LOCAL_MODE
    );
    const onlineHtml = _prepararHtmlOnline_(
      _renderEtiquetaExcedentesReimpresion_(
        validatedBatch,
        dateTime,
        CFG.ONLINE_MODE
      )
    );

    const printJob = {
      tipo: CFG.PRINT_JOB_TYPE,
      origen: CFG.MODULE_NAME,
      formato: "HTML",
      html: onlineHtml,
      content: onlineHtml,
      meta: {
        modulo: CFG.MODULE_NAME,
        total: validatedBatch.length,
        fechaHora: dateTime,
        zonaHoraria: temporalContext.zonaHoraria,
        etiqueta: CFG.LABEL_FORMAT,
        formatoEtiqueta: "HTML",
        papel: CFG.PAPER_SIZE
      }
    };

    return {
      ok: true,
      modoCompatible: [CFG.LOCAL_MODE, CFG.ONLINE_MODE],
      htmlImpresion: localHtml,
      printJob,
      total: validatedBatch.length
    };
  }

  return Object.freeze({
    getBootstrap,
    obtenerBase,
    procesarReimpresion
  });
})();
