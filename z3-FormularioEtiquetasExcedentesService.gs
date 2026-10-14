/**
 * z3-FormularioEtiquetasExcedentesService
 *
 * @fileoverview Servicio de dominio para validar, registrar y preparar la
 * impresión de etiquetas correspondientes a nuevos excedentes.
 *
 * El servicio obtiene el catálogo autoritativo, valida cada elemento del lote,
 * exige un único responsable de impresión, registra las filas en BD-EXCEDENTES
 * bajo ScriptLock y genera documentos HTML para impresión LOCAL y ONLINE.
 *
 * Responsabilidades:
 * - Construir los catálogos requeridos por la vista.
 * - Validar código, cantidad, IdUnico, caja, total de cajas y responsable.
 * - Exigir un único responsable para todo el lote de impresión.
 * - Resolver ID, código y descripción desde el catálogo autoritativo.
 * - Construir filas físicas compatibles con BD-EXCEDENTES.
 * - Registrar el lote bajo exclusión mutua mediante ScriptLock.
 * - Confirmar la escritura con SpreadsheetApp.flush().
 * - Invalidar las cachés operativas después de una escritura exitosa.
 * - Renderizar documentos para impresión local y online.
 * - Retirar bloques script del HTML enviado al puente de impresión online.
 *
 * Dependencias globales:
 * - CatalogoRepository y ExcedentesRepository.
 * - getSpreadsheetByFileKey_(fileKey) y getSheetByKey_(sheetKey).
 * - clearOperationalCaches_(), cuando esté disponible.
 * - COL.EXCEDENTES.RESPONSABLEIMPRESION.
 * - SHEETS.EXCEDENTES.file.
 * - HtmlService, Utilities, LockService y SpreadsheetApp.
 * - toStr_(value), toStrUpper_(value) y toNum_(value).
 * - Plantilla EtiquetaExcedentesImpresa.
 *
 * Reglas de integridad:
 * - El lote no puede estar vacío ni superar el máximo configurado.
 * - Todos los elementos deben pertenecer a un único responsable de impresión.
 * - El responsable es obligatorio, pero no se restringe por rol.
 * - Código, producto y descripción se validan contra el catálogo vigente.
 * - Cantidad, caja y total de cajas deben ser valores finitos y positivos.
 * - cajaNo no puede ser mayor que totalCajas.
 * - Los IdUnicos no pueden repetirse dentro del lote.
 * - El contrato físico de BD-EXCEDENTES debe contener exactamente nueve columnas.
 * - El servicio no modifica existencias, saldos, ubicaciones ni traspasos.
 *
 * Concurrencia:
 * - procesarLote() adquiere ScriptLock antes de releer catálogo y escribir.
 * - El bloqueo se libera siempre mediante finally.
 * - Las cachés se invalidan únicamente después de completar la escritura.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const FormularioEtiquetasExcedentesService = (() => {
  "use strict";

  const DOMAIN = Object.freeze({
    SHEET_KEY: "EXCEDENTES",
    STATUS_INICIAL: "DISPONIBLE",
    LOCK_TIMEOUT_MS: 30000,
    RESPONSABLE_MAX_LENGTH: 250,
    MODULO: "FormularioEtiquetasExcedentes",
    TIPO_IMPRESION: "ETIQUETAS_EXCEDENTES",
    ETIQUETA: "EXCEDENTES",
    FORMATO: "HTML",
    PAPEL: "150x100mm",
    TEMPLATE_FILE: "EtiquetaExcedentesImpresa",
    MODO_LOCAL: "LOCAL",
    MODO_ONLINE: "ONLINE",
    MAX_BATCH_ITEMS: 500,
    EXPECTED_WIDTH: 9,
    LOCALE: "es-MX",
    LOG_PREFIX: "[FormularioEtiquetasExcedentesService]"
  });

  // ==========================================================================
  // VALIDACIÓN DE DEPENDENCIAS Y CONTRATOS
  // ==========================================================================

  /**
   * Verifica que todos los servicios y repositorios obligatorios estén activos.
   *
   * @return {void}
   * @throws {Error} Si falta una dependencia necesaria para consultar o escribir.
   * @private
   */
  /**
   * Verifica los servicios y repositorios obligatorios.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _assertDependencies_() {
    const functions = [
      ["getSpreadsheetByFileKey_", typeof getSpreadsheetByFileKey_],
      ["getSheetByKey_", typeof getSheetByKey_],
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
        `${DOMAIN.LOG_PREFIX} Faltan utilidades globales: ` +
          `${missingFunctions.join(", ")}.`
      );
    }

    const repositories = [
      ["CatalogoRepository", typeof CatalogoRepository],
      ["ExcedentesRepository", typeof ExcedentesRepository]
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
        `${DOMAIN.LOG_PREFIX} Faltan repositorios obligatorios: ` +
          `${missingRepositories.join(", ")}.`
      );
    }

    if (
      typeof HtmlService === "undefined" ||
      typeof Utilities === "undefined" ||
      typeof LockService === "undefined" ||
      typeof SpreadsheetApp === "undefined"
    ) {
      throw new Error(
        `${DOMAIN.LOG_PREFIX} Faltan servicios obligatorios de Apps Script.`
      );
    }
  }

  /**
   * Obtiene y valida la clave del archivo configurado para excedentes.
   *
   * @return {string} Clave lógica del archivo de destino.
   * @throws {Error} Si SHEETS.EXCEDENTES.file no está disponible.
   * @private
   */
  /**
   * Obtiene la clave del archivo de excedentes.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _getExcedentesFileKey_() {
    if (
      typeof SHEETS === "undefined" ||
      !SHEETS ||
      !SHEETS.EXCEDENTES ||
      !toStr_(SHEETS.EXCEDENTES.file)
    ) {
      throw new Error(`${DOMAIN.LOG_PREFIX} No existe SHEETS.EXCEDENTES.file.`);
    }
    return toStr_(SHEETS.EXCEDENTES.file);
  }

  /**
   * Valida el ancho físico esperado para las filas de BD-EXCEDENTES.
   *
   * @return {number} Ancho validado del contrato físico.
   * @throws {Error} Si COL.EXCEDENTES no está configurado correctamente.
   * @private
   */
  /**
   * Valida el ancho del contrato físico.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _getExpectedWidth_() {
    if (
      typeof COL === "undefined" ||
      !COL ||
      !COL.EXCEDENTES ||
      !Number.isInteger(COL.EXCEDENTES.RESPONSABLEIMPRESION)
    ) {
      throw new Error(
        `${DOMAIN.LOG_PREFIX} No existe ` +
          "COL.EXCEDENTES.RESPONSABLEIMPRESION."
      );
    }

    const width = COL.EXCEDENTES.RESPONSABLEIMPRESION + 1;
    if (width !== DOMAIN.EXPECTED_WIDTH) {
      throw new Error(
        `El contrato de BD-EXCEDENTES debe contener ` +
          `${DOMAIN.EXPECTED_WIDTH} columnas.`
      );
    }
    return width;
  }

  // ==========================================================================
  // CONTEXTO TEMPORAL Y CATÁLOGO
  // ==========================================================================

  /**
   * Obtiene la fecha y hora con la zona horaria del Spreadsheet de destino.
   *
   * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet Archivo destino.
   * @return {{fecha:string, hora:string, ahora:Date, zonaHoraria:string}}
   */
  /**
   * Obtiene fecha y hora en la zona del archivo destino.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _obtenerContextoTemporal_(spreadsheet) {
    if (!spreadsheet) {
      throw new Error("No se recibió el Spreadsheet de excedentes.");
    }

    const zonaHoraria = spreadsheet.getSpreadsheetTimeZone();
    const ahora = new Date();

    return {
      fecha: Utilities.formatDate(ahora, zonaHoraria, "dd/MM/yyyy"),
      hora: Utilities.formatDate(ahora, zonaHoraria, "HH:mm:ss"),
      ahora: ahora,
      zonaHoraria: zonaHoraria
    };
  }

  /**
   * Construye la lista única y ordenada de códigos disponibles.
   *
   * @return {Array<string>}
   */
  /**
   * Construye códigos únicos y ordenados.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _buildCodigos_() {
    const codigos = CatalogoRepository
      .getCodigos()
      .map(function(codigo) {
        return toStrUpper_(codigo);
      })
      .filter(Boolean);

    return Array.from(new Set(codigos)).sort(function(a, b) {
      return a.localeCompare(b, DOMAIN.LOCALE, {
        numeric: true,
        sensitivity: "base"
      });
    });
  }

  /**
   * Construye un índice de catálogo por código normalizado.
   *
   * @return {Object<string, Object>}
   */
  /**
   * Construye un índice seguro del catálogo por código.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _buildMapaCatalogo_() {
    return CatalogoRepository.getAll().reduce(function(index, item) {
      const codigo = toStrUpper_(item && item.codigo);

      if (!codigo) {
        return index;
      }

      index[codigo] = {
        idproducto: toStr_(item.idproducto),
        codigo: codigo,
        descripcion: toStrUpper_(item.descripcion),
        status: toStrUpper_(item.status)
      };

      return index;
    }, {});
  }

  // ==========================================================================
  // VALIDACIÓN DE ELEMENTOS Y RESPONSABLE
  // ==========================================================================

  /**
   * Valida que el código exista en el catálogo vigente cargado por el Service.
   *
   * @param {*} codigo Código recibido.
   * @param {Object<string, Object>} mapaCatalogo Índice del catálogo.
   * @return {{codigo:string, producto:Object}}
   */
  /**
   * Valida un código contra el catálogo vigente.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _validarCodigo_(codigo, mapaCatalogo) {
    const codigoNormalizado = toStrUpper_(codigo);

    if (!codigoNormalizado) {
      throw new Error("El código es obligatorio.");
    }

    const producto = mapaCatalogo[codigoNormalizado];

    if (!producto) {
      throw new Error(
        'El código "' + codigoNormalizado + '" no existe en el catálogo.'
      );
    }

    return {
      codigo: codigoNormalizado,
      producto: producto
    };
  }

  /**
   * Valida una cantidad positiva.
   *
   * @param {*} cantidad Cantidad recibida.
   * @param {string} codigo Código relacionado.
   * @return {number}
   */
  /**
   * Valida una cantidad finita y positiva.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _validarCantidad_(cantidad, codigo) {
    const valor = toNum_(cantidad);

    if (!Number.isFinite(Number(valor)) || valor <= 0) {
      throw new Error(
        'La cantidad del código "' + codigo + '" debe ser mayor a cero.'
      );
    }

    return valor;
  }

  /**
   * Valida el identificador único de una etiqueta.
   *
   * @param {*} idUnico Identificador recibido.
   * @param {string} codigo Código relacionado.
   * @return {string}
   */
  /**
   * Valida el identificador único de una etiqueta.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _validarIdUnico_(idUnico, codigo) {
    const valor = toStr_(idUnico);

    if (!valor) {
      throw new Error(
        'La etiqueta del código "' + codigo + '" no tiene idUnico.'
      );
    }

    return valor;
  }

  /**
   * Valida y normaliza al usuario seleccionado como responsable de impresión.
   *
   * No se aplica ninguna restricción por rol. El valor se conserva como dato
   * operativo para identificar a la persona seleccionada en la vista.
   *
   * @param {*} responsable Valor recibido desde la vista.
   * @param {number=} itemIndex Posición del elemento en el lote.
   * @return {string}
   */
  /**
   * Valida al responsable operativo de impresión.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _validarResponsableImpresion_(responsable, itemIndex) {
    const valor = toStrUpper_(responsable);
    const rowText = Number.isInteger(itemIndex)
      ? " en el elemento " + (itemIndex + 1)
      : "";

    if (!valor) {
      throw new Error(
        "El responsable de impresión es obligatorio" + rowText + "."
      );
    }

    if (valor.length > DOMAIN.RESPONSABLE_MAX_LENGTH) {
      throw new Error(
        "El responsable de impresión excede la longitud permitida" +
        rowText +
        "."
      );
    }

    return valor;
  }

  /**
   * Comprueba que todos los elementos del lote tengan el mismo responsable.
   *
   * La vista representa una sola operación de impresión, por lo que mezclar
   * responsables dentro del mismo lote produciría una auditoría ambigua.
   *
   * @param {Array<Object>} lote Lote recibido.
   * @return {string} Responsable normalizado del lote.
   */
  /**
   * Exige un único responsable para todo el lote.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _resolverResponsableDelLote_(lote) {
    const responsables = lote.map(function(item, index) {
      return _validarResponsableImpresion_(
        item && item.responsableImpresion,
        index
      );
    });

    const unicos = Array.from(new Set(responsables));

    if (unicos.length !== 1) {
      throw new Error(
        "Todas las etiquetas del lote deben tener el mismo responsable de impresión."
      );
    }

    return unicos[0];
  }

  // ==========================================================================
  // MAPEO DE PERSISTENCIA E IMPRESIÓN
  // ==========================================================================

  /**
   * Construye una fila física de nueve columnas para BD-EXCEDENTES.
   *
   * @param {Object} item Elemento del lote.
   * @param {{fecha:string,hora:string}} temporal Contexto temporal.
   * @param {Object<string,Object>} mapaCatalogo Índice del catálogo.
   * @param {string} responsableImpresion Responsable normalizado del lote.
   * @return {Array<*>}
   */
  /**
   * Construye una fila física para BD-EXCEDENTES.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _mapExcedenteToRow_(
    item,
    temporal,
    mapaCatalogo,
    responsableImpresion
  ) {
    const validation = _validarCodigo_(item.codigo, mapaCatalogo);
    const codigo = validation.codigo;
    const producto = validation.producto;
    const descripcion = toStrUpper_(item.descripcion || producto.descripcion);
    const idproducto = toStr_(item.id || producto.idproducto);
    const cantidad = _validarCantidad_(item.cantidad, codigo);
    const idUnico = _validarIdUnico_(item.idUnico, codigo);

    if (!descripcion) {
      throw new Error('El código "' + codigo + '" no tiene descripción.');
    }

    if (!idproducto) {
      throw new Error('El código "' + codigo + '" no tiene ID producto.');
    }

    return [
      idUnico,
      temporal.fecha,
      temporal.hora,
      idproducto,
      codigo,
      descripcion,
      cantidad,
      DOMAIN.STATUS_INICIAL,
      responsableImpresion
    ];
  }

  /**
   * Construye un elemento seguro para la plantilla de impresión.
   *
   * @param {Object} item Elemento del lote.
   * @param {Object<string,Object>} mapaCatalogo Índice del catálogo.
   * @param {string} responsableImpresion Responsable normalizado del lote.
   * @return {Object}
   */
  /**
   * Construye el contrato seguro de una etiqueta.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _mapPrintItem_(item, mapaCatalogo, responsableImpresion) {
    const validation = _validarCodigo_(item.codigo, mapaCatalogo);
    const codigo = validation.codigo;
    const producto = validation.producto;
    const descripcion = toStrUpper_(item.descripcion || producto.descripcion);
    const idproducto = toStr_(item.id || producto.idproducto);
    const cantidad = _validarCantidad_(item.cantidad, codigo);
    const idUnico = _validarIdUnico_(item.idUnico, codigo);
    const cajaNo = toNum_(item.cajaNo);
    const totalCajas = toNum_(item.totalCajas);

    if (!descripcion) {
      throw new Error('El código "' + codigo + '" no tiene descripción.');
    }

    if (!idproducto) {
      throw new Error('El código "' + codigo + '" no tiene ID producto.');
    }

    if (!Number.isInteger(Number(cajaNo)) || cajaNo <= 0) {
      throw new Error('La caja del código "' + codigo + '" no es válida.');
    }

    if (!Number.isInteger(Number(totalCajas)) || totalCajas <= 0) {
      throw new Error(
        'El total de cajas del código "' + codigo + '" no es válido.'
      );
    }

    if (cajaNo > totalCajas) {
      throw new Error(
        'La caja del código "' + codigo + '" excede el total de cajas.'
      );
    }

    return {
      codigo: codigo,
      descripcion: descripcion,
      cantidad: cantidad,
      id: idproducto,
      idUnico: idUnico,
      cajaNo: cajaNo,
      totalCajas: totalCajas,
      responsableImpresion: responsableImpresion
    };
  }

  /**
   * Valida que no existan identificadores duplicados dentro del mismo lote.
   *
   * @param {Array<Object>} lote Lote recibido.
   * @return {boolean}
   */
  /**
   * Detecta IdUnicos repetidos dentro del lote.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _validarIdsUnicosDelLote_(lote) {
    const seen = Object.create(null);

    lote.forEach(function(item, index) {
      const codigo = toStrUpper_(item && item.codigo);
      const idUnico = _validarIdUnico_(item && item.idUnico, codigo || "SIN_CODIGO");

      if (Object.prototype.hasOwnProperty.call(seen, idUnico)) {
        throw new Error(
          "El idUnico " + idUnico + " está repetido dentro del lote."
        );
      }

      seen[idUnico] = index + 1;
    });

    return true;
  }

  /**
   * Elimina scripts de la versión ONLINE del documento antes de enviarlo al
   * puente de impresión.
   *
   * @param {*} html HTML renderizado.
   * @return {string}
   */
  /**
   * Retira bloques script del HTML online.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _prepararHtmlOnline_(html) {
    return String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  }

  /**
   * Renderiza la plantilla de etiquetas.
   *
   * @param {Array<Object>} loteImpresion Lote validado.
   * @param {string} fechaHora Fecha y hora de generación.
   * @param {string} modoImpresion LOCAL u ONLINE.
   * @param {string} responsableImpresion Responsable del lote.
   * @return {string}
   */
  /**
   * Renderiza la plantilla de etiquetas.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _renderEtiquetaExcedentes_(
    loteImpresion,
    fechaHora,
    modoImpresion,
    responsableImpresion
  ) {
    const template = HtmlService.createTemplateFromFile(
      DOMAIN.TEMPLATE_FILE
    );

    template.lote = loteImpresion;
    template.fechaHora = fechaHora;
    template.modoImpresion = modoImpresion || "LOCAL";
    template.responsableImpresion = responsableImpresion;

    return template.evaluate().getContent();
  }

  /**
   * Invalida las cachés operativas después de registrar los excedentes.
   *
   * @return {void}
   */
  /**
   * Invalida cachés operativas después de escribir.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function _clearOperationalCaches_() {
    if (typeof clearOperationalCaches_ === "function") {
      clearOperationalCaches_();
      return;
    }

    if (
      typeof ExcedentesRepository !== "undefined" &&
      ExcedentesRepository &&
      typeof ExcedentesRepository.clearCache === "function"
    ) {
      ExcedentesRepository.clearCache();
    }
  }

  // ==========================================================================
  // API PÚBLICA
  // ==========================================================================

  /**
   * Devuelve los datos necesarios para inicializar la vista.
   *
   * @return {{codigos:Array<string>, mapaCatalogo:Object}}
   */
  /**
   * Devuelve los datos iniciales de la vista.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function getBootstrap() {
    _assertDependencies_();
    return {
      codigos: _buildCodigos_(),
      mapaCatalogo: _buildMapaCatalogo_()
    };
  }

  /**
   * Busca un producto por código.
   *
   * @param {*} codigo Código solicitado.
   * @return {Object}
   */
  /**
   * Busca un producto por código.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function buscarProductoPorCodigo(codigo) {
    _assertDependencies_();
    const codigoNormalizado = toStrUpper_(codigo);

    if (!codigoNormalizado) {
      return { encontrado: false };
    }

    const producto = CatalogoRepository.getPorCodigo(codigoNormalizado)[0];

    if (!producto) {
      return { encontrado: false };
    }

    return {
      encontrado: true,
      codigo: codigoNormalizado,
      id: toStr_(producto.idproducto),
      idproducto: toStr_(producto.idproducto),
      descripcion: toStrUpper_(producto.descripcion),
      status: toStrUpper_(producto.status)
    };
  }

  /**
   * Valida, registra y prepara la impresión de un lote de excedentes.
   *
   * El responsable se recibe en cada elemento porque la vista lo incorpora al
   * contrato antes de imprimir. El Service exige que sea obligatorio y uniforme
   * en todo el lote, sin validar su rol.
   *
   * @param {Array<Object>} lote Etiquetas solicitadas.
   * @return {{
   *   ok:boolean,
   *   modoCompatible:Array<string>,
   *   htmlImpresion:string,
   *   printJob:Object,
   *   total:number,
   *   responsableImpresion:string
   * }}
   */
  /**
   * Valida, registra y prepara la impresión del lote.
   *
   * @return {*} Resultado de la operación.
   * @public
   */
  function procesarLote(lote) {
    _assertDependencies_();
    if (!Array.isArray(lote) || lote.length === 0) {
      throw new Error("El lote de etiquetas de excedentes está vacío.");
    }

    if (lote.length > DOMAIN.MAX_BATCH_ITEMS) {
      throw new Error(
        `El lote supera el máximo de ${DOMAIN.MAX_BATCH_ITEMS} etiquetas.`
      );
    }
    if (!lote.every(function(item) {
      return item && typeof item === "object" && !Array.isArray(item);
    })) {
      throw new Error("El lote contiene elementos inválidos.");
    }

    _validarIdsUnicosDelLote_(lote);

    const responsableImpresion = _resolverResponsableDelLote_(lote);
    const lock = LockService.getScriptLock();
    let locked = false;

    try {
      lock.waitLock(DOMAIN.LOCK_TIMEOUT_MS);
      locked = true;

      const spreadsheet = getSpreadsheetByFileKey_(
        _getExcedentesFileKey_()
      );
      const sheet = getSheetByKey_(DOMAIN.SHEET_KEY);
      if (
        !sheet ||
        typeof sheet.getLastRow !== "function" ||
        typeof sheet.getRange !== "function"
      ) {
        throw new Error("No se obtuvo una hoja válida para BD-EXCEDENTES.");
      }
      const temporal = _obtenerContextoTemporal_(spreadsheet);
      const mapaCatalogo = _buildMapaCatalogo_();
      const fechaHora = temporal.fecha + " " + temporal.hora;

      const rows = lote.map(function(item) {
        return _mapExcedenteToRow_(
          item,
          temporal,
          mapaCatalogo,
          responsableImpresion
        );
      });

      const expectedWidth = COL.EXCEDENTES.RESPONSABLEIMPRESION + 1;

      if (expectedWidth !== 9) {
        throw new Error(
          "El contrato de BD-EXCEDENTES debe contener nueve columnas."
        );
      }

      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, expectedWidth).setValues(rows);
      SpreadsheetApp.flush();

      _clearOperationalCaches_();

      const loteImpresion = lote.map(function(item) {
        return _mapPrintItem_(
          item,
          mapaCatalogo,
          responsableImpresion
        );
      });

      const htmlImpresion = _renderEtiquetaExcedentes_(
        loteImpresion,
        fechaHora,
        DOMAIN.MODO_LOCAL,
        responsableImpresion
      );

      const htmlOnline = _prepararHtmlOnline_(
        _renderEtiquetaExcedentes_(
          loteImpresion,
          fechaHora,
          DOMAIN.MODO_ONLINE,
          responsableImpresion
        )
      );

      const printJob = {
        tipo: DOMAIN.TIPO_IMPRESION,
        origen: DOMAIN.MODULO,
        formato: DOMAIN.FORMATO,
        html: htmlOnline,
        content: htmlOnline,
        meta: {
          modulo: DOMAIN.MODULO,
          total: loteImpresion.length,
          fechaHora: fechaHora,
          etiqueta: DOMAIN.ETIQUETA,
          formatoEtiqueta: DOMAIN.FORMATO,
          papel: DOMAIN.PAPEL,
          responsableImpresion: responsableImpresion
        }
      };

      return {
        ok: true,
        modoCompatible: [DOMAIN.MODO_LOCAL, DOMAIN.MODO_ONLINE],
        htmlImpresion: htmlImpresion,
        printJob: printJob,
        total: loteImpresion.length,
        responsableImpresion: responsableImpresion
      };
    } catch (error) {
      throw new Error(
        "No se pudo procesar el lote de etiquetas de excedentes: " +
        (error && error.message ? error.message : String(error))
      );
    } finally {
      if (locked) {
        lock.releaseLock();
      }
    }
  }

  return Object.freeze({
    getBootstrap,
    buscarProductoPorCodigo,
    procesarLote
  });
})();
