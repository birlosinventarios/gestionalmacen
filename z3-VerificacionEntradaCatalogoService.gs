/**
 * VerificacionEntradaCatalogoService.gs
 *
 * Sincroniza VE_CATALOGO_PROVEEDORES con VE_EQUIVALENCIAS.
 *
 * Optimizaciones:
 * - Abre cada Spreadsheet y Sheet una sola vez por ejecución.
 * - Separa tracking de configuración, lectura, análisis, mezcla, respaldo y escritura.
 * - Lee cada hoja una sola vez por operación.
 * - Escribe VE_EQUIVALENCIAS con un único setValues().
 * - Conserva equivalencias manuales o confirmadas.
 * - Protege la escritura con ScriptLock.
 * - Crea y rota respaldos antes de sustituir datos.
 * - Limpia cachés del Repository y Service después de una escritura exitosa.
 */
const VerificacionEntradaCatalogoService = (() => {
  "use strict";

  const SOURCE_KEY = "VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES";
  const TARGET_KEY = "VERIFICACION_ENTRADA_EQUIVALENCIAS";
  const SOURCE_ORIGIN = "BASE_PRODUCTOS_PROVEEDOR";
  const CREATED_BY = "SINCRONIZACION_CATALOGO";
  const SOURCE_WIDTH = 18;
  const TARGET_WIDTH = 23;
  const BACKUP_PREFIX = "BK_VE_EQUIV_";
  const MAX_BACKUPS = 5;
  const LOCK_TIMEOUT_MS = 30000;
  const PREVIEW_SAMPLE_SIZE = 20;
  const MAX_CONFLICT_DETAILS = 50;
  const MAX_PROTECTED_DETAILS = 100;

  const runtimeCache_ = {
    spreadsheets: {},
    sheets: {}
  };

  function _text_(value) {
    return String(value == null ? "" : value).trim();
  }

  function _upper_(value) {
    return _text_(value).toUpperCase().replace(/\s+/g, " ").trim();
  }

  function _normalizeRfc_(value) {
    return _upper_(value).replace(/[\s-]+/g, "");
  }

  function _normalizeCode_(value) {
    return _upper_(value);
  }

  function _isValidRfcFormat_(value) {
    return /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/.test(
      _normalizeRfc_(value)
    );
  }

  function _isActive_(value) {
    if (value === true) return true;

    return [
      "1",
      "SI",
      "SÍ",
      "TRUE",
      "VERDADERO",
      "ACTIVO"
    ].includes(_upper_(value));
  }

  function _asDate_(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return value;
    }

    const text = _text_(value);
    if (!text) return new Date(0);

    const match = text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?::(\d{1,3}))?$/
    );

    if (match) {
      const parsed = new Date(
        Number(match[3]),
        Number(match[1]) - 1,
        Number(match[2]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6]),
        Number(match[7] || 0)
      );

      return isNaN(parsed.getTime()) ? new Date(0) : parsed;
    }

    const fallback = new Date(text);
    return isNaN(fallback.getTime()) ? new Date(0) : fallback;
  }

  function _safeIdPart_(value) {
    return _upper_(value)
      .replace(/[^A-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 45);
  }

  function _createEquivalenceId_(rfc, providerCode) {
    return [
      "VE-EQV",
      _safeIdPart_(rfc),
      _safeIdPart_(providerCode)
    ].join("-").slice(0, 100);
  }

  function _mark_(trace, stage, metadata) {
    if (trace && typeof perfMark_ === "function") {
      perfMark_(trace, stage, metadata || {});
    }
  }

  function _startTrace_(operation, metadata) {
    return typeof perfStart_ === "function"
      ? perfStart_(operation, metadata || {})
      : null;
  }

  function _endTrace_(trace, status, metadata) {
    if (trace && typeof perfEnd_ === "function") {
      perfEnd_(trace, status || "ok", metadata || {});
    }
  }

  function _failTrace_(trace, error) {
    if (trace && typeof perfFail_ === "function") {
      perfFail_(trace, error);
    }
  }

  function _clearRuntimeCache_() {
    runtimeCache_.spreadsheets = {};
    runtimeCache_.sheets = {};
  }

  function _spreadsheetForConfig_(config, trace) {
    if (!config || !config.file) {
      throw new Error("Configuración de hoja inválida.");
    }

    const fileKey = config.file;
    const fileId = FILES[fileKey];

    if (!fileId) {
      throw new Error("No existe FILES." + fileKey + ".");
    }

    if (runtimeCache_.spreadsheets[fileKey]) {
      _mark_(trace, "VE_CATALOG_SPREADSHEET_CACHE_HIT", {
        fileKey: fileKey
      });
      return runtimeCache_.spreadsheets[fileKey];
    }

    const startedAt = Date.now();
    const spreadsheet = SpreadsheetApp.openById(fileId);
    runtimeCache_.spreadsheets[fileKey] = spreadsheet;

    _mark_(trace, "VE_CATALOG_SPREADSHEET_OPENED", {
      elapsedMs: Date.now() - startedAt,
      fileKey: fileKey
    });

    return spreadsheet;
  }

  function _sheetByKey_(sheetKey, trace) {
    if (runtimeCache_.sheets[sheetKey]) {
      _mark_(trace, "VE_CATALOG_SHEET_CACHE_HIT", {
        sheetKey: sheetKey
      });
      return runtimeCache_.sheets[sheetKey];
    }

    const config = SHEETS[sheetKey];
    if (!config) {
      throw new Error("No existe SHEETS." + sheetKey + ".");
    }

    const spreadsheet = _spreadsheetForConfig_(config, trace);
    const startedAt = Date.now();
    const sheet = spreadsheet.getSheetByName(config.name);

    if (!sheet) {
      throw new Error(
        'No se encontró la hoja "' +
        config.name +
        '" en el archivo "' +
        config.file +
        '".'
      );
    }

    const resource = {
      key: sheetKey,
      config: config,
      spreadsheet: spreadsheet,
      sheet: sheet
    };

    runtimeCache_.sheets[sheetKey] = resource;

    _mark_(trace, "VE_CATALOG_SHEET_RESOLVED", {
      elapsedMs: Date.now() - startedAt,
      sheetKey: sheetKey,
      sheetName: config.name
    });

    return resource;
  }

  function _expectedSourceHeaders_() {
    const headers = VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES_HEADERS;

    if (!Array.isArray(headers) || headers.length !== SOURCE_WIDTH) {
      throw new Error(
        "El contrato de VE_CATALOGO_PROVEEDORES debe contener 18 encabezados."
      );
    }

    return headers.slice();
  }

  function _assertHeaders_(sheet, expectedHeaders, width, label) {
    if (sheet.getLastColumn() !== width) {
      throw new Error(
        "Ancho físico incorrecto en " +
        label +
        ". Esperado: " +
        width +
        ", encontrado: " +
        sheet.getLastColumn() +
        "."
      );
    }

    const actual = sheet
      .getRange(1, 1, 1, width)
      .getDisplayValues()[0]
      .map(_upper_);

    const mismatches = [];

    expectedHeaders.forEach(function(header, index) {
      const expected = _upper_(header);
      if (actual[index] !== expected) {
        mismatches.push({
          column: index + 1,
          expected: expected,
          actual: actual[index]
        });
      }
    });

    if (mismatches.length > 0) {
      throw new Error(
        "Encabezados incorrectos en " +
        label +
        ": " +
        JSON.stringify(mismatches.slice(0, width))
      );
    }
  }

  function _assertSourceConfiguration_(trace) {
    const startedAt = Date.now();
    const resource = _sheetByKey_(SOURCE_KEY, trace);
    const expected = _expectedSourceHeaders_();
    const configuredWidth = Number(
      VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES_WIDTH || SOURCE_WIDTH
    );

    if (configuredWidth !== SOURCE_WIDTH) {
      throw new Error(
        "El ancho configurado de VE_CATALOGO_PROVEEDORES debe ser 18."
      );
    }

    _assertHeaders_(
      resource.sheet,
      expected,
      SOURCE_WIDTH,
      resource.config.name
    );

    _mark_(trace, "VE_CATALOG_SOURCE_VALIDATED", {
      elapsedMs: Date.now() - startedAt,
      width: SOURCE_WIDTH,
      rows: Math.max(0, resource.sheet.getLastRow() - 1)
    });

    return resource;
  }

  function _assertTargetConfiguration_(trace) {
    const startedAt = Date.now();
    const resource = _sheetByKey_(TARGET_KEY, trace);
    const expected = VERIFICACION_ENTRADA_HEADERS.EQUIVALENCIAS;

    if (!Array.isArray(expected) || expected.length !== TARGET_WIDTH) {
      throw new Error(
        "El contrato de VE_EQUIVALENCIAS debe contener 23 encabezados."
      );
    }

    _assertHeaders_(
      resource.sheet,
      expected,
      TARGET_WIDTH,
      resource.config.name
    );

    _mark_(trace, "VE_CATALOG_TARGET_VALIDATED", {
      elapsedMs: Date.now() - startedAt,
      width: TARGET_WIDTH,
      rows: Math.max(0, resource.sheet.getLastRow() - 1)
    });

    return resource;
  }

  function _catalogColumns_() {
    const columns = COL.VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES;
    if (!columns) {
      throw new Error(
        "No existe COL.VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES."
      );
    }
    return columns;
  }

  function _targetColumns_() {
    const columns = COL.VERIFICACION_ENTRADA_EQUIVALENCIAS;
    if (!columns) {
      throw new Error(
        "No existe COL.VERIFICACION_ENTRADA_EQUIVALENCIAS."
      );
    }
    return columns;
  }

  function _readRows_(resource, width, trace, stage) {
    const startedAt = Date.now();
    const lastRow = resource.sheet.getLastRow();

    if (lastRow <= 1) {
      _mark_(trace, stage, {
        elapsedMs: Date.now() - startedAt,
        rows: 0,
        width: width
      });
      return [];
    }

    const rows = resource.sheet
      .getRange(2, 1, lastRow - 1, width)
      .getValues();

    _mark_(trace, stage, {
      elapsedMs: Date.now() - startedAt,
      rows: rows.length,
      width: width
    });

    return rows;
  }

  function _mapSourceRow_(row, rowNumber) {
    const c = _catalogColumns_();

    return {
      rowNumber: rowNumber,
      idFila: _text_(row[c.IDFILA]),
      idPrecioCompra: _text_(row[c.IDPRECIOCOMPRA]),
      idProducto: _text_(row[c.IDPRODUCTO]),
      codigoProducto: _normalizeCode_(row[c.CODIGOPRODUCTO]),
      nombreProducto: _text_(row[c.NOMBREPRODUCTO]),
      statusProducto: row[c.STATUSPRODUCTO],
      idProveedor: _text_(row[c.IDPROVEEDOR]),
      codigoProveedor: _text_(row[c.CODIGOPROVEEDOR]),
      nombreProveedor: _text_(row[c.NOMBREPROVEEDOR]),
      rfcProveedor: _normalizeRfc_(row[c.RFCPROVEEDOR]),
      codigoProductoProveedor: _normalizeCode_(
        row[c.CODIGOPRODUCTOPROVEEDOR]
      ),
      precioCompra: row[c.PRECIOCOMPRA],
      idMoneda: _text_(row[c.IDMONEDA]),
      moneda: _text_(row[c.MONEDA]),
      simbolo: _text_(row[c.SIMBOLO]),
      idUnidad: _text_(row[c.IDUNIDAD]),
      unidad: _text_(row[c.UNIDAD]),
      timestamp: _asDate_(row[c.TIMESTAMP])
    };
  }

  function _reasonForExclusion_(item) {
    if (!_isActive_(item.statusProducto)) return "PRODUCTO_INACTIVO";
    if (!item.rfcProveedor) return "RFC_VACIO";
    if (!_isValidRfcFormat_(item.rfcProveedor)) return "RFC_FORMATO_INVALIDO";
    if (!item.codigoProductoProveedor) return "CODIGO_PROVEEDOR_VACIO";
    if (!item.codigoProducto) return "CODIGO_INTERNO_VACIO";
    if (!item.idProducto) return "ID_PRODUCTO_VACIO";
    if (!item.idProveedor) return "ID_PROVEEDOR_VACIO";
    return "";
  }

  function _buildCatalogAnalysis_(sourceRows, trace) {
    const startedAt = Date.now();
    const exclusionCounts = {};
    const groups = {};

    sourceRows.forEach(function(row, index) {
      const item = _mapSourceRow_(row, index + 2);
      const reason = _reasonForExclusion_(item);

      if (reason) {
        exclusionCounts[reason] = Number(exclusionCounts[reason] || 0) + 1;
        return;
      }

      const key = [
        item.rfcProveedor,
        item.codigoProductoProveedor
      ].join("|");

      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    const generated = [];
    const conflicts = [];
    const generatedAt = new Date();

    Object.keys(groups).sort().forEach(function(key) {
      const records = groups[key].slice().sort(function(a, b) {
        const timeDifference = b.timestamp.getTime() - a.timestamp.getTime();
        return timeDifference !== 0
          ? timeDifference
          : b.rowNumber - a.rowNumber;
      });

      const selected = records[0];
      const productIds = {};
      const internalCodes = {};
      const providerIds = {};

      records.forEach(function(item) {
        productIds[item.idProducto] = true;
        internalCodes[item.codigoProducto] = true;
        providerIds[item.idProveedor] = true;
      });

      const conflictReasons = [];
      if (Object.keys(productIds).length > 1) {
        conflictReasons.push("CONFLICTO_ID_PRODUCTO");
      }
      if (Object.keys(internalCodes).length > 1) {
        conflictReasons.push("CONFLICTO_CODIGO_INTERNO");
      }
      if (Object.keys(providerIds).length > 1) {
        conflictReasons.push("CONFLICTO_ID_PROVEEDOR");
      }

      const hasConflict = conflictReasons.length > 0;
      const sourceRowNumbers = records.map(function(item) {
        return item.rowNumber;
      });

      generated.push({
        idEquivalencia: _createEquivalenceId_(
          selected.rfcProveedor,
          selected.codigoProductoProveedor
        ),
        rfcEmisor: selected.rfcProveedor,
        idProveedor: selected.idProveedor,
        codigoProveedorXml: selected.codigoProductoProveedor,
        codigoEtiqueta: selected.codigoProductoProveedor,
        codigoInterno: selected.codigoProducto,
        idProducto: selected.idProducto,
        descripcionInterna: selected.nombreProducto,
        claveUnidadXml: "",
        unidadXml: "",
        unidadInterna: "",
        factorConversion: 1,
        tipoConcepto: "PRODUCTO",
        activo: hasConflict ? "NO" : "SI",
        nivelConfianza: hasConflict ? "BAJA" : "ALTA",
        origenRegla: SOURCE_ORIGIN,
        fechaInicio: hasConflict ? "" : generatedAt,
        fechaFin: "",
        creadoPor: CREATED_BY,
        fechaCreacion: generatedAt,
        modificadoPor: "",
        fechaModificacion: "",
        observacion: hasConflict
          ? conflictReasons.join("|")
          : "Relación generada desde VE_CATALOGO_PROVEEDORES.",
        sourceRows: sourceRowNumbers,
        selectedSourceRow: selected.rowNumber,
        conflictReasons: conflictReasons
      });

      if (hasConflict) {
        conflicts.push({
          key: key,
          sourceRows: sourceRowNumbers,
          productIds: Object.keys(productIds),
          internalCodes: Object.keys(internalCodes),
          providerIds: Object.keys(providerIds),
          reasons: conflictReasons
        });
      }
    });

    const validRows = Object.keys(groups).reduce(function(total, key) {
      return total + groups[key].length;
    }, 0);

    const result = {
      sourceRows: sourceRows.length,
      validRows: validRows,
      excludedRows: sourceRows.length - validRows,
      exclusionCounts: exclusionCounts,
      uniqueKeys: Object.keys(groups).length,
      generatedEquivalences: generated,
      conflicts: conflicts
    };

    _mark_(trace, "VE_CATALOG_ANALYSIS_READY", {
      elapsedMs: Date.now() - startedAt,
      sourceRows: result.sourceRows,
      validRows: result.validRows,
      excludedRows: result.excludedRows,
      uniqueKeys: result.uniqueKeys,
      conflicts: result.conflicts.length
    });

    return result;
  }

  function _equivalenceToRow_(item) {
    const c = _targetColumns_();
    const row = new Array(TARGET_WIDTH).fill("");

    row[c.IDEQUIVALENCIA] = item.idEquivalencia;
    row[c.RFCEMISOR] = item.rfcEmisor;
    row[c.IDPROVEEDOR] = item.idProveedor;
    row[c.CODIGOPROVEEDORXML] = item.codigoProveedorXml;
    row[c.CODIGOETIQUETA] = item.codigoEtiqueta;
    row[c.CODIGOINTERNO] = item.codigoInterno;
    row[c.IDPRODUCTO] = item.idProducto;
    row[c.DESCRIPCIONINTERNA] = item.descripcionInterna;
    row[c.CLAVEUNIDADXML] = item.claveUnidadXml;
    row[c.UNIDADXML] = item.unidadXml;
    row[c.UNIDADINTERNA] = item.unidadInterna;
    row[c.FACTORCONVERSION] = item.factorConversion;
    row[c.TIPOCONCEPTO] = item.tipoConcepto;
    row[c.ACTIVO] = item.activo;
    row[c.NIVELCONFIANZA] = item.nivelConfianza;
    row[c.ORIGENREGLA] = item.origenRegla;
    row[c.FECHAINICIO] = item.fechaInicio;
    row[c.FECHAFIN] = item.fechaFin;
    row[c.CREADOPOR] = item.creadoPor;
    row[c.FECHACREACION] = item.fechaCreacion;
    row[c.MODIFICADOPOR] = item.modificadoPor;
    row[c.FECHAMODIFICACION] = item.fechaModificacion;
    row[c.OBSERVACION] = item.observacion;

    return row;
  }

  function _sourceManagedRow_(row) {
    const c = _targetColumns_();
    return _upper_(row[c.ORIGENREGLA]) === SOURCE_ORIGIN;
  }

  function _equivalenceKeyFromRow_(row) {
    const c = _targetColumns_();
    return [
      _normalizeRfc_(row[c.RFCEMISOR]),
      _normalizeCode_(row[c.CODIGOPROVEEDORXML])
    ].join("|");
  }

  function _mergePreservingManual_(existingRows, generated, trace) {
    const startedAt = Date.now();
    const preservedRows = [];
    const protectedKeys = {};

    existingRows.forEach(function(row) {
      if (_sourceManagedRow_(row)) return;

      preservedRows.push(row.slice());
      const key = _equivalenceKeyFromRow_(row);
      if (key !== "|") protectedKeys[key] = true;
    });

    const generatedRows = [];
    const skippedProtected = [];

    generated.forEach(function(item) {
      const key = [
        _normalizeRfc_(item.rfcEmisor),
        _normalizeCode_(item.codigoProveedorXml)
      ].join("|");

      if (protectedKeys[key]) {
        skippedProtected.push({
          key: key,
          reason: "EQUIVALENCIA_MANUAL_O_CONFIRMADA_PROTEGIDA"
        });
        return;
      }

      generatedRows.push(_equivalenceToRow_(item));
    });

    const result = {
      rows: preservedRows.concat(generatedRows),
      preservedRows: preservedRows.length,
      generatedRows: generatedRows.length,
      skippedProtected: skippedProtected
    };

    _mark_(trace, "VE_CATALOG_ROWS_MERGED", {
      elapsedMs: Date.now() - startedAt,
      existingRows: existingRows.length,
      preservedRows: result.preservedRows,
      generatedRows: result.generatedRows,
      protectedRows: skippedProtected.length,
      finalRows: result.rows.length
    });

    return result;
  }

  function _timestampForSheetName_() {
    return Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone() || "GMT-6",
      "yyyyMMdd_HHmmss_SSS"
    );
  }

  function _createBackup_(targetResource, trace) {
    const startedAt = Date.now();
    const spreadsheet = targetResource.spreadsheet;
    const backupName = (
      BACKUP_PREFIX + _timestampForSheetName_()
    ).slice(0, 99);

    const backup = targetResource.sheet
      .copyTo(spreadsheet)
      .setName(backupName);
    backup.hideSheet();

    const backups = spreadsheet
      .getSheets()
      .filter(function(sheet) {
        return sheet.getName().indexOf(BACKUP_PREFIX) === 0;
      })
      .sort(function(a, b) {
        return b.getName().localeCompare(a.getName());
      });

    const backupsToDelete = backups.slice(MAX_BACKUPS);
    backupsToDelete.forEach(function(sheet) {
      spreadsheet.deleteSheet(sheet);
    });

    _mark_(trace, "VE_EQUIVALENCES_BACKUP_CREATED", {
      elapsedMs: Date.now() - startedAt,
      backupName: backupName,
      deletedBackups: backupsToDelete.length,
      keptBackups: Math.min(backups.length, MAX_BACKUPS)
    });

    return backupName;
  }

  function _replaceTargetRows_(targetResource, rows, trace) {
    const startedAt = Date.now();
    const sheet = targetResource.sheet;
    const currentRows = Math.max(0, sheet.getLastRow() - 1);
    const requiredRows = Math.max(2, rows.length + 1);

    if (sheet.getMaxRows() < requiredRows) {
      sheet.insertRowsAfter(
        sheet.getMaxRows(),
        requiredRows - sheet.getMaxRows()
      );
    }

    const clearStartedAt = Date.now();
    if (currentRows > 0) {
      sheet
        .getRange(2, 1, currentRows, TARGET_WIDTH)
        .clearContent();
    }

    _mark_(trace, "VE_EQUIVALENCES_TARGET_CLEARED", {
      elapsedMs: Date.now() - clearStartedAt,
      clearedRows: currentRows
    });

    const writeStartedAt = Date.now();
    if (rows.length > 0) {
      sheet
        .getRange(2, 1, rows.length, TARGET_WIDTH)
        .setValues(rows);
    }

    _mark_(trace, "VE_EQUIVALENCES_TARGET_WRITTEN", {
      elapsedMs: Date.now() - writeStartedAt,
      writtenRows: rows.length,
      width: TARGET_WIDTH
    });

    const flushStartedAt = Date.now();
    SpreadsheetApp.flush();

    _mark_(trace, "VE_EQUIVALENCES_FLUSHED", {
      elapsedMs: Date.now() - flushStartedAt
    });

    _mark_(trace, "VE_EQUIVALENCES_REPLACED", {
      elapsedMs: Date.now() - startedAt,
      previousRows: currentRows,
      writtenRows: rows.length
    });

    return {
      previousRows: currentRows,
      writtenRows: rows.length
    };
  }

  function _clearCaches_(trace) {
    const startedAt = Date.now();
    const result = {
      repository: false,
      service: false,
      warnings: []
    };

    if (
      typeof VerificacionEntradaRepository !== "undefined" &&
      VerificacionEntradaRepository &&
      typeof VerificacionEntradaRepository.clearCache === "function"
    ) {
      result.repository =
        VerificacionEntradaRepository.clearCache() === true;
    } else {
      result.warnings.push("Repository.clearCache no disponible.");
    }

    if (
      typeof VerificacionEntradaService !== "undefined" &&
      VerificacionEntradaService &&
      typeof VerificacionEntradaService.clearCache === "function"
    ) {
      result.service = VerificacionEntradaService.clearCache() === true;
    } else {
      result.warnings.push("Service.clearCache no disponible.");
    }

    _mark_(trace, "VE_CATALOG_CACHES_CLEARED", {
      elapsedMs: Date.now() - startedAt,
      repository: result.repository,
      service: result.service,
      warnings: result.warnings.length
    });

    return result;
  }

  function _prepareAnalysis_(trace) {
    const sourceResource = _assertSourceConfiguration_(trace);
    const targetResource = _assertTargetConfiguration_(trace);
    const sourceRows = _readRows_(
      sourceResource,
      SOURCE_WIDTH,
      trace,
      "VE_CATALOG_SOURCE_READ"
    );
    const analysis = _buildCatalogAnalysis_(sourceRows, trace);

    return {
      sourceResource: sourceResource,
      targetResource: targetResource,
      analysis: analysis
    };
  }

  function preview(trace) {
    const ownTrace = trace || _startTrace_("VE_CATALOG_PREVIEW", {
      write: false
    });

    try {
      _clearRuntimeCache_();
      const prepared = _prepareAnalysis_(ownTrace);
      const analysis = prepared.analysis;

      const activeCandidates = analysis.generatedEquivalences.filter(
        function(item) {
          return item.activo === "SI";
        }
      ).length;

      const result = {
        ok: true,
        writePerformed: false,
        sourceRows: analysis.sourceRows,
        validRows: analysis.validRows,
        excludedRows: analysis.excludedRows,
        exclusionCounts: analysis.exclusionCounts,
        uniqueKeys: analysis.uniqueKeys,
        generatedEquivalences: analysis.generatedEquivalences.length,
        activeCandidates: activeCandidates,
        inactiveCandidates:
          analysis.generatedEquivalences.length - activeCandidates,
        conflicts: analysis.conflicts.length,
        conflictDetails: analysis.conflicts.slice(
          0,
          MAX_CONFLICT_DETAILS
        ),
        sample: analysis.generatedEquivalences
          .slice(0, PREVIEW_SAMPLE_SIZE)
          .map(function(item) {
            return {
              idEquivalencia: item.idEquivalencia,
              rfcEmisor: item.rfcEmisor,
              codigoProveedorXml: item.codigoProveedorXml,
              codigoInterno: item.codigoInterno,
              idProducto: item.idProducto,
              activo: item.activo,
              nivelConfianza: item.nivelConfianza,
              selectedSourceRow: item.selectedSourceRow,
              conflictReasons: item.conflictReasons
            };
          })
      };

      if (!trace) {
        _endTrace_(ownTrace, "ok", {
          sourceRows: result.sourceRows,
          generatedEquivalences: result.generatedEquivalences,
          conflicts: result.conflicts
        });
      }

      return result;
    } catch (error) {
      if (!trace) _failTrace_(ownTrace, error);
      throw error;
    } finally {
      _clearRuntimeCache_();
    }
  }

  function synchronize(options, context, trace) {
    const sourceOptions = options || {};
    const dryRun = sourceOptions.dryRun === true;
    const ownTrace = trace || _startTrace_(
      "VE_CATALOG_SYNCHRONIZE",
      { dryRun: dryRun }
    );

    if (dryRun) {
      return preview(ownTrace);
    }

    const lock = LockService.getScriptLock();
    const lockStartedAt = Date.now();
    let lockAcquired = false;

    try {
      _clearRuntimeCache_();
      _mark_(ownTrace, "VE_CATALOG_LOCK_WAIT_STARTED", {
        timeoutMs: LOCK_TIMEOUT_MS
      });

      lockAcquired = lock.tryLock(LOCK_TIMEOUT_MS);

      if (!lockAcquired) {
        throw new Error(
          "No fue posible obtener el bloqueo para sincronizar equivalencias."
        );
      }

      _mark_(ownTrace, "VE_CATALOG_LOCK_ACQUIRED", {
        elapsedMs: Date.now() - lockStartedAt
      });

      const prepared = _prepareAnalysis_(ownTrace);
      const targetResource = prepared.targetResource;
      const analysis = prepared.analysis;

      const existingRows = _readRows_(
        targetResource,
        TARGET_WIDTH,
        ownTrace,
        "VE_CATALOG_TARGET_READ"
      );

      const merged = _mergePreservingManual_(
        existingRows,
        analysis.generatedEquivalences,
        ownTrace
      );

      const backupName = _createBackup_(targetResource, ownTrace);
      const writeResult = _replaceTargetRows_(
        targetResource,
        merged.rows,
        ownTrace
      );
      const cacheResult = _clearCaches_(ownTrace);
      const user = context || {};

      const result = {
        ok: true,
        writePerformed: true,
        executedBy: _text_(
          user.usuario || user.email || "EJECUCION_MANUAL"
        ),
        sourceRows: analysis.sourceRows,
        validRows: analysis.validRows,
        excludedRows: analysis.excludedRows,
        exclusionCounts: analysis.exclusionCounts,
        uniqueKeys: analysis.uniqueKeys,
        generatedCandidates: analysis.generatedEquivalences.length,
        conflicts: analysis.conflicts.length,
        preservedRows: merged.preservedRows,
        generatedRowsWritten: merged.generatedRows,
        protectedRowsSkipped: merged.skippedProtected.length,
        protectedDetails: merged.skippedProtected.slice(
          0,
          MAX_PROTECTED_DETAILS
        ),
        previousTargetRows: writeResult.previousRows,
        finalTargetRows: writeResult.writtenRows,
        backupSheet: backupName,
        caches: cacheResult
      };

      console.log(
        "[APPALMACEN][VE_CATALOG_SYNC] " +
        JSON.stringify(result)
      );

      if (!trace) {
        _endTrace_(ownTrace, "ok", {
          writtenRows: result.finalTargetRows,
          conflicts: result.conflicts,
          protectedRowsSkipped: result.protectedRowsSkipped
        });
      }

      return result;
    } catch (error) {
      if (!trace) _failTrace_(ownTrace, error);
      throw error;
    } finally {
      if (lockAcquired) {
        lock.releaseLock();
        _mark_(ownTrace, "VE_CATALOG_LOCK_RELEASED");
      }
      _clearRuntimeCache_();
    }
  }

  return Object.freeze({
    preview: preview,
    synchronize: synchronize
  });
})();

