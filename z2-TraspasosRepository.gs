/**
 * z2-TraspasosRepository
 *
 * @fileoverview Repositorio de lectura y actualización administrativa para la
 * bitácora lógica Bitacora-TRASPASOS.
 *
 * Centraliza la validación del contrato de columnas, la normalización de
 * movimientos históricos, las consultas cacheadas, las lecturas frescas para
 * procesos críticos y la escritura controlada de datos de conciliación.
 * Conserva los nombres de propiedades consumidos por servicios existentes y el
 * número físico de fila mediante la propiedad `fila`.
 *
 * Responsabilidades:
 * - Leer y normalizar movimientos históricos de traspaso.
 * - Exponer lecturas cacheadas y lecturas frescas para procesos críticos.
 * - Consultar por fecha, hora, movimiento, ubicación, producto y responsable.
 * - Escribir folio, responsable, fecha y hora de respuesta por bloques.
 * - Mantener compatibilidad con FECHARESPUESTA y HORARESPUESTA.
 * - Conservar la API legacy relacionada con IDOPERACION.
 *
 * Dependencias globales:
 * - getSheetByKey_(sourceKey).
 * - COL.TRASPASOS.
 * - toStr_(value), toStrUpper_(value), toNum_(value) y toDate_(value).
 * - formatDate_(date), formatTime_(time), sameDate_(left, right) y
 *   sameTime_(left, right).
 * - Servicios de Spreadsheet de Google Apps Script.
 *
 * Reglas de escritura:
 * - FOLIO y RESPONSABLE se escriben exclusivamente en columnas contiguas M:N.
 * - IDUNICO permanece intacto en la columna O.
 * - FECHARESPUESTA y HORARESPUESTA se escriben exclusivamente en P:Q.
 * - Los métodos de escritura no adquieren LockService ni ejecutan flush().
 * - El servicio llamador debe releer, validar, escribir y confirmar bajo el
 *   mismo ScriptLock para impedir condiciones de carrera.
 * - Una operación admite como máximo 1000 filas físicas normalizadas.
 *
 * Estrategia de lectura:
 * - Las consultas generales utilizan caché durante la ejecución actual.
 * - Las operaciones de conciliación utilizan lecturas frescas.
 * - La API pública devuelve copias defensivas de las lecturas cacheadas.
 * - clearCache() debe invocarse después de cambios realizados por otros módulos
 *   durante la misma ejecución.
 *
 * Compatibilidad:
 * - Se conserva la API pública anterior.
 * - Se conservan las propiedades utilizadas por EstadoActualExcedentesService.
 * - getPorIdOperacion() permanece como compatibilidad legacy; la bitácora actual
 *   no define una columna IDOPERACION y, por ello, normalmente devuelve [].
 *
 * @author Sigifredo de la Cruz Ramos
 */

