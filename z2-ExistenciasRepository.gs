/**
 * ExistenciasRepository.gs
 *
 * Repositorio de lectura y actualización controlada de la hoja EXISTENCIAS.
 * También administra la bitácora técnica de idempotencia almacenada en
 * SINCRONIZACION_EXISTENCIAS.
 *
 * Responsabilidades:
 * - Normalizar y cachear el inventario disponible por producto.
 * - Consultar productos por identificador, código, descripción y saldo.
 * - Resolver bodegas contra la configuración EXISTENCIAS_BODEGAS.
 * - Aplicar traspasos entre columnas de inventario sin adquirir un candado
 *   adicional cuando el Service ya protege la operación completa.
 * - Evitar aplicaciones duplicadas mediante una clave basada en idOperacion.
 * - Registrar movimientos confirmados en SINCRONIZACION_EXISTENCIAS.
 * - Permitir actualizaciones directas y controladas de ALMACENBIRLOS.
 *
 * Reglas invariantes:
 * - aplicarMovimientosTraspaso() no adquiere LockService.
 * - El servicio llamador debe proteger la transacción completa.
 * - La idempotencia incluye idOperacion para permitir múltiples SURTIDO
 *   legítimos sobre el mismo IdUnico.
 * - La existencia de Almacén Birlos se escribe únicamente en
 *   COL.EXISTENCIAS.ALMACENBIRLOS.
 * - aplicarMovimientosTraspaso() no ejecuta SpreadsheetApp.flush().
 * - updateBirlosById() y updateBirlosBatch() sí administran su propio candado.
 *
 * Dependencias principales:
 * - getSheetByKey_(), getRowsByKey_().
 * - toNum_(), toStr_(), toStrUpper_().
 * - COL.EXISTENCIAS y COL.SINCRONIZACION_EXISTENCIAS.
 * - EXISTENCIAS_BODEGAS.
 * - LockService y SpreadsheetApp.
 *
 * API pública:
 * - Consultas: getAll(), getAllRaw(), getPorIdProducto(),
 *   getOnePorIdProducto(), getPorCodigo(), getPorDescripcion().
 * - Saldos: getExistenciasBirlos(), getExcedentesBodega(),
 *   getExcedentesCasaBlanca() y sus variantes negativas.
 * - Escritura: updateBirlosById(), updateBirlosBatch(),
 *   aplicarMovimientosTraspaso().
 * - Mantenimiento: clearCache().
 */
const ExistenciasRepository = (() => {
  "use strict";

  /** Inicia una traza de rendimiento para una operación de existencias. */
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

  /** Registra una etapa con duración parcial y acumulada. */
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

  /** Finaliza, registra y devuelve la traza de rendimiento. */
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

  /** @const {number} Fila física que contiene los encabezados. */
  const HEADER_ROW_ = 1;

  /** @const {number} Primera fila física con información operativa. */
  const FIRST_DATA_ROW_ = HEADER_ROW_ + 1;

  /** @type {Array<Object>|null} Caché normalizada de EXISTENCIAS. */
  let cache_ = null;

  // =========================================================
  // ACCESO Y NORMALIZACION
  // =========================================================

  /** @return {GoogleAppsScript.Spreadsheet.Sheet} Hoja EXISTENCIAS. */
  function getSheet_() {
    return getSheetByKey_(
      "EXISTENCIAS"
    );
  }

  /** @return {Array<Array<*>>} Filas de la fuente EXISTENCIAS. */
  function readSource_() {
    return getRowsByKey_("EXISTENCIAS");
  }

  /** Convierte una fila física al contrato normalizado del repositorio. */
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

  /** Obtiene la colección normalizada desde caché o desde la hoja. */
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

  /** Invalida la caché interna del repositorio. */
  function clearCache_() {
    cache_ = null;
    console.log("[CACHE] Existencias limpiadas");
  }

  /** Normaliza códigos eliminando acentos y espacios redundantes. */
  function normalizeCode_(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  /** Normaliza nombres de bodega para comparaciones confiables. */
  function normalizeWarehouse_(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  /** Valida un IDPRODUCTO entero positivo. */
  function validateId_(idproducto) {
    const id = Number(idproducto);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(
        `IDPRODUCTO invalido: "${idproducto}".`
      );
    }

    return id;
  }

  /** Valida que una existencia sea numérica y finita. */
  function validateExistence_(existencia) {
    const value = Number(existencia);

    if (!Number.isFinite(value)) {
      throw new Error(
        `Existencia invalida: "${existencia}".`
      );
    }

    return value;
  }

  /** Convierte un índice de columna base cero al índice base uno de Sheets. */
  function sheetColumn_(zeroBasedColumn) {
    return zeroBasedColumn + 1;
  }

  /** Resuelve una bodega contra EXISTENCIAS_BODEGAS. */
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

  /** Localiza una fila única de EXISTENCIAS por IDPRODUCTO. */
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

  /** Valida y localiza una fila dentro de una matriz ya cargada. */
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

  /** Construye la clave de idempotencia de un movimiento. */
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

  /** Carga las claves ya aplicadas desde SINCRONIZACION_EXISTENCIAS. */
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

  /** Valida movimientos, omite duplicados y prepara cambios físicos. */
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

  /** Calcula y escribe las celdas afectadas por traspasos válidos. */
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

  /** Registra por lote las claves confirmadas para idempotencia futura. */
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

  /** Coordina aplicación, registro idempotente, métricas y respuesta. */
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

  /** Actualiza ALMACENBIRLOS para un producto previamente validado. */
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

  /** Actualiza un lote de existencias Birlos bajo un único candado. */
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

  /** Proyecta un campo de la colección normalizada. */
  function getField_(field) {
    return getData_().map(item => item[field]);
  }

  // =========================================================
  // API PUBLICA
  // =========================================================

  return {
    /** Devuelve todas las existencias ordenadas por código. */
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

    /** Devuelve una copia superficial sin orden adicional. */
    getAllRaw: function () {
      return [...getData_()];
    },

    /** Busca todos los registros de un IDPRODUCTO. */
    getPorIdProducto: function (idproducto) {
      const filter = toNum_(idproducto || 0);

      return getData_().filter(
        item => item.idproducto === filter
      );
    },

    /** Devuelve un registro único, null o error por duplicidad. */
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

    /** Busca registros por código normalizado. */
    getPorCodigo: function (codigo) {
      const filter = toStrUpper_(codigo || "");

      return getData_().filter(
        item => item.codigo === filter
      );
    },

    /** Busca registros por descripción normalizada. */
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

    /** Actualiza una existencia Birlos bajo ScriptLock. */
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
     * Aplica movimientos idempotentes de traspaso.
     *
     * No adquiere un candado adicional.
     * Se invoca desde PrototipoTraspasosService, que ya protege
     * la operacion completa con ScriptLock.
     */
    aplicarMovimientosTraspaso: function (movimientos) {
      return applyTransferMovements_(movimientos);
    },

    /** Procesa actualizaciones Birlos por lote. */
    updateBirlosBatch: function (items) {
      return updateBirlosBatch_(items);
    },

    /** Invalida la caché pública del repositorio. */
    clearCache: function () {
      clearCache_();

      return {
        correcto: true,
        mensaje: "Cache de existencias limpiada."
      };
    }
  };
})();

/**
 * Prueba manual de actualización directa. No forma parte de la API productiva.
 *
 * @return {void}
 */
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