/**
 * Vista previa pública. No escribe información.
 */
function testVerificacionEntradaCatalogoPreview() {
  const result = VerificacionEntradaCatalogoService.preview();
  console.log(
    "[TEST][VE_CATALOGO_PREVIEW] " +
    JSON.stringify(result)
  );
  return result;
}

/**
 * Alias público de lectura. No escribe información.
 */
function testVerificacionEntradaCatalogoLectura() {
  return testVerificacionEntradaCatalogoPreview();
}

/**
 * Simula la sincronización. No escribe información.
 */
function simularSincronizacionVerificacionEntradaCatalogo() {
  const result = VerificacionEntradaCatalogoService.synchronize(
    { dryRun: true },
    { usuario: "EJECUCION_MANUAL", rol: "ADMINISTRADOR" }
  );

  console.log(
    "[TEST][VE_CATALOGO_SIMULACION] " +
    JSON.stringify(result)
  );

  return result;
}

/**
 * Sincroniza el catálogo después de validar una vista previa.
 */
function sincronizarVerificacionEntradaCatalogo() {
  const preview = VerificacionEntradaCatalogoService.preview();

  if (!preview || preview.ok !== true) {
    throw new Error("La vista previa del catálogo no fue válida.");
  }
  if (Number(preview.sourceRows || 0) <= 0) {
    throw new Error(
      "VE_CATALOGO_PROVEEDORES no contiene filas de datos."
    );
  }
  if (Number(preview.validRows || 0) <= 0) {
    throw new Error(
      "El catálogo no contiene filas válidas para generar equivalencias."
    );
  }
  if (Number(preview.generatedEquivalences || 0) <= 0) {
    throw new Error("La vista previa no generó equivalencias.");
  }

  const result = VerificacionEntradaCatalogoService.synchronize(
    { dryRun: false },
    { usuario: "EJECUCION_MANUAL", rol: "ADMINISTRADOR" }
  );

  if (!result || result.ok !== true || result.writePerformed !== true) {
    throw new Error(
      "La sincronización no confirmó la escritura en VE_EQUIVALENCIAS."
    );
  }

  console.log(
    "[APPALMACEN][VE_CATALOGO_SYNC_PUBLIC] " +
    JSON.stringify(result)
  );

  return result;
}

