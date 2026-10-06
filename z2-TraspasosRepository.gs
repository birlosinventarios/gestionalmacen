/**
 * TraspasosRepository.gs
 *
 * Repositorio de lectura y actualización controlada para Bitacora-TRASPASOS.
 *
 * Responsabilidades:
 * - Leer y normalizar movimientos históricos de traspaso.
 * - Conservar los nombres de propiedades consumidos por servicios existentes.
 * - Exponer lecturas cacheadas y lecturas frescas para procesos críticos.
 * - Soportar consultas por fecha, hora, tipo, ubicación, producto, folio,
 *   responsable e IdUnico.
 * - Escribir datos administrativos de conciliación sin modificar IdUnico.
 * - Mantener compatibilidad con FECHARESPUESTA y HORARESPUESTA.
 *
 * Reglas de escritura:
 * - FOLIO y RESPONSABLE se escriben exclusivamente en M:N.
 * - IDUNICO permanece intacto en O.
 * - FECHARESPUESTA y HORARESPUESTA se escriben exclusivamente en P:Q.
 * - Los métodos de escritura no adquieren LockService.
 * - El Service llamador debe releer, validar y escribir bajo el mismo
 *   ScriptLock para evitar condiciones de carrera.
 * - Una operación admite como máximo 1000 filas normalizadas.
 *
 * Estrategia de lectura:
 * - Las consultas generales utilizan caché durante la ejecución actual.
 * - Las operaciones de conciliación utilizan lecturas frescas.
 * - Las filas conservan su número físico en la propiedad fila.
 *
 * Compatibilidad:
 * - Se conserva la API pública anterior.
 * - Se conservan las propiedades utilizadas por EstadoActualExcedentesService.
 * - getPorIdOperacion() permanece como compatibilidad legacy. La bitácora
 *   actual no contiene una columna IDOPERACION.
 *
 * Dependencias:
 * - getSheetByKey_(), COL.TRASPASOS.
 * - toStr_(), toStrUpper_(), toNum_(), toDate_().
 * - formatDate_(), formatTime_(), sameDate_() y sameTime_().
 */
