/**
 * ExistenciasRepository.gs
 * Lectura y actualizacion controlada de la hoja EXISTENCIAS.
 *
 * Reglas relevantes para traspasos:
 * - aplicarMovimientosTraspaso no adquiere un LockService adicional.
 * - El servicio llamador debe proteger la operacion completa.
 * - La idempotencia utiliza idOperacion para permitir varios SURTIDO
 *   legitimos sobre el mismo IdUnico.
 * - La existencia de Almacen Birlos se guarda unicamente en
 *   COL.EXISTENCIAS.ALMACENBIRLOS.
 */
const ExistenciasRepository = (() => {
  "use strict";

    function _perfExistenciasStart_(
    operation,
    metadata
  ) {
    const now = Date.now();

    return {
      operation: String(
        operation ||
        "EXISTENCIAS_OPERATION"
      ),
      startedAt: now,
      lastAt: now,
      metadata:
        metadata &&
        typeof metadata === "object"
          ? metadata
          : {},
      marks: []
    };
  }

  function _perfExistenciasMark_(
    trace,
    stage,
    metadata
  ) {
    if (!trace) {
      return;
    }

    const now = Date.now();

    trace.marks.push({
      stage: String(
        stage || "MARK"
      ),
      segmentMs:
        now - trace.lastAt,
      totalMs:
        now - trace.startedAt,
      metadata:
        metadata &&
        typeof metadata === "object"
          ? metadata
          : {}
    });

    trace.lastAt = now;
  }

  function _perfExistenciasEnd_(
    trace,
    status,
    metadata
  ) {
    if (!trace) {
      return null;
    }

    const result = {
      operation:
        trace.operation,
      status:
        String(status || "ok"),
      totalMs:
        Date.now() -
        trace.startedAt,
      metadata:
        Object.assign(
          {},
          trace.metadata,
          metadata || {}
        ),
      marks:
        trace.marks.slice()
    };

    console.log(
      "[APPALMACEN]" +
      "[EXISTENCIAS_BACKEND_PERF] " +
      JSON.stringify(result)
    );

    return result;
  }

  const HEADER_ROW_ = 1;
  const FIRST_DATA_ROW_ = HEADER_ROW_ + 1;

  let cache_ = null;

  // =========================================================
  // ACCESO Y NORMALIZACION
  // =========================================================

    function getSheet_() {
    return getSheetByKey_(
      "EXISTENCIAS"
    );
  }

  function readSource_() {
    return getRowsByKey_("EXISTENCIAS");
  }

  function normalize_(row) {
    return {
      idproducto: toNum_(
        row[COL.EXISTENCIAS.IDPRODUCTO] || ""
      ),
      codigo: toStrUpper_(
        row[COL.EXISTENCIAS.CODIGO] || ""
      ),
      descripcion: toStrUpper_(
        row[COL.EXISTENCIAS.DESCRIPCION] || ""
      ),
      almacenbirlos: toNum_(
        row[COL.EXISTENCIAS.ALMACENBIRLOS] || ""
      ),
      excedentebodega: toNum_(
        row[COL.EXISTENCIAS.EXCEDENTEBODEGA] || ""
      ),
      excedentecasablanca: toNum_(
        row[COL.EXISTENCIAS.EXCEDENTECASABLANCA] || ""
      )
    };
  }

  function getData_() {
    if (cache_ === null) {
      cache_ = readSource_()
        .map(normalize_)
        .filter(item => item.codigo);

      console.log(
        `[CACHE] ${cache_.length} existencias cargadas`
      );
    }

    return cache_;
  }

  function clearCache_() {
    cache_ = null;
    console.log("[CACHE] Existencias limpiadas");
  }

  function normalizeCode_(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function normalizeWarehouse_(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function validateId_(idproducto) {
    const id = Number(idproducto);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(
        `IDPRODUCTO invalido: "${idproducto}".`
      );
    }

    return id;
  }

  function validateExistence_(existencia) {
    const value = Number(existencia);

    if (!Number.isFinite(value)) {
      throw new Error(
        `Existencia invalida: "${existencia}".`
      );
    }

    return value;
  }

  function sheetColumn_(zeroBasedColumn) {
    return zeroBasedColumn + 1;
  }

  function resolveWarehouse_(warehouseName) {
    const normalized = normalizeWarehouse_(warehouseName);

    if (!normalized) {
      throw new Error(
        "El nombre de la bodega es obligatorio."
      );
    }

    const configurations = Object.values(
      EXISTENCIAS_BODEGAS
    );

    const match = configurations.find(configuration =>
      configuration.nombres.some(name =>
        normalizeWarehouse_(name) === normalized
      )
    );

    if (!match) {
      throw new Error(
        `Bodega no reconocida: "${warehouseName}".`
      );
    }

    return match;
  }

  

  // =========================================================
  // BUSQUEDA DE FILAS
  // =========================================================

  function findRowById_(sheet, idproducto) {
    const id = validateId_(idproducto);
    const lastRow = sheet.getLastRow();

    if (lastRow < FIRST_DATA_ROW_) {
      return null;
    }

    const rowCount = lastRow - FIRST_DATA_ROW_ + 1;
    const width = COL.EXISTENCIAS.ALMACENBIRLOS + 1;

    const values = sheet
      .getRange(
        FIRST_DATA_ROW_,
        1,
        rowCount,
        width
      )
      .getValues();

    const matches = [];

    values.forEach((row, index) => {
      const rowId = Number(
        row[COL.EXISTENCIAS.IDPRODUCTO]
      );

      if (rowId === id) {
        matches.push({
          rowNumber: FIRST_DATA_ROW_ + index,
          idproducto: rowId,
          codigo: normalizeCode_(
            row[COL.EXISTENCIAS.CODIGO]
          ),
          descripcion: String(
            row[COL.EXISTENCIAS.DESCRIPCION] || ""
          ).trim(),
          almacenbirlos: Number(
            row[COL.EXISTENCIAS.ALMACENBIRLOS]
          ) || 0
        });
      }
    });

    if (matches.length === 0) {
      return null;
    }

    if (matches.length > 1) {
      throw new Error(
        `El IDPRODUCTO ${id} esta duplicado en la hoja EXISTENCIAS.`
      );
    }

    return matches[0];
  }

  function findExistenceRow_(values, idproducto, codigo) {
    const id = Number(idproducto);
    const code = toStrUpper_(codigo || "");

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(
        `IDPRODUCTO invalido: "${idproducto}".`
      );
    }

    if (!code) {
      throw new Error("El codigo es obligatorio.");
    }

    const matches = [];

    values.forEach((row, index) => {
      const rowId = Number(
        row[COL.EXISTENCIAS.IDPRODUCTO]
      );

      const rowCode = toStrUpper_(
        row[COL.EXISTENCIAS.CODIGO] || ""
      );

      if (rowId === id) {
        matches.push({
          arrayIndex: index,
          rowNumber: index + 2,
          codigo: rowCode
        });
      }
    });

    if (matches.length === 0) {
      throw new Error(
        `El IDPRODUCTO ${id} no existe en EXISTENCIAS.`
      );
    }

    if (matches.length > 1) {
      throw new Error(
        `El IDPRODUCTO ${id} esta duplicado en EXISTENCIAS.`
      );
    }

    const match = matches[0];

    if (match.codigo !== code) {
      throw new Error(
        `El codigo no coincide con el ID ${id}. ` +
        `Esperado: "${code}". ` +
        `En EXISTENCIAS: "${match.codigo}".`
      );
    }

    return match;
  }

  // =========================================================
  // IDEMPOTENCIA DE MOVIMIENTOS
  // =========================================================

  function buildMovementKey_(movement) {
    const idOperacion = toStr_(
      movement.idOperacion || ""
    );

    const idUnico = toStr_(
      movement.idunico || ""
    );

    const tipo = toStrUpper_(
      movement.tipomovimiento || ""
    );

    const codigo = toStrUpper_(
      movement.codigo || ""
    );

    if (!idOperacion) {
      throw new Error(
        "idOperacion es obligatorio para controlar la idempotencia."
      );
    }

    if (!idUnico) {
      throw new Error(
        "IDUNICO es obligatorio para actualizar existencias."
      );
    }

    if (!tipo) {
      throw new Error(
        "TIPOMOVIMIENTO es obligatorio."
      );
    }

    if (!codigo) {
      throw new Error(
        "CODIGO es obligatorio."
      );
    }

    return [
      idOperacion,
      idUnico,
      tipo,
      codigo
    ].join("|");
  }

  function getAppliedMovementKeys_(
    trace
  ) {
    const sheetStartedAt =
      Date.now();

    const sheet =
      getSheetByKey_(
        "SINCRONIZACION_EXISTENCIAS"
      );

    const lastRow =
      sheet.getLastRow();

    _perfExistenciasMark_(
      trace,
      "IDEMPOTENCIA_SHEET_READY",
      {
        elapsedMs:
          Date.now() -
          sheetStartedAt,
        lastRow:
          lastRow
      }
    );

    if (lastRow < 2) {
      return new Set();
    }

    const readStartedAt =
      Date.now();

    const rawKeys =
      sheet
        .getRange(
          2,
          COL.SINCRONIZACION_EXISTENCIAS
            .CLAVE + 1,
          lastRow - 1,
          1
        )
        .getDisplayValues();

    _perfExistenciasMark_(
      trace,
      "IDEMPOTENCIA_KEYS_READ",
      {
        elapsedMs:
          Date.now() -
          readStartedAt,
        rows:
          rawKeys.length
      }
    );

    const buildStartedAt =
      Date.now();

    const result =
      new Set(
        rawKeys
          .flat()
          .map(function(value) {
            return toStr_(value);
          })
          .filter(Boolean)
      );

    _perfExistenciasMark_(
      trace,
      "IDEMPOTENCIA_SET_BUILT",
      {
        elapsedMs:
          Date.now() -
          buildStartedAt,
        keys:
          result.size
      }
    );

    return result;
  }

  function prepareTransferChanges_(movements, values, trace) {
    if (!Array.isArray(movements)) {
      throw new Error(
        "Los movimientos deben ser un arreglo."
      );
    }

    const appliedKeys = getAppliedMovementKeys_(trace);
    const changes = [];
    const ignored = [];

    movements.forEach((movement, index) => {
      const key = buildMovementKey_(movement);

      if (appliedKeys.has(key)) {
        ignored.push({
          clave: key,
          idOperacion: toStr_(movement.idOperacion || ""),
          idunico: toStr_(movement.idunico || ""),
          indice: index,
          motivo: "YA_APLICADO_O_DUPLICADO_EN_LOTE"
        });

        return;
      }

      appliedKeys.add(key);

      const quantity = Math.abs(
        Number(movement.cantidad)
      );

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(
          `Cantidad invalida para "${movement.codigo}".`
        );
      }

      const source = resolveWarehouse_(
        movement.bodegasalida
      );

      const target = resolveWarehouse_(
        movement.bodegaentrada
      );

      const row = findExistenceRow_(
        values,
        movement.idproducto,
        movement.codigo
      );

      changes.push({
        clave: key,
        idOperacion: toStr_(movement.idOperacion),
        idunico: toStr_(movement.idunico),
        tipomovimiento: toStrUpper_(
          movement.tipomovimiento
        ),
        idproducto: Number(movement.idproducto),
        codigo: toStrUpper_(movement.codigo),
        bodegaSalida: toStrUpper_(
          movement.bodegasalida
        ),
        bodegaEntrada: toStrUpper_(
          movement.bodegaentrada
        ),
        cantidad: quantity,
        source,
        target,
        arrayIndex: row.arrayIndex,
        rowNumber: row.rowNumber
      });
    });

    _perfExistenciasMark_(
      trace,
      "MOVEMENTS_PREPARED",
      {
        recibidos:
          movements.length,
        cambios:
          changes.length,
        ignorados:
          ignored.length
      }
    );    

    return {
      changes,
      ignored
    };
  }

  // =========================================================
  // APLICACION DE TRASPASOS
  // =========================================================

  function applyTransferChanges_(
    movements,
    trace
  ) {
    const sheetStartedAt =
      Date.now();

    const sheet =
      getSheet_();

    const lastRow =
      sheet.getLastRow();

    _perfExistenciasMark_(
      trace,
      "EXISTENCIAS_SHEET_READY",
      {
        elapsedMs:
          Date.now() -
          sheetStartedAt,
        lastRow:
          lastRow
      }
    );

    if (lastRow < 2) {
      throw new Error(
        "La hoja EXISTENCIAS esta vacia."
      );
    }

    const width =
      COL.EXISTENCIAS
        .EXCEDENTECASABLANCA + 1;

    const readStartedAt =
      Date.now();

    const values =
      sheet
        .getRange(
          2,
          1,
          lastRow - 1,
          width
        )
        .getValues();

    _perfExistenciasMark_(
      trace,
      "EXISTENCIAS_VALUES_READ",
      {
        elapsedMs:
          Date.now() -
          readStartedAt,
        rows:
          values.length,
        columns:
          width
      }
    );

    const prepared =
      prepareTransferChanges_(
        movements,
        values,
        trace
      );

    const pendingWritesByCell =
      new Map();

    prepared.changes.forEach(
      function(change) {
        if (
          change.source.column ===
          change.target.column
        ) {
          return;
        }

        const row =
          values[
            change.arrayIndex
          ];

        const sourceValue =
          Number(
            row[
              change.source.column
            ]
          ) || 0;

        const targetValue =
          Number(
            row[
              change.target.column
            ]
          ) || 0;

        const sourceNewValue =
          sourceValue -
          change.cantidad;

        const targetNewValue =
          targetValue +
          change.cantidad;

        row[
          change.source.column
        ] = sourceNewValue;

        row[
          change.target.column
        ] = targetNewValue;

        pendingWritesByCell.set(
          [
            change.rowNumber,
            change.source.column
          ].join("|"),
          {
            rowNumber:
              change.rowNumber,
            zeroBasedColumn:
              change.source.column,
            value:
              sourceNewValue
          }
        );

        pendingWritesByCell.set(
          [
            change.rowNumber,
            change.target.column
          ].join("|"),
          {
            rowNumber:
              change.rowNumber,
            zeroBasedColumn:
              change.target.column,
            value:
              targetNewValue
          }
        );
      }
    );

    const pendingWrites =
      Array.from(
        pendingWritesByCell.values()
      );

    _perfExistenciasMark_(
      trace,
      "CELL_CHANGES_CALCULATED",
      {
        movements:
          prepared.changes.length,
        cells:
          pendingWrites.length
      }
    );

    const writeStartedAt =
      Date.now();

    pendingWrites.forEach(
      function(write) {
        sheet
          .getRange(
            write.rowNumber,
            sheetColumn_(
              write.zeroBasedColumn
            )
          )
          .setValue(
            write.value
          );
      }
    );

    _perfExistenciasMark_(
      trace,
      "EXISTENCIAS_CELLS_WRITTEN",
      {
        elapsedMs:
          Date.now() -
          writeStartedAt,
        cells:
          pendingWrites.length
      }
    );

    return prepared;
  }

  function registerAppliedChanges_(
    changes,
    trace
  ) {
    if (
      !Array.isArray(changes) ||
      changes.length === 0
    ) {
      _perfExistenciasMark_(
        trace,
        "IDEMPOTENCIA_REGISTER_SKIPPED"
      );

      return;
    }

    const prepareStartedAt =
      Date.now();

    const sheet =
      getSheetByKey_(
        "SINCRONIZACION_EXISTENCIAS"
      );

    const now =
      new Date();

    const rows =
      changes.map(
        function(change) {
          return [
            change.clave,
            change.idunico,
            change.tipomovimiento,
            change.idproducto,
            change.codigo,
            change.bodegaSalida,
            change.bodegaEntrada,
            change.cantidad,
            now,
            "APLICADO"
          ];
        }
      );

    _perfExistenciasMark_(
      trace,
      "IDEMPOTENCIA_ROWS_READY",
      {
        elapsedMs:
          Date.now() -
          prepareStartedAt,
        rows:
          rows.length
      }
    );

    const lastRowStartedAt =
      Date.now();

    const destinationRow =
      sheet.getLastRow() + 1;

    _perfExistenciasMark_(
      trace,
      "IDEMPOTENCIA_DESTINATION_READY",
      {
        elapsedMs:
          Date.now() -
          lastRowStartedAt,
        row:
          destinationRow
      }
    );

    const writeStartedAt =
      Date.now();

    sheet
      .getRange(
        destinationRow,
        1,
        rows.length,
        rows[0].length
      )
      .setValues(rows);

    _perfExistenciasMark_(
      trace,
      "IDEMPOTENCIA_ROWS_APPENDED",
      {
        elapsedMs:
          Date.now() -
          writeStartedAt,
        rows:
          rows.length
      }
    );
  }

  function applyTransferMovements_(
    movements
  ) {
    const trace =
      _perfExistenciasStart_(
        "EXISTENCIAS_APLICAR_TRASPASOS",
        {
          recibidos:
            Array.isArray(
              movements
            )
              ? movements.length
              : 0
        }
      );

    try {
      if (
        !Array.isArray(movements)
      ) {
        throw new Error(
          "Los movimientos deben ser un arreglo."
        );
      }

      if (
        movements.length === 0
      ) {
        const emptyResult = {
          correcto: true,
          recibidos: 0,
          aplicados: 0,
          ignorados: 0,
          cambios: [],
          duplicados: []
        };

        _perfExistenciasEnd_(
          trace,
          "ok",
          {
            aplicados: 0,
            ignorados: 0
          }
        );

        return emptyResult;
      }

      const result =
        applyTransferChanges_(
          movements,
          trace
        );

      registerAppliedChanges_(
        result.changes,
        trace
      );

      /*
       * No se ejecuta SpreadsheetApp.flush() aquí.
       *
       * PrototipoTraspasosService realiza un único flush
       * después de escribir:
       *
       * - EXISTENCIAS
       * - SINCRONIZACION_EXISTENCIAS
       * - Bitacora-TRASPASOS
       * - STATUS de BD-EXCEDENTES
       */
      clearCache_();

      _perfExistenciasMark_(
        trace,
        "LOCAL_CACHE_CLEARED"
      );

      const response = {
        correcto: true,

        recibidos:
          movements.length,

        aplicados:
          result.changes.length,

        ignorados:
          result.ignored.length,

        cambios:
          result.changes.map(
            function(change) {
              return {
                clave:
                  change.clave,

                idOperacion:
                  change.idOperacion,

                idunico:
                  change.idunico,

                idproducto:
                  change.idproducto,

                codigo:
                  change.codigo,

                cantidad:
                  change.cantidad,

                bodegaSalida:
                  change.bodegaSalida,

                bodegaEntrada:
                  change.bodegaEntrada
              };
            }
          ),

        duplicados:
          result.ignored
      };

      _perfExistenciasEnd_(
        trace,
        "ok",
        {
          aplicados:
            response.aplicados,

          ignorados:
            response.ignorados
        }
      );

      return response;
    } catch (error) {
      _perfExistenciasMark_(
        trace,
        "FAILED",
        {
          message:
            error &&
            error.message
              ? error.message
              : String(
                  error || ""
                )
        }
      );

      _perfExistenciasEnd_(
        trace,
        "error",
        {
          recibidos:
            Array.isArray(
              movements
            )
              ? movements.length
              : 0
        }
      );

      throw error;
    }
  }

  // =========================================================
  // ACTUALIZACION DIRECTA DE ALMACEN BIRLOS
  // =========================================================

  function updateBirlosById_(
    idproducto,
    existencia,
    codigoEsperado
  ) {
    const id = validateId_(idproducto);
    const newExistence = validateExistence_(existencia);
    const sheet = getSheet_();
    const record = findRowById_(sheet, id);

    if (!record) {
      throw new Error(
        `No se encontro el IDPRODUCTO ${id} en EXISTENCIAS.`
      );
    }

    const expectedCode = normalizeCode_(codigoEsperado);

    if (expectedCode && record.codigo !== expectedCode) {
      throw new Error(
        `El codigo no coincide con el ID ${id}. ` +
        `Esperado: "${expectedCode}". ` +
        `En hoja: "${record.codigo}".`
      );
    }

    const previousExistence = record.almacenbirlos;

    sheet
      .getRange(
        record.rowNumber,
        sheetColumn_(COL.EXISTENCIAS.ALMACENBIRLOS)
      )
      .setValue(newExistence);

    SpreadsheetApp.flush();
    clearCache_();

    const result = {
      correcto: true,
      actualizado: true,
      idproducto: id,
      codigo: record.codigo,
      fila: record.rowNumber,
      columna: "ALMACENBIRLOS",
      existenciaAnterior: previousExistence,
      existenciaNueva: newExistence,
      fechaActualizacion: new Date().toISOString()
    };

    console.log(
      "[EXISTENCIAS] Actualizacion Birlos",
      JSON.stringify(result)
    );

    return result;
  }

  function updateBirlosBatch_(items) {
    if (!Array.isArray(items)) {
      throw new Error(
        "El lote debe ser un arreglo."
      );
    }

    if (items.length === 0) {
      return {
        correcto: true,
        recibidos: 0,
        actualizados: 0,
        errores: 0,
        resultados: []
      };
    }

    const lock = LockService.getScriptLock();
    const locked = lock.tryLock(30000);

    if (!locked) {
      throw new Error(
        "Otra operacion de inventario esta en proceso."
      );
    }

    try {
      const results = [];

      items.forEach(item => {
        try {
          results.push(
            updateBirlosById_(
              item.idproducto,
              item.existencia,
              item.codigo
            )
          );
        } catch (error) {
          results.push({
            correcto: false,
            actualizado: false,
            idproducto: item?.idproducto ?? "",
            codigo: item?.codigo ?? "",
            existencia: item?.existencia ?? "",
            error: error.message
          });
        }
      });

      return {
        correcto: results.every(item => item.correcto),
        recibidos: results.length,
        actualizados: results.filter(
          item => item.actualizado
        ).length,
        errores: results.filter(
          item => !item.correcto
        ).length,
        resultados: results
      };
    } finally {
      lock.releaseLock();
    }
  }

  function getField_(field) {
    return getData_().map(item => item[field]);
  }

  // =========================================================
  // API PUBLICA
  // =========================================================

  return {
    getAll: function () {
      return [...getData_()].sort((a, b) =>
        a.codigo.localeCompare(
          b.codigo,
          "es-MX",
          {
            numeric: true,
            sensitivity: "base"
          }
        )
      );
    },

    getAllRaw: function () {
      return [...getData_()];
    },

    getPorIdProducto: function (idproducto) {
      const filter = toNum_(idproducto || 0);

      return getData_().filter(
        item => item.idproducto === filter
      );
    },

    getOnePorIdProducto: function (idproducto) {
      const results = getData_().filter(
        item => item.idproducto === toNum_(idproducto || 0)
      );

      if (results.length === 0) {
        return null;
      }

      if (results.length > 1) {
        throw new Error(
          `El IDPRODUCTO ${idproducto} esta duplicado.`
        );
      }

      return results[0];
    },

    getPorCodigo: function (codigo) {
      const filter = toStrUpper_(codigo || "");

      return getData_().filter(
        item => item.codigo === filter
      );
    },

    getPorDescripcion: function (descripcion) {
      const filter = toStrUpper_(descripcion || "");

      return getData_().filter(
        item => item.descripcion === filter
      );
    },

    getExistenciasBirlos: function () {
      return getData_().filter(
        item => item.almacenbirlos > 0
      );
    },

    getExcedentesBodega: function () {
      return getData_().filter(
        item => item.excedentebodega > 0
      );
    },

    getExcedentesCasaBlanca: function () {
      return getData_().filter(
        item => item.excedentecasablanca > 0
      );
    },

    getNegativosBirlos: function () {
      return getData_().filter(
        item => item.almacenbirlos < 0
      );
    },

    getNegativosBodega: function () {
      return getData_().filter(
        item => item.excedentebodega < 0
      );
    },

    getNegativosCasaBlanca: function () {
      return getData_().filter(
        item => item.excedentecasablanca < 0
      );
    },

    updateBirlosById: function (
      idproducto,
      existencia,
      codigoEsperado
    ) {
      const lock = LockService.getScriptLock();
      const locked = lock.tryLock(30000);

      if (!locked) {
        throw new Error(
          "Otra operacion de inventario esta en proceso."
        );
      }

      try {
        return updateBirlosById_(
          idproducto,
          existencia,
          codigoEsperado
        );
      } finally {
        lock.releaseLock();
      }
    },

    /**
     * No adquiere un candado adicional.
     * Se invoca desde PrototipoTraspasosService, que ya protege
     * la operacion completa con ScriptLock.
     */
    aplicarMovimientosTraspaso: function (movimientos) {
      return applyTransferMovements_(movimientos);
    },

    updateBirlosBatch: function (items) {
      return updateBirlosBatch_(items);
    },

    clearCache: function () {
      clearCache_();

      return {
        correcto: true,
        mensaje: "Cache de existencias limpiada."
      };
    }
  };
})();

function testActualizarExistenciaBirlos() {
  const resultado = ExistenciasRepository.updateBirlosById(
    5723,
    1,
    "01-311-A-6"
  );

  console.log(
    JSON.stringify(resultado, null, 2)
  );
}