/**
 * Verifica componentes de mantenimiento. No escribe información.
 */
function testVerificacionEntradaCatalogoMantenimiento() {
  const result = {
    catalogServiceAvailable:
      typeof VerificacionEntradaCatalogoService !== "undefined" &&
      Boolean(VerificacionEntradaCatalogoService) &&
      typeof VerificacionEntradaCatalogoService.preview === "function" &&
      typeof VerificacionEntradaCatalogoService.synchronize === "function",
    repositoryAvailable:
      typeof VerificacionEntradaRepository !== "undefined" &&
      Boolean(VerificacionEntradaRepository),
    repositoryClearCacheAvailable:
      typeof VerificacionEntradaRepository !== "undefined" &&
      Boolean(VerificacionEntradaRepository) &&
      typeof VerificacionEntradaRepository.clearCache === "function",
    serviceAvailable:
      typeof VerificacionEntradaService !== "undefined" &&
      Boolean(VerificacionEntradaService),
    serviceClearCacheAvailable:
      typeof VerificacionEntradaService !== "undefined" &&
      Boolean(VerificacionEntradaService) &&
      typeof VerificacionEntradaService.clearCache === "function"
  };

  result.ok =
    result.catalogServiceAvailable &&
    result.repositoryAvailable &&
    result.serviceAvailable;

  console.log(
    "[TEST][VE_CATALOGO_MANTENIMIENTO] " +
    JSON.stringify(result)
  );

  return result;
}