const TraspasosRepository = (() => {
  "use strict";

  const HEADER_ROW_ = 1;
  const FIRST_DATA_ROW_ = HEADER_ROW_ + 1;
  const MAX_BATCH_ROWS_ = 1000;

  let cache_ = null;

  // =========================================================
  // HELPERS INTERNOS
  // =========================================================

  /** @return {GoogleAppsScript.Spreadsheet.Sheet} Hoja TRASPASOS. */
  function getSheet_() {
    return getSheetByKey_("TRASPASOS");
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

  /** Valida índices y contigüidad de columnas administrativas. */
  function assertConfiguration_() {
    if (!COL || !COL.TRASPASOS) {
      throw new Error(
        "No existe la configuración COL.TRASPASOS."
      );
    }

    const required = [
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
    ];

    required.forEach(function (key) {
      if (
        !Object.prototype.hasOwnProperty.call(
          COL.TRASPASOS,
          key
        ) ||
        !Number.isInteger(COL.TRASPASOS[key]) ||
        COL.TRASPASOS[key] < 0
      ) {
        throw new Error(
          "Falta o es inválida COL.TRASPASOS." + key + "."
        );
      }
    });

    if (
      COL.TRASPASOS.FOLIO + 1 !==
      COL.TRASPASOS.RESPONSABLE
    ) {
      throw new Error(
        "FOLIO y RESPONSABLE deben ser columnas contiguas."
      );
    }

    if (
      COL.TRASPASOS.FECHARESPUESTA + 1 !==
      COL.TRASPASOS.HORARESPUESTA
    ) {
      throw new Error(
        "FECHARESPUESTA y HORARESPUESTA deben ser columnas contiguas."
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
        "[APPALMACEN]" +
        "[TRASPASOS_REPOSITORY_PERF] " +
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
      "[APPALMACEN]" +
      "[TRASPASOS_REPOSITORY_PERF] " +
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
        "[CACHE] Traspasos cargados",
        { total: cache_.length }
      );
    }

    return cache_;
  }

  /** Proyecta una propiedad de todos los movimientos cacheados. */
  function getField_(field) {
    return getData_().map(function (item) {
      return item[field];
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

  return {
    // API existente.
    /** Devuelve movimientos ordenados por código. */
    getAll: function () {
      return [...getData_()].sort(function (a, b) {
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
      return [...getData_()];
    },

    /** Devuelve una lectura fresca optimizada para estado operativo. */
    getAllForEstado: function () {
      return readForEstadoFresh_();
    },

    /** Ordena cronológicamente y desempata por fila física. */
    getAllByFechaHora: function () {
      return [...getData_()].sort(function (a, b) {
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

      return [...getData_()].slice(-safeLimit);
    },

    getPorFecha: function (fechatraspaso) {
      return getData_().filter(function (item) {
        return sameDate_(
          item.fechatraspaso,
          fechatraspaso
        );
      });
    },

    getPorHora: function (horatraspaso) {
      return getData_().filter(function (item) {
        return sameTime_(
          item.horatraspaso,
          horatraspaso
        );
      });
    },

    getPorTipoMovimiento: function (tipomovimiento) {
      const filter = toStrUpper_(tipomovimiento || "");
      return getData_().filter(function (item) {
        return item.tipomovimiento === filter;
      });
    },

    getPorSerie: function (serie) {
      const filter = toStrUpper_(serie || "");
      return getData_().filter(function (item) {
        return item.serie === filter;
      });
    },

    getPorBodegaSalida: function (bodegasalida) {
      const filter = toStrUpper_(bodegasalida || "");
      return getData_().filter(function (item) {
        return item.bodegasalida === filter;
      });
    },

    getPorUbicacionSalida: function (ubicacionsalida) {
      const filter = toStrUpper_(ubicacionsalida || "");
      return getData_().filter(function (item) {
        return item.ubicacionsalida === filter;
      });
    },

    getPorBodegaEntrada: function (bodegaentrada) {
      const filter = toStrUpper_(bodegaentrada || "");
      return getData_().filter(function (item) {
        return item.bodegaentrada === filter;
      });
    },

    getPorUbicacionEntrada: function (ubicacionentrada) {
      const filter = toStrUpper_(ubicacionentrada || "");
      return getData_().filter(function (item) {
        return item.ubicacionentrada === filter;
      });
    },

    getPorSolicitante: function (solicitante) {
      const filter = toStrUpper_(solicitante || "");
      return getData_().filter(function (item) {
        return item.solicitante === filter;
      });
    },

    getPorCodigo: function (codigo) {
      const filter = toStrUpper_(codigo || "");
      return getData_().filter(function (item) {
        return item.codigo === filter;
      });
    },

    getPorDescripcion: function (descripcion) {
      const filter = toStrUpper_(descripcion || "");
      return getData_().filter(function (item) {
        return item.descripcion === filter;
      });
    },

    getPorFolio: function (folio) {
      const filter = toStr_(folio || "");
      return getData_().filter(function (item) {
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

      return getData_().filter(function (item) {
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
      return getData_().filter(function (item) {
        return item.responsable === filter;
      });
    },

    getPorIdUnico: function (idunico) {
      const filter = toStr_(idunico || "");
      return getData_().filter(function (item) {
        return item.idunico === filter;
      });
    },

    getPorFechaRespuesta: function (fecharespuesta) {
      return getData_().filter(function (item) {
        return sameDate_(
          item.fecharespuesta,
          fecharespuesta
        );
      });
    },

    getPorHoraRespuesta: function (horarespuesta) {
      return getData_().filter(function (item) {
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
      console.log("[CACHE] Traspasos limpios");
      return true;
    }
  };
})();