const TraspasosRepository = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    SOURCE_KEY: "TRASPASOS",
    HEADER_ROW: 1,
    FIRST_DATA_ROW: 2,
    MAX_BATCH_ROWS: 1000,
    LOG_PREFIX: "[TraspasosRepository]",
    PERF_PREFIX: "[APPALMACEN][TRASPASOS_REPOSITORY_PERF]"
  });

  /** @private @const {!Array<string>} */
  const REQUIRED_COLUMNS = Object.freeze([
    "FECHA",
    "HORA",
    "TIPOMOVIMIENTO",
    "SERIE",
    "BODEGA_SALIDA",
    "UBICACION_SALIDA",
    "BODEGA_ENTRADA",
    "UBICACION_ENTRADA",
    "SOLICITANTE",
    "CODIGO",
    "DESCRIPCION",
    "CANTIDAD",
    "FOLIO",
    "RESPONSABLE",
    "IDUNICO",
    "FECHARESPUESTA",
    "HORARESPUESTA"
  ]);

  const HEADER_ROW_ = CFG.HEADER_ROW;
  const FIRST_DATA_ROW_ = CFG.FIRST_DATA_ROW;
  const MAX_BATCH_ROWS_ = CFG.MAX_BATCH_ROWS;

  let cache_ = null;

  // =========================================================
  // HELPERS INTERNOS
  // =========================================================

  /** @return {GoogleAppsScript.Spreadsheet.Sheet} Hoja TRASPASOS. */
  function getSheet_() {
    return getSheetByKey_(CFG.SOURCE_KEY);
  }

  /** Calcula el ancho requerido por el contrato completo de columnas. */
  function getLastRequiredColumn_() {
    return Math.max(
      COL.TRASPASOS.FECHA,
      COL.TRASPASOS.HORA,
      COL.TRASPASOS.TIPOMOVIMIENTO,
      COL.TRASPASOS.SERIE,
      COL.TRASPASOS.BODEGA_SALIDA,
      COL.TRASPASOS.UBICACION_SALIDA,
      COL.TRASPASOS.BODEGA_ENTRADA,
      COL.TRASPASOS.UBICACION_ENTRADA,
      COL.TRASPASOS.SOLICITANTE,
      COL.TRASPASOS.CODIGO,
      COL.TRASPASOS.DESCRIPCION,
      COL.TRASPASOS.CANTIDAD,
      COL.TRASPASOS.FOLIO,
      COL.TRASPASOS.RESPONSABLE,
      COL.TRASPASOS.IDUNICO,
      COL.TRASPASOS.FECHARESPUESTA,
      COL.TRASPASOS.HORARESPUESTA
    ) + 1;
  }

  /**
   * Valida dependencias, índices y contigüidad de columnas administrativas.
   *
   * @return {void}
   * @throws {Error} Si falta una dependencia o el contrato físico es inválido.
   * @private
   */
  function assertConfiguration_() {
    const dependencyStatus = [
      ["getSheetByKey_", typeof getSheetByKey_],
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_],
      ["toDate_", typeof toDate_],
      ["formatDate_", typeof formatDate_],
      ["formatTime_", typeof formatTime_],
      ["sameDate_", typeof sameDate_],
      ["sameTime_", typeof sameTime_]
    ];
    const missingFunctions = dependencyStatus
      .filter(function (dependency) {
        return dependency[1] !== "function";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingFunctions.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan dependencias globales: ` +
          `${missingFunctions.join(", ")}.`
      );
    }

    if (
      typeof COL === "undefined" ||
      !COL ||
      !COL.TRASPASOS ||
      typeof COL.TRASPASOS !== "object"
    ) {
      throw new Error(`${CFG.LOG_PREFIX} No existe COL.TRASPASOS.`);
    }

    const usedIndexes = Object.create(null);
    REQUIRED_COLUMNS.forEach(function (key) {
      const index = COL.TRASPASOS[key];
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(
          `${CFG.LOG_PREFIX} Falta o es inválida COL.TRASPASOS.${key}.`
        );
      }
      if (Object.prototype.hasOwnProperty.call(usedIndexes, index)) {
        throw new Error(
          `${CFG.LOG_PREFIX} Las columnas ${usedIndexes[index]} y ${key} ` +
            `comparten el índice ${index}.`
        );
      }
      usedIndexes[index] = key;
    });

    if (COL.TRASPASOS.FOLIO + 1 !== COL.TRASPASOS.RESPONSABLE) {
      throw new Error(
        `${CFG.LOG_PREFIX} FOLIO y RESPONSABLE deben ser columnas contiguas.`
      );
    }
    if (
      COL.TRASPASOS.FECHARESPUESTA + 1 !==
      COL.TRASPASOS.HORARESPUESTA
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} FECHARESPUESTA y HORARESPUESTA deben ser ` +
          `columnas contiguas.`
      );
    }
  }

  /** Lee toda la fuente sin utilizar la caché local. */
  function readSourceFresh_() {
    assertConfiguration_();

    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow < FIRST_DATA_ROW_) {
      return [];
    }

    return sheet
      .getRange(
        FIRST_DATA_ROW_,
        1,
        lastRow - HEADER_ROW_,
        getLastRequiredColumn_()
      )
      .getValues();
  }

  /**
   * Acepta Date o texto H:mm:ss / HH:mm:ss.
   * Devuelve Date anclado a 1970-01-01 para conservar compatibilidad.
   */
  function normalizeTimeValue_(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (value instanceof Date && !isNaN(value.getTime())) {
      return new Date(
        1970,
        0,
        1,
        value.getHours(),
        value.getMinutes(),
        value.getSeconds()
      );
    }

    const text = toStr_(value);
    const match = text.match(
      /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
    );

    if (!match) {
      return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);

    if (
      hours > 23 ||
      minutes > 59 ||
      seconds > 59
    ) {
      return null;
    }

    return new Date(
      1970,
      0,
      1,
      hours,
      minutes,
      seconds
    );
  }

  /** Completa valores numéricos de un dígito con cero inicial. */
  function pad2Fast_(
    value
  ) {
    const number =
      Number(
        value || 0
      );

    return number < 10
      ? "0" + number
      : String(number);
  }

  /** Formatea fechas válidas como dd/MM/yyyy sin utilidades externas. */
  function formatDateFast_(
    value
  ) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return "";
    }

    if (
      value instanceof Date &&
      !isNaN(
        value.getTime()
      )
    ) {
      return (
        pad2Fast_(
          value.getDate()
        ) +
        "/" +
        pad2Fast_(
          value.getMonth() + 1
        ) +
        "/" +
        value.getFullYear()
      );
    }

    const text =
      String(
        value
      ).trim();

    const match =
      text.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
      );

    if (
      !match
    ) {
      return "";
    }

    const day =
      Number(
        match[1]
      );

    const month =
      Number(
        match[2]
      );

    const year =
      Number(
        match[3]
      );

    const date =
      new Date(
        year,
        month - 1,
        day
      );

    if (
      isNaN(
        date.getTime()
      ) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return "";
    }

    return (
      pad2Fast_(
        day
      ) +
      "/" +
      pad2Fast_(
        month
      ) +
      "/" +
      year
    );
  }

  /** Formatea horas válidas como HH:mm:ss. */
  function formatTimeFast_(
    value
  ) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return "";
    }

    if (
      value instanceof Date &&
      !isNaN(
        value.getTime()
      )
    ) {
      return (
        pad2Fast_(
          value.getHours()
        ) +
        ":" +
        pad2Fast_(
          value.getMinutes()
        ) +
        ":" +
        pad2Fast_(
          value.getSeconds()
        )
      );
    }

    const text =
      String(
        value
      ).trim();

    const match =
      text.match(
        /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
      );

    if (
      !match
    ) {
      return "";
    }

    const hours =
      Number(
        match[1]
      );

    const minutes =
      Number(
        match[2]
      );

    const seconds =
      Number(
        match[3] || 0
      );

    if (
      hours > 23 ||
      minutes > 59 ||
      seconds > 59
    ) {
      return "";
    }

    return (
      pad2Fast_(
        hours
      ) +
      ":" +
      pad2Fast_(
        minutes
      ) +
      ":" +
      pad2Fast_(
        seconds
      )
    );
  }

  /** Normaliza y formatea un valor de fecha administrativa. */
  function formatDateValue_(value) {
    const date = toDate_(value);
    return date ? formatDate_(date) : "";
  }

  /** Normaliza y formatea un valor de hora administrativa. */
  function formatTimeValue_(value) {
    const time = normalizeTimeValue_(value);
    return time ? formatTime_(time) : "";
  }

  /** Normaliza una fila completa conservando compatibilidad histórica. */
  function normalize_(fila, filaReal) {
    if (!Array.isArray(fila)) {
      throw new TypeError(
        `${CFG.LOG_PREFIX} La fila física ${filaReal} tiene un formato inválido.`
      );
    }
    const fechaTraspasoRaw = fila[COL.TRASPASOS.FECHA];
    const horaTraspasoRaw = fila[COL.TRASPASOS.HORA];
    const fechaRespuestaRaw =
      fila[COL.TRASPASOS.FECHARESPUESTA];
    const horaRespuestaRaw =
      fila[COL.TRASPASOS.HORARESPUESTA];

    const fechaTraspaso = toDate_(fechaTraspasoRaw);
    const horaTraspaso = normalizeTimeValue_(horaTraspasoRaw);
    const fechaRespuesta = toDate_(fechaRespuestaRaw);
    const horaRespuesta = normalizeTimeValue_(horaRespuestaRaw);

    return {
      // Número real de fila en Google Sheets.
      fila: filaReal,

      // Campos existentes. No renombrar.
      fechatraspaso: fechaTraspaso,
      horatraspaso: horaTraspaso,
      tipomovimiento: toStrUpper_(
        fila[COL.TRASPASOS.TIPOMOVIMIENTO] || ""
      ),
      serie: toStrUpper_(
        fila[COL.TRASPASOS.SERIE] || ""
      ),
      bodegasalida: toStrUpper_(
        fila[COL.TRASPASOS.BODEGA_SALIDA] || ""
      ),
      ubicacionsalida: toStrUpper_(
        fila[COL.TRASPASOS.UBICACION_SALIDA] || ""
      ),
      bodegaentrada: toStrUpper_(
        fila[COL.TRASPASOS.BODEGA_ENTRADA] || ""
      ),
      ubicacionentrada: toStrUpper_(
        fila[COL.TRASPASOS.UBICACION_ENTRADA] || ""
      ),
      solicitante: toStrUpper_(
        fila[COL.TRASPASOS.SOLICITANTE] || ""
      ),
      codigo: toStrUpper_(
        fila[COL.TRASPASOS.CODIGO] || ""
      ),
      descripcion: toStrUpper_(
        fila[COL.TRASPASOS.DESCRIPCION] || ""
      ),
      cantidad: toNum_(
        fila[COL.TRASPASOS.CANTIDAD] || ""
      ),
      folio: toStr_(
        fila[COL.TRASPASOS.FOLIO] || ""
      ),
      responsable: toStrUpper_(
        fila[COL.TRASPASOS.RESPONSABLE] || ""
      ),
      idunico: toStr_(
        fila[COL.TRASPASOS.IDUNICO] || ""
      ),

      // Nuevas columnas administrativas.
      fecharespuesta: fechaRespuesta,
      horarespuesta: horaRespuesta,

      // Valores listos para claves, respuestas JSON y vistas.
      fechatraspasoTexto:
        fechaTraspaso ? formatDate_(fechaTraspaso) : "",
      horatraspasoTexto:
        horaTraspaso ? formatTime_(horaTraspaso) : "",
      fecharespuestaTexto:
        fechaRespuesta ? formatDate_(fechaRespuesta) : "",
      horarespuestaTexto:
        horaRespuesta ? formatTime_(horaRespuesta) : "",

      // Valores crudos útiles para diagnóstico controlado.
      fechatraspasoRaw: fechaTraspasoRaw,
      horatraspasoRaw: horaTraspasoRaw,
      fecharespuestaRaw: fechaRespuestaRaw,
      horarespuestaRaw: horaRespuestaRaw
    };
  }

  /** Normaliza únicamente campos requeridos por el estado operativo. */
  function normalizeForEstado_(fila, filaReal) {
    return {
      fila: filaReal,
      fechatraspaso: fila[COL.TRASPASOS.FECHA] instanceof Date
        ? fila[COL.TRASPASOS.FECHA]
        : toDate_(fila[COL.TRASPASOS.FECHA]),
      horatraspaso: fila[COL.TRASPASOS.HORA] instanceof Date
        ? fila[COL.TRASPASOS.HORA]
        : normalizeTimeValue_(fila[COL.TRASPASOS.HORA]),
      tipomovimiento: toStrUpper_(
        fila[COL.TRASPASOS.TIPOMOVIMIENTO] || ""
      ),
      serie: toStrUpper_(fila[COL.TRASPASOS.SERIE] || ""),
      bodegasalida: toStrUpper_(
        fila[COL.TRASPASOS.BODEGA_SALIDA] || ""
      ),
      ubicacionsalida: toStrUpper_(
        fila[COL.TRASPASOS.UBICACION_SALIDA] || ""
      ),
      bodegaentrada: toStrUpper_(
        fila[COL.TRASPASOS.BODEGA_ENTRADA] || ""
      ),
      ubicacionentrada: toStrUpper_(
        fila[COL.TRASPASOS.UBICACION_ENTRADA] || ""
      ),
      codigo: toStrUpper_(fila[COL.TRASPASOS.CODIGO] || ""),
      descripcion: toStrUpper_(
        fila[COL.TRASPASOS.DESCRIPCION] || ""
      ),
      cantidad: toNum_(fila[COL.TRASPASOS.CANTIDAD] || 0),
      folio: toStr_(fila[COL.TRASPASOS.FOLIO] || ""),
      idunico: toStr_(fila[COL.TRASPASOS.IDUNICO] || "")
    };
  }

  /** Normaliza una fila para conciliación sin crear objetos Date innecesarios. */
  function normalizeForConciliacion_(
    fila,
    filaReal
  ) {
    const fechaTraspasoRaw =
      fila[
        COL.TRASPASOS.FECHA
      ];

    const horaTraspasoRaw =
      fila[
        COL.TRASPASOS.HORA
      ];

    const fechaRespuestaRaw =
      fila[
        COL.TRASPASOS.FECHARESPUESTA
      ];

    const horaRespuestaRaw =
      fila[
        COL.TRASPASOS.HORARESPUESTA
      ];

    return {
      fila:
        filaReal,

      fechatraspasoTexto:
        formatDateFast_(
          fechaTraspasoRaw
        ),

      horatraspasoTexto:
        formatTimeFast_(
          horaTraspasoRaw
        ),

      tipomovimiento:
        toStrUpper_(
          fila[
            COL.TRASPASOS
              .TIPOMOVIMIENTO
          ] || ""
        ),

      serie:
        toStrUpper_(
          fila[
            COL.TRASPASOS.SERIE
          ] || ""
        ),

      bodegasalida:
        toStrUpper_(
          fila[
            COL.TRASPASOS
              .BODEGA_SALIDA
          ] || ""
        ),

      ubicacionsalida:
        toStrUpper_(
          fila[
            COL.TRASPASOS
              .UBICACION_SALIDA
          ] || ""
        ),

      bodegaentrada:
        toStrUpper_(
          fila[
            COL.TRASPASOS
              .BODEGA_ENTRADA
          ] || ""
        ),

      ubicacionentrada:
        toStrUpper_(
          fila[
            COL.TRASPASOS
              .UBICACION_ENTRADA
          ] || ""
        ),

      solicitante:
        toStrUpper_(
          fila[
            COL.TRASPASOS
              .SOLICITANTE
          ] || ""
        ),

      codigo:
        toStrUpper_(
          fila[
            COL.TRASPASOS.CODIGO
          ] || ""
        ),

      descripcion:
        toStrUpper_(
          fila[
            COL.TRASPASOS
              .DESCRIPCION
          ] || ""
        ),

      cantidad:
        toNum_(
          fila[
            COL.TRASPASOS.CANTIDAD
          ] || 0
        ),

      folio:
        toStr_(
          fila[
            COL.TRASPASOS.FOLIO
          ] || ""
        ),

      responsable:
        toStrUpper_(
          fila[
            COL.TRASPASOS
              .RESPONSABLE
          ] || ""
        ),

      idunico:
        toStr_(
          fila[
            COL.TRASPASOS.IDUNICO
          ] || ""
        ),

      fecharespuestaTexto:
        formatDateFast_(
          fechaRespuestaRaw
        ),

      horarespuestaTexto:
        formatTimeFast_(
          horaRespuestaRaw
        )
    };
  }

  /** Lee movimientos vigentes para construir el estado de excedentes. */
  function readForEstadoFresh_() {
    assertConfiguration_();

    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow < FIRST_DATA_ROW_) {
      return [];
    }

    const width = COL.TRASPASOS.IDUNICO + 1;
    const values = sheet
      .getRange(
        FIRST_DATA_ROW_,
        1,
        lastRow - HEADER_ROW_,
        width
      )
      .getValues();

    const result = [];

    for (let index = 0; index < values.length; index++) {
      const item = normalizeForEstado_(
        values[index],
        FIRST_DATA_ROW_ + index
      );

      if (item.idunico) {
        result.push(item);
      }
    }

    return result;
  }

  /** Lee y mide el dataset completo utilizado por conciliación. */
  function getAllForConciliacionFresh_() {
    assertConfiguration_();

    const totalStartedAt =
      Date.now();

    const sheet =
      getSheet_();

    const lastRowStartedAt =
      Date.now();

    const lastRow =
      sheet.getLastRow();

    const lastRowMs =
      Date.now() -
      lastRowStartedAt;

    if (
      lastRow <
      FIRST_DATA_ROW_
    ) {
      console.log(
        CFG.PERF_PREFIX + " " +
        JSON.stringify({
          operation:
            "GET_ALL_FOR_CONCILIACION_FRESH",

          totalMs:
            Date.now() -
            totalStartedAt,

          lastRowMs:
            lastRowMs,

          readMs:
            0,

          normalizeMs:
            0,

          sourceRows:
            0,

          resultRows:
            0
        })
      );

      return [];
    }

    const sourceRows =
      lastRow -
      HEADER_ROW_;

    const width =
      getLastRequiredColumn_();

    const readStartedAt =
      Date.now();

    const values =
      sheet
        .getRange(
          FIRST_DATA_ROW_,
          1,
          sourceRows,
          width
        )
        .getValues();

    const readMs =
      Date.now() -
      readStartedAt;

    const normalizeStartedAt =
      Date.now();

    const result =
      [];

    for (
      let index = 0;
      index < values.length;
      index++
    ) {
      const item =
        normalizeForConciliacion_(
          values[index],
          FIRST_DATA_ROW_ +
            index
        );

      if (
        item.codigo ||
        item.idunico ||
        item.serie ||
        item.tipomovimiento
      ) {
        result.push(
          item
        );
      }
    }

    const normalizeMs =
      Date.now() -
      normalizeStartedAt;

    console.log(
      CFG.PERF_PREFIX + " " +
      JSON.stringify({
        operation:
          "GET_ALL_FOR_CONCILIACION_FRESH",

        totalMs:
          Date.now() -
          totalStartedAt,

        lastRowMs:
          lastRowMs,

        readMs:
          readMs,

        normalizeMs:
          normalizeMs,

        sourceRows:
          values.length,

        resultRows:
          result.length,

        width:
          width
      })
    );

    return result;
  }

  /**
   * Crea una copia defensiva de un movimiento, incluidas sus fechas mutables.
   *
   * @param {!Object} item Movimiento normalizado.
   * @return {!Object} Copia independiente para el consumidor.
   * @private
   */
  function copyItem_(item) {
    const copy = {};
    Object.keys(item).forEach(function (key) {
      const value = item[key];
      copy[key] = value instanceof Date
        ? new Date(value.getTime())
        : value;
    });
    return copy;
  }

  /**
   * Copia una colección normalizada sin exponer referencias internas.
   *
   * @param {!Array<!Object>} items Colección de origen.
   * @return {!Array<!Object>} Copias defensivas.
   * @private
   */
  function copyItems_(items) {
    return items.map(copyItem_);
  }

  /**
   * Filtra la caché y devuelve copias defensivas.
   *
   * @param {function(!Object): boolean} predicate Criterio de selección.
   * @return {!Array<!Object>} Coincidencias independientes.
   * @private
   */
  function filterCached_(predicate) {
    return getData_().filter(predicate).map(copyItem_);
  }

  /** Determina si una fila contiene información operativa. */
  function isDataRow_(item) {
    return Boolean(
      item.codigo ||
      item.idunico ||
      item.serie ||
      item.tipomovimiento
    );
  }

  /** Normaliza filas y descarta registros completamente vacíos. */
  function mapRows_(rows, firstRowNumber) {
    return (rows || [])
      .map(function (row, index) {
        return normalize_(row, firstRowNumber + index);
      })
      .filter(isDataRow_);
  }

  /** Obtiene movimientos normalizados desde caché o fuente física. */
  function getData_() {
    if (cache_ === null) {
      cache_ = mapRows_(
        readSourceFresh_(),
        FIRST_DATA_ROW_
      );

      console.log(
        `${CFG.LOG_PREFIX} Caché cargada`,
        { total: cache_.length }
      );
    }

    return cache_;
  }

  /** Proyecta una propiedad de todos los movimientos cacheados. */
  function getField_(field) {
    const allowedFields = Object.freeze([
      "serie",
      "bodegasalida",
      "ubicacionsalida",
      "bodegaentrada",
      "ubicacionentrada",
      "solicitante",
      "codigo",
      "folio",
      "responsable",
      "idunico",
      "fecharespuesta",
      "horarespuesta"
    ]);
    if (!allowedFields.includes(field)) {
      throw new Error(
        `${CFG.LOG_PREFIX} La proyección "${field}" no está permitida.`
      );
    }
    return getData_().map(function (item) {
      const value = item[field];
      return value instanceof Date ? new Date(value.getTime()) : value;
    });
  }

  /** Construye una marca temporal comparable de fecha y hora. */
  function timestamp_(item) {
    const fecha = item.fechatraspaso instanceof Date
      ? item.fechatraspaso.getTime()
      : 0;

    const hora = item.horatraspaso instanceof Date
      ? (
          item.horatraspaso.getHours() * 3600000 +
          item.horatraspaso.getMinutes() * 60000 +
          item.horatraspaso.getSeconds() * 1000
        )
      : 0;

    return fecha + hora;
  }

  /** Normaliza, deduplica, ordena y limita números de fila. */
  function normalizeRowNumbers_(filas) {
    const values = Array.isArray(filas) ? filas : [];

    const unique = Array.from(
      new Set(
        values
          .map(function (value) {
            return Math.floor(Number(value));
          })
          .filter(function (value) {
            return (
              Number.isFinite(value) &&
              value >= FIRST_DATA_ROW_
            );
          })
      )
    ).sort(function (a, b) {
      return a - b;
    });

    if (unique.length > MAX_BATCH_ROWS_) {
      throw new Error(
        "La operación excede el límite de " +
        MAX_BATCH_ROWS_ +
        " filas."
      );
    }

    return unique;
  }

  /** Agrupa filas consecutivas para reducir operaciones de escritura. */
  function buildContiguousBlocks_(rowNumbers) {
    const rows = normalizeRowNumbers_(rowNumbers);
    const blocks = [];

    rows.forEach(function (rowNumber) {
      const last = blocks[blocks.length - 1];

      if (
        last &&
        rowNumber === last.endRow + 1
      ) {
        last.endRow = rowNumber;
        last.rowNumbers.push(rowNumber);
        return;
      }

      blocks.push({
        startRow: rowNumber,
        endRow: rowNumber,
        rowNumbers: [rowNumber]
      });
    });

    return blocks;
  }

  /** Valida y normaliza folio, responsable, fecha y hora de respuesta. */
  function validateAdministrativeData_(data) {
    const payload = data || {};
    const folio = toStr_(payload.folio);
    const responsable = toStrUpper_(payload.responsable);
    const fechaRespuesta = formatDateValue_(
      payload.fecharespuesta != null
        ? payload.fecharespuesta
        : payload.fechaRespuesta
    );
    const horaRespuesta = formatTimeValue_(
      payload.horarespuesta != null
        ? payload.horarespuesta
        : payload.horaRespuesta
    );

    if (!folio) {
      throw new Error("El folio es obligatorio.");
    }

    if (!responsable) {
      throw new Error("El responsable es obligatorio.");
    }

    if (!fechaRespuesta) {
      throw new Error(
        "La fecha de respuesta es inválida."
      );
    }

    if (!horaRespuesta) {
      throw new Error(
        "La hora de respuesta es inválida."
      );
    }

    return {
      folio: folio,
      responsable: responsable,
      fecharespuesta: fechaRespuesta,
      horarespuesta: horaRespuesta
    };
  }

  // =========================================================
  // LECTURAS FRESCAS PARA CONCILIACIÓN
  // =========================================================

  /**
   * Lee toda la hoja sin utilizar cache_.
   * @return {Array<Object>} Movimientos normalizados en orden físico.
   */
  function getAllFresh_() {
    return mapRows_(
      readSourceFresh_(),
      FIRST_DATA_ROW_
    );
  }

  /**
   * Lee filas concretas sin utilizar cache_.
   * Debe usarse dentro del mismo ScriptLock de la escritura.
   * @param {Array<*>} filas Números de fila solicitados.
   * @return {Array<Object>} Filas válidas en orden ascendente.
   */
  function getByFilasFresh_(filas) {
    assertConfiguration_();

    const requested = normalizeRowNumbers_(filas);

    if (!requested.length) {
      return [];
    }

    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    const validRows = requested.filter(function (rowNumber) {
      return rowNumber <= lastRow;
    });

    if (!validRows.length) {
      return [];
    }

    const blocks = buildContiguousBlocks_(validRows);
    const output = [];
    const width = getLastRequiredColumn_();

    blocks.forEach(function (block) {
      const values = sheet
        .getRange(
          block.startRow,
          1,
          block.rowNumbers.length,
          width
        )
        .getValues();

      values.forEach(function (row, index) {
        const item =
          normalizeForConciliacion_(
            row,
            block.startRow + index
          );

        if (isDataRow_(item)) {
          output.push(item);
        }
      });
    });

    return output.sort(function (a, b) {
      return Number(a.fila) - Number(b.fila);
    });
  }

  /**
   * Escribe folio, responsable, fecha y hora de respuesta.
   *
   * @param {Array<*>} filas Filas físicas por actualizar.
   * @param {Object} data Datos administrativos validados.
   * @return {Object} Resumen de actualización.
   *
   * IMPORTANTE:
   * - No adquiere LockService.
   * - No vuelve a validar si la fila está pendiente.
   * - El service debe releer y validar las filas dentro del candado.
   * - Nunca escribe la columna IDUNICO.
   */
  function updateConciliacionByFilas_(filas, data) {
    assertConfiguration_();

    const requested = normalizeRowNumbers_(filas);

    if (!requested.length) {
      return {
        ok: true,
        actualizados: 0,
        filas: []
      };
    }

    const payload = validateAdministrativeData_(data);
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    const validRows = requested.filter(function (rowNumber) {
      return rowNumber <= lastRow;
    });

    if (validRows.length !== requested.length) {
      const missing = requested.filter(function (rowNumber) {
        return rowNumber > lastRow;
      });

      throw new Error(
        "No existen las filas solicitadas: " +
        missing.join(", ") + "."
      );
    }

    const blocks = buildContiguousBlocks_(validRows);

    blocks.forEach(function (block) {
      const length = block.rowNumbers.length;

      const folioResponsableValues = Array.from(
        { length: length },
        function () {
          return [
            payload.folio,
            payload.responsable
          ];
        }
      );

      const respuestaValues = Array.from(
        { length: length },
        function () {
          return [
            payload.fecharespuesta,
            payload.horarespuesta
          ];
        }
      );

      // M:N. No toca IDUNICO en O.
      sheet
        .getRange(
          block.startRow,
          COL.TRASPASOS.FOLIO + 1,
          length,
          2
        )
        .setValues(folioResponsableValues);

      // P:Q.
      sheet
        .getRange(
          block.startRow,
          COL.TRASPASOS.FECHARESPUESTA + 1,
          length,
          2
        )
        .setValues(respuestaValues);
    });

    cache_ = null;

    console.log(
      "[TRASPASOS] Conciliación escrita",
      JSON.stringify({
        actualizados: validRows.length,
        filas: validRows,
        folio: payload.folio,
        responsable: payload.responsable,
        fecharespuesta: payload.fecharespuesta,
        horarespuesta: payload.horarespuesta
      })
    );

    return {
      ok: true,
      actualizados: validRows.length,
      filas: validRows,
      folio: payload.folio,
      responsable: payload.responsable,
      fecharespuesta: payload.fecharespuesta,
      horarespuesta: payload.horarespuesta
    };
  }

  // =========================================================
  // API PÚBLICA
  // =========================================================

  return Object.freeze({
    // API existente.
    /** Devuelve movimientos ordenados por código. */
    getAll: function () {
      return copyItems_(getData_()).sort(function (a, b) {
        return a.codigo.localeCompare(
          b.codigo,
          "es",
          {
            numeric: true,
            sensitivity: "base"
          }
        );
      });
    },

    /** Devuelve una copia en el orden de la caché. */
    getAllRaw: function () {
      return copyItems_(getData_());
    },

    /** Devuelve una lectura fresca optimizada para estado operativo. */
    getAllForEstado: function () {
      return readForEstadoFresh_();
    },

    /** Ordena cronológicamente y desempata por fila física. */
    getAllByFechaHora: function () {
      return copyItems_(getData_()).sort(function (a, b) {
        return (
          timestamp_(a) - timestamp_(b) ||
          Number(a.fila || 0) - Number(b.fila || 0)
        );
      });
    },

    /** Devuelve los últimos registros físicos hasta el límite indicado. */
    getUltimos: function (limit) {
      const safeLimit = Math.max(
        0,
        Math.floor(Number(limit) || 0)
      );

      if (!safeLimit) {
        return [];
      }
      return copyItems_(getData_().slice(-safeLimit));
    },

    getPorFecha: function (fechatraspaso) {
      return filterCached_(function (item) {
        return sameDate_(
          item.fechatraspaso,
          fechatraspaso
        );
      });
    },

    getPorHora: function (horatraspaso) {
      return filterCached_(function (item) {
        return sameTime_(
          item.horatraspaso,
          horatraspaso
        );
      });
    },

    getPorTipoMovimiento: function (tipomovimiento) {
      const filter = toStrUpper_(tipomovimiento || "");
      return filterCached_(function (item) {
        return item.tipomovimiento === filter;
      });
    },

    getPorSerie: function (serie) {
      const filter = toStrUpper_(serie || "");
      return filterCached_(function (item) {
        return item.serie === filter;
      });
    },

    getPorBodegaSalida: function (bodegasalida) {
      const filter = toStrUpper_(bodegasalida || "");
      return filterCached_(function (item) {
        return item.bodegasalida === filter;
      });
    },

    getPorUbicacionSalida: function (ubicacionsalida) {
      const filter = toStrUpper_(ubicacionsalida || "");
      return filterCached_(function (item) {
        return item.ubicacionsalida === filter;
      });
    },

    getPorBodegaEntrada: function (bodegaentrada) {
      const filter = toStrUpper_(bodegaentrada || "");
      return filterCached_(function (item) {
        return item.bodegaentrada === filter;
      });
    },

    getPorUbicacionEntrada: function (ubicacionentrada) {
      const filter = toStrUpper_(ubicacionentrada || "");
      return filterCached_(function (item) {
        return item.ubicacionentrada === filter;
      });
    },

    getPorSolicitante: function (solicitante) {
      const filter = toStrUpper_(solicitante || "");
      return filterCached_(function (item) {
        return item.solicitante === filter;
      });
    },

    getPorCodigo: function (codigo) {
      const filter = toStrUpper_(codigo || "");
      return filterCached_(function (item) {
        return item.codigo === filter;
      });
    },

    getPorDescripcion: function (descripcion) {
      const filter = toStrUpper_(descripcion || "");
      return filterCached_(function (item) {
        return item.descripcion === filter;
      });
    },

    getPorFolio: function (folio) {
      const filter = toStr_(folio || "");
      return filterCached_(function (item) {
        return item.folio === filter;
      });
    },

    /**
     * Compatibilidad legacy.
     * Bitacora-TRASPASOS no contiene actualmente una columna
     * IDOPERACION, por lo que este método normalmente devuelve [].
     */
    getPorIdOperacion: function (idOperacion) {
      const filter = toStr_(idOperacion || "");
      if (!filter) return [];

      return filterCached_(function (item) {
        return toStr_(item.idoperacion || "") === filter;
      });
    },

    existeIdOperacion: function (idOperacion) {
      return this.getPorIdOperacion(idOperacion).length > 0;
    },

    getIdsOperacionAplicados: function () {
      return new Set(
        getData_()
          .map(function (item) {
            return toStr_(item.idoperacion || "");
          })
          .filter(Boolean)
      );
    },

    getPorResponsable: function (responsable) {
      const filter = toStrUpper_(responsable || "");
      return filterCached_(function (item) {
        return item.responsable === filter;
      });
    },

    getPorIdUnico: function (idunico) {
      const filter = toStr_(idunico || "");
      return filterCached_(function (item) {
        return item.idunico === filter;
      });
    },

    getPorFechaRespuesta: function (fecharespuesta) {
      return filterCached_(function (item) {
        return sameDate_(
          item.fecharespuesta,
          fecharespuesta
        );
      });
    },

    getPorHoraRespuesta: function (horarespuesta) {
      return filterCached_(function (item) {
        return sameTime_(
          item.horarespuesta,
          horarespuesta
        );
      });
    },

    getSeries: function () {
      return getField_("serie");
    },

    getBodegasSalida: function () {
      return getField_("bodegasalida");
    },

    getUbicacionesSalida: function () {
      return getField_("ubicacionsalida");
    },

    getBodegasEntrada: function () {
      return getField_("bodegaentrada");
    },

    getUbicacionesEntrada: function () {
      return getField_("ubicacionentrada");
    },

    getSolicitantes: function () {
      return getField_("solicitante");
    },

    getCodigos: function () {
      return getField_("codigo");
    },

    getFolios: function () {
      return getField_("folio");
    },

    getResponsables: function () {
      return getField_("responsable");
    },

    getIdUnicos: function () {
      return getField_("idunico");
    },

    getFechasRespuesta: function () {
      return getField_("fecharespuesta");
    },

    getHorasRespuesta: function () {
      return getField_("horarespuesta");
    },

    // API nueva para Conciliación de saldo.
    /** Devuelve toda la hoja sin utilizar la caché. */
    getAllFresh: function () {
      return getAllFresh_();
    },

    getAllForConciliacionFresh:
      function() {
        return getAllForConciliacionFresh_();
    },

    /** Devuelve filas específicas sin utilizar la caché. */
    getByFilasFresh: function (filas) {
      return getByFilasFresh_(filas);
    },

    /** Escribe conciliación; el Service debe sostener el ScriptLock. */
    updateConciliacionByFilas: function (filas, data) {
      return updateConciliacionByFilas_(filas, data);
    },

    /** Invalida la caché local del repositorio. */
    clearCache: function () {
      cache_ = null;
      console.log(`${CFG.LOG_PREFIX} Caché invalidada.`);
      return true;
    }
  });
})();