/**
 * Limpia cachés sin modificar hojas.
 */
function limpiarCachesVerificacionEntradaCatalogo() {
  const result = {
    repository: false,
    service: false,
    warnings: [],
    errors: []
  };

  try {
    if (
      typeof VerificacionEntradaRepository === "undefined" ||
      !VerificacionEntradaRepository
    ) {
      throw new Error("VerificacionEntradaRepository no está disponible.");
    }

    if (typeof VerificacionEntradaRepository.clearCache !== "function") {
      result.warnings.push(
        "VerificacionEntradaRepository.clearCache no está exportada."
      );
    } else {
      result.repository =
        VerificacionEntradaRepository.clearCache() === true;
    }
  } catch (error) {
    result.errors.push({
      component: "VerificacionEntradaRepository",
      message: error && error.message ? error.message : String(error)
    });
  }

  try {
    if (
      typeof VerificacionEntradaService === "undefined" ||
      !VerificacionEntradaService
    ) {
      throw new Error("VerificacionEntradaService no está disponible.");
    }

    if (typeof VerificacionEntradaService.clearCache !== "function") {
      result.warnings.push(
        "VerificacionEntradaService.clearCache no está exportada."
      );
    } else {
      result.service = VerificacionEntradaService.clearCache() === true;
    }
  } catch (error) {
    result.errors.push({
      component: "VerificacionEntradaService",
      message: error && error.message ? error.message : String(error)
    });
  }

  result.ok =
    result.errors.length === 0 &&
    (result.repository || result.service);

  console.log(
    "[CACHE][VE_CATALOGO] " +
    JSON.stringify(result)
  );

  if (!result.ok) {
    throw new Error(
      "No fue posible limpiar ninguna caché. " +
      JSON.stringify(result.errors)
    );
  }

  return result;
}

/**
 * Diagnostica catálogo y equivalencias de MAXITOR. No escribe información.
 */
function diagnosticarVerificacionEntradaCatalogoMaxitor() {
  const startedAt = Date.now();
  const spreadsheet = SpreadsheetApp.openById(FILES.GESTION2);
  const sourceConfig =
    SHEETS.VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES;
  const targetConfig =
    SHEETS.VERIFICACION_ENTRADA_EQUIVALENCIAS;
  const sourceSheet = spreadsheet.getSheetByName(sourceConfig.name);
  const targetSheet = spreadsheet.getSheetByName(targetConfig.name);

  if (!sourceSheet) {
    throw new Error("No se encontró VE_CATALOGO_PROVEEDORES.");
  }
  if (!targetSheet) {
    throw new Error("No se encontró VE_EQUIVALENCIAS.");
  }

  const expectedRfc = "MAX110907KV1";
  const expectedCodes = [
    "5400600000",
    "5400800000",
    "5400900000"
  ];
  const sourceColumns =
    COL.VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES;
  const targetColumns =
    COL.VERIFICACION_ENTRADA_EQUIVALENCIAS;
  const sourceLastRow = sourceSheet.getLastRow();
  const targetLastRow = targetSheet.getLastRow();
  const sourceRows = sourceLastRow > 1
    ? sourceSheet
        .getRange(2, 1, sourceLastRow - 1, 18)
        .getDisplayValues()
    : [];
  const targetRows = targetLastRow > 1
    ? targetSheet
        .getRange(2, 1, targetLastRow - 1, 23)
        .getDisplayValues()
    : [];

  function normalizeRfc(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "");
  }

  function normalizeCode(value) {
    return String(value || "").trim().toUpperCase();
  }

  const sourceMatches = sourceRows
    .map(function(row, index) {
      return {
        rowNumber: index + 2,
        rfcProveedor: normalizeRfc(row[sourceColumns.RFCPROVEEDOR]),
        codigoProveedorXml: normalizeCode(
          row[sourceColumns.CODIGOPRODUCTOPROVEEDOR]
        ),
        codigoInterno: normalizeCode(
          row[sourceColumns.CODIGOPRODUCTO]
        ),
        idProducto: String(row[sourceColumns.IDPRODUCTO] || "").trim(),
        idProveedor: String(row[sourceColumns.IDPROVEEDOR] || "").trim(),
        statusProducto: String(
          row[sourceColumns.STATUSPRODUCTO] || ""
        ).trim(),
        nombreProducto: String(
          row[sourceColumns.NOMBREPRODUCTO] || ""
        ).trim()
      };
    })
    .filter(function(item) {
      return item.rfcProveedor === expectedRfc &&
        expectedCodes.includes(item.codigoProveedorXml);
    });

  const targetMatches = targetRows
    .map(function(row, index) {
      return {
        rowNumber: index + 2,
        rfcEmisor: normalizeRfc(row[targetColumns.RFCEMISOR]),
        codigoProveedorXml: normalizeCode(
          row[targetColumns.CODIGOPROVEEDORXML]
        ),
        codigoEtiqueta: normalizeCode(
          row[targetColumns.CODIGOETIQUETA]
        ),
        codigoInterno: normalizeCode(
          row[targetColumns.CODIGOINTERNO]
        ),
        idProducto: String(row[targetColumns.IDPRODUCTO] || "").trim(),
        factorConversion: Number(
          row[targetColumns.FACTORCONVERSION] || 0
        ),
        tipoConcepto: normalizeCode(row[targetColumns.TIPOCONCEPTO]),
        activo: normalizeCode(row[targetColumns.ACTIVO]),
        origenRegla: normalizeCode(row[targetColumns.ORIGENREGLA])
      };
    })
    .filter(function(item) {
      return item.rfcEmisor === expectedRfc &&
        expectedCodes.includes(item.codigoProveedorXml);
    })
    .map(function(item) {
      const reasons = [];

      if (!item.codigoInterno) reasons.push("CODIGO_INTERNO_VACIO");
      if (!item.idProducto) reasons.push("ID_PRODUCTO_VACIO");
      if (!(item.factorConversion > 0)) {
        reasons.push("FACTOR_CONVERSION_INVALIDO");
      }
      if (item.tipoConcepto !== "PRODUCTO") {
        reasons.push("TIPO_NO_PRODUCTO");
      }
      if (![
        "SI",
        "SÍ",
        "TRUE",
        "1",
        "ACTIVO"
      ].includes(item.activo)) {
        reasons.push("EQUIVALENCIA_INACTIVA");
      }

      item.aptoParaConteo = reasons.length === 0;
      item.razones = reasons;
      return item;
    });

  const sourceCodes = sourceMatches.map(function(item) {
    return item.codigoProveedorXml;
  });
  const targetCodes = targetMatches.map(function(item) {
    return item.codigoProveedorXml;
  });

  const result = {
    ok: true,
    elapsedMs: Date.now() - startedAt,
    rfc: expectedRfc,
    expectedCodes: expectedCodes,
    catalogo: {
      sheet: sourceConfig.name,
      lastRow: sourceLastRow,
      dataRows: Math.max(0, sourceLastRow - 1),
      matches: sourceMatches,
      missingCodes: expectedCodes.filter(function(code) {
        return !sourceCodes.includes(code);
      })
    },
    equivalencias: {
      sheet: targetConfig.name,
      lastRow: targetLastRow,
      dataRows: Math.max(0, targetLastRow - 1),
      matches: targetMatches,
      aptosParaConteo: targetMatches.filter(function(item) {
        return item.aptoParaConteo;
      }).length,
      missingCodes: expectedCodes.filter(function(code) {
        return !targetCodes.includes(code);
      })
    }
  };

  console.log(
    "[DIAGNOSTICO][VE_CATALOGO_MAXITOR] " +
    JSON.stringify(result)
  );

  return result;
}
