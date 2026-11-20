/**
 * z3-UbicacionesSurtidoCodificacionService.gs
 *
 * @fileoverview Codificación detallada de UBICACIONES_SURTIDO.
 *
 * PROPÓSITO
 * ─────────
 * Cada producto de UBICACIONES_SURTIDO tiene una ubicación preliminar
 * (ZONA + PASILLO, p. ej. "B1 - P2"). Esta capa permite asignarle su
 * ubicación detallada con el catálogo de áreas de suministro de APPALMACEN4
 * (hoja UBICACIONES):
 *
 *   BODEGA_CLAVE  →  AREASUMINISTRO_CLAVE  →  NIVEL  →  BIN
 *        B1                  P2                  3        4
 *   Código (columna AREADESUMINISTRO) = DIRECCION del catálogo + "/" + BIN
 *        "BIR/ALM/B1/P2/N03" + "/B04"  =  "BIR/ALM/B1/P2/N03/B04"
 *
 * SEGMENTACIÓN (cómo se arma el listado pendiente)
 * ────────────
 * 1. Se elige una bodega del catálogo (BODEGA_NOMBRE → BODEGA_CLAVE).
 * 2. Su ZONA en UBICACIONES_SURTIDO sale de ZONA_POR_BODEGA_CLAVE
 *    (1 = B1, 2 = B2, 3 = B3, 4 = MOS, 5 = CU).
 * 3. Las filas de esa ZONA se agrupan por PASILLO; cada pasillo es un
 *    segmento ("área de suministro igual al pasillo": PASILLO 2 → P2).
 *    Las filas sin PASILLO forman el segmento SIN_PASILLO.
 * 4. Una fila está "codificada" cuando tiene AREADESUMINISTRO.
 *
 * VALORES ELEGIBLES (validados también en el servidor)
 * ─────────────────
 * - Área: cualquier AREASUMINISTRO_CLAVE de la bodega en el catálogo. Por
 *   omisión se sugiere la del pasillo del segmento, si existe.
 * - Nivel: solo los niveles que el catálogo tiene para bodega + área.
 * - BIN: entero entre BIN_MIN y BIN_MAX.
 * - Una fila puede guardarse completa (4 valores) o vacía (limpia la captura).
 *
 * CÓDIGOS REPETIDOS
 * ─────────────────
 * Un mismo código (mismo nivel y BIN) asignado a varios productos no se
 * bloquea (un BIN puede alojar varios SKU), pero se informa como advertencia
 * para revisarlo.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version UBICACIONES-SURTIDO-CODIFICACION-SERVICE-2026-11-20-01
 */

const UbicacionesSurtidoCodificacionService = (() => {
  "use strict";

  const CFG = UBICACIONES_SURTIDO_CODIFICACION_CONFIG;
  const ERR = CFG.ERROR_CODES;

  // ==========================================================================
  // INFRAESTRUCTURA
  // ==========================================================================

  /** Error de dominio con código público ("[CODIGO] mensaje" en el Controller). @private */
  function domainError_(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  /** Comparador natural en español (P2 antes que P10). @private */
  const collator_ = typeof Intl !== "undefined" && Intl.Collator
    ? new Intl.Collator("es-MX", { numeric: true, sensitivity: "base" })
    : null;
  function compare_(a, b) {
    const left = String(a == null ? "" : a);
    const right = String(b == null ? "" : b);
    return collator_ ? collator_.compare(left, right) : left.localeCompare(right);
  }

  /** "B" + BIN con BIN_DIGITOS dígitos (4 → "B04"). @private */
  function binCode_(bin) {
    return CFG.BIN_PREFIJO + String(bin).padStart(CFG.BIN_DIGITOS, "0");
  }

  /** Clave del segmento de una fila: el PASILLO o SIN_PASILLO. @private */
  function segmentOf_(row) {
    const pasillo = toStr_(row.pasillo);
    return pasillo ? pasillo : CFG.SEGMENTO_SIN_PASILLO;
  }

  // ==========================================================================
  // CATÁLOGO DE ÁREAS DE SUMINISTRO
  // ==========================================================================

  /**
   * Catálogo agrupado por bodega → área → nivel. Se guarda en CacheService
   * (CACHE_TTL_SECONDS) porque UBICACIONES cambia poco; forceRefresh lo relee.
   *
   * @param {Object=} trace Traza activa.
   * @param {boolean=} forceRefresh true = ignora la caché.
   * @return {!Array<{nombre:string, clave:string, zona:string,
   *     areas:!Array<{clave:string, nombre:string, clase:string,
   *     niveles:!Array<{nivel:number, clave:string, direccion:string}>}>}>}
   * @private
   */
  function readCatalog_(trace, forceRefresh) {
    if (!forceRefresh) {
      const cached = cacheGetChunked_(CFG.CATALOGO_CACHE_KEY);
      if (Array.isArray(cached)) {
        perfMark_(trace, "UBICSURT_CATALOGO_CACHE_HIT", { bodegas: cached.length });
        return cached;
      }
    }
    const byWarehouse = new Map();
    UbicacionesSurtidoCodificacionRepository.getCatalogo(trace).forEach(function(row) {
      if (!byWarehouse.has(row.bodegaClave)) {
        byWarehouse.set(row.bodegaClave, {
          nombre: row.bodegaNombre || row.bodegaClave,
          clave: row.bodegaClave,
          zona: toStr_(CFG.ZONA_POR_BODEGA_CLAVE[row.bodegaClave] || ""),
          areas: new Map()
        });
      }
      const warehouse = byWarehouse.get(row.bodegaClave);
      if (!warehouse.areas.has(row.areaClave)) {
        warehouse.areas.set(row.areaClave, { clave: row.areaClave, nombre: row.areaNombre, clase: row.areaClase, niveles: [] });
      }
      warehouse.areas.get(row.areaClave).niveles.push({ nivel: row.nivel, clave: row.nivelClave, direccion: row.direccion });
    });
    const catalog = Array.from(byWarehouse.values())
      .map(function(warehouse) {
        return {
          nombre: warehouse.nombre,
          clave: warehouse.clave,
          zona: warehouse.zona,
          areas: Array.from(warehouse.areas.values())
            .map(function(area) {
              area.niveles.sort(function(a, b) { return a.nivel - b.nivel; });
              return area;
            })
            .sort(function(a, b) { return compare_(a.clave, b.clave); })
        };
      })
      .sort(function(a, b) { return compare_(a.clave, b.clave); });
    cachePutChunked_(CFG.CATALOGO_CACHE_KEY, catalog, CFG.CACHE_TTL_SECONDS);
    return catalog;
  }

  /** Bodega del catálogo o error. @private */
  function warehouseOf_(catalog, clave) {
    const key = toStrUpper_(clave);
    const warehouse = catalog.find(function(item) { return item.clave === key; });
    if (!warehouse) throw domainError_(ERR.BODEGA_INVALIDA, "La bodega " + (key || "(vacía)") + " no existe en el catálogo de UBICACIONES.");
    if (!warehouse.zona) throw domainError_(ERR.BODEGA_INVALIDA, "La bodega " + key + " no tiene ZONA asignada en UBICACIONES_SURTIDO (ver ZONA_POR_BODEGA_CLAVE).");
    return warehouse;
  }

  /** Descripciones de CATALOGO por código (CacheService). @private */
  function readDescriptions_(trace) {
    const cached = cacheGetChunked_(CFG.DESCRIPCIONES_CACHE_KEY);
    if (cached && typeof cached === "object") return cached;
    const map = {};
    if (typeof CatalogoRepository !== "undefined" && typeof CatalogoRepository.getAllRaw === "function") {
      CatalogoRepository.getAllRaw().forEach(function(product) {
        const code = toStrUpper_(product && product.codigo);
        if (code && !map[code]) map[code] = toStrUpper_(product.descripcion);
      });
    }
    cachePutChunked_(CFG.DESCRIPCIONES_CACHE_KEY, map, CFG.CACHE_TTL_SECONDS);
    perfMark_(trace, "UBICSURT_DESCRIPCIONES_READ", { codigos: Object.keys(map).length });
    return map;
  }

  // ==========================================================================
  // CONSULTAS PÚBLICAS
  // ==========================================================================

  /**
   * Catálogo para los selectores de la vista.
   *
   * @param {{forceRefresh?:boolean}=} payload
   * @return {{bodegas:!Array<!Object>, bin:{min:number, max:number, prefijo:string, digitos:number}}}
   */
  function getCatalog(payload) {
    const trace = perfStart_("UBICSURT_GET_CATALOGO", {});
    try {
      const catalog = readCatalog_(trace, Boolean(payload && payload.forceRefresh === true));
      perfEnd_(trace, "ok", { bodegas: catalog.length });
      return {
        bodegas: catalog,
        bin: { min: CFG.BIN_MIN, max: CFG.BIN_MAX, prefijo: CFG.BIN_PREFIJO, digitos: CFG.BIN_DIGITOS },
        segmentoSinPasillo: CFG.SEGMENTO_SIN_PASILLO
      };
    } catch (error) {
      perfEnd_(trace, "error", { message: error && error.message });
      throw error;
    }
  }

  /**
   * Segmentos (pasillos) de una bodega con su avance y, si se indica, las
   * filas de un segmento.
   *
   * @param {{bodegaClave:string, segmento?:string}} payload
   * @param {Object=} existingTrace Traza activa (cuando lo llama guardar()).
   * @return {!Object} {bodega, zona, resumen, segmentos[], filas[]|null, fueraDeZona}
   */
  function getSegment(payload, existingTrace) {
    const trace = existingTrace || perfStart_("UBICSURT_GET_SEGMENTO", {});
    try {
      const input = payload && typeof payload === "object" ? payload : {};
      const catalog = readCatalog_(trace, false);
      const warehouse = warehouseOf_(catalog, input.bodegaClave);
      const segmentKey = toStr_(input.segmento);
      const allRows = UbicacionesSurtidoCodificacionRepository.getFilas(trace);
      const mappedZones = Object.keys(CFG.ZONA_POR_BODEGA_CLAVE).map(function(key) { return CFG.ZONA_POR_BODEGA_CLAVE[key]; });
      const zoneRows = allRows.filter(function(row) { return row.zona === warehouse.zona; });

      // Segmentos por PASILLO con avance.
      const segments = new Map();
      zoneRows.forEach(function(row) {
        const key = segmentOf_(row);
        if (!segments.has(key)) segments.set(key, { clave: key, total: 0, codificadas: 0 });
        const segment = segments.get(key);
        segment.total += 1;
        if (row.codigoArea) segment.codificadas += 1;
      });
      const areaKeys = new Set(warehouse.areas.map(function(area) { return area.clave; }));
      const segmentList = Array.from(segments.values())
        .map(function(segment) {
          const suggested = segment.clave === CFG.SEGMENTO_SIN_PASILLO ? "" : CFG.PREFIJO_AREA_PASILLO + Number(segment.clave);
          return Object.assign(segment, {
            nombre: segment.clave === CFG.SEGMENTO_SIN_PASILLO ? "SIN PASILLO" : "PASILLO " + segment.clave,
            areaSugerida: suggested && areaKeys.has(suggested) ? suggested : "",
            pendientes: segment.total - segment.codificadas
          });
        })
        .sort(function(a, b) {
          if (a.clave === CFG.SEGMENTO_SIN_PASILLO) return 1;
          if (b.clave === CFG.SEGMENTO_SIN_PASILLO) return -1;
          return compare_(a.clave, b.clave);
        });

      const summary = {
        total: zoneRows.length,
        codificadas: zoneRows.filter(function(row) { return row.codigoArea; }).length
      };
      summary.pendientes = summary.total - summary.codificadas;

      let rows = null;
      let codesInUse = {};
      if (segmentKey) {
        const descriptions = readDescriptions_(trace);
        rows = zoneRows
          .filter(function(row) { return segmentOf_(row) === segmentKey; })
          .map(function(row) {
            return Object.assign({}, row, { descripcion: descriptions[row.codigo] || "" });
          })
          .sort(function(a, b) { return compare_(a.ubicacion, b.ubicacion) || compare_(a.codigo, b.codigo); });
        // Códigos ya usados en la bodega (para advertir repetidos en la vista).
        const prefix = "/" + warehouse.clave + "/";
        allRows.forEach(function(row) {
          if (!row.codigoArea || row.codigoArea.indexOf(prefix) === -1) return;
          (codesInUse[row.codigoArea] = codesInUse[row.codigoArea] || []).push(row.codigo);
        });
      }

      const result = {
        bodega: { clave: warehouse.clave, nombre: warehouse.nombre, zona: warehouse.zona },
        resumen: summary,
        segmentos: segmentList,
        segmento: segmentKey || "",
        filas: rows,
        codigosEnUso: codesInUse,
        fueraDeZona: allRows.filter(function(row) { return mappedZones.indexOf(row.zona) === -1; }).length,
        totalHoja: allRows.length
      };
      if (!existingTrace) perfEnd_(trace, "ok", { filas: rows ? rows.length : 0 });
      return result;
    } catch (error) {
      if (!existingTrace) perfEnd_(trace, "error", { message: error && error.message });
      throw error;
    }
  }

  // ==========================================================================
  // GUARDADO
  // ==========================================================================

  /**
   * Valida una fila capturada contra el catálogo y arma los valores a escribir.
   *
   * @param {!Object} warehouse Bodega del catálogo.
   * @param {!Object} input {rowNumber, codigo, areaClave, nivel, bin}.
   * @return {{rowNumber:number, codigo:string, valores:!Object, codigoArea:string}}
   * @private
   */
  function buildCapture_(warehouse, input) {
    const rowNumber = Number(input.rowNumber);
    const codigo = toStrUpper_(input.codigo);
    if (!Number.isInteger(rowNumber) || rowNumber < 2 || !codigo) {
      throw domainError_(ERR.PAYLOAD_INVALIDO, "Cada fila requiere número de fila y código.");
    }
    const areaClave = toStrUpper_(input.areaClave);
    const nivelText = toStr_(input.nivel);
    const binText = toStr_(input.bin);

    // Fila vacía: limpia la captura.
    if (!areaClave && !nivelText && !binText) {
      return {
        rowNumber: rowNumber,
        codigo: codigo,
        codigoArea: "",
        valores: { BODEGA_CLAVE: "", AREASUMINISTRO_CLAVE: "", NIVEL: "", AREADESUMINISTRO: "", BIN: "" }
      };
    }
    const area = warehouse.areas.find(function(item) { return item.clave === areaClave; });
    if (!area) throw domainError_(ERR.AREA_INVALIDA, codigo + ": el área " + (areaClave || "(vacía)") + " no existe en " + warehouse.nombre + ".");
    const nivel = Number(nivelText);
    const level = area.niveles.find(function(item) { return item.nivel === nivel; });
    if (!level) throw domainError_(ERR.NIVEL_INVALIDO, codigo + ": el nivel " + (nivelText || "(vacío)") + " no existe en " + warehouse.clave + " / " + areaClave + ".");
    const bin = Number(binText);
    if (!Number.isInteger(bin) || bin < CFG.BIN_MIN || bin > CFG.BIN_MAX) {
      throw domainError_(ERR.BIN_INVALIDO, codigo + ": el BIN debe ser un número entero de " + CFG.BIN_MIN + " a " + CFG.BIN_MAX + ".");
    }
    const codigoArea = level.direccion + "/" + binCode_(bin);
    return {
      rowNumber: rowNumber,
      codigo: codigo,
      codigoArea: codigoArea,
      valores: {
        BODEGA_CLAVE: warehouse.clave,
        AREASUMINISTRO_CLAVE: areaClave,
        NIVEL: nivel,
        AREADESUMINISTRO: codigoArea,
        BIN: bin
      }
    };
  }

  /**
   * Guarda la captura de varias filas y devuelve el segmento actualizado.
   *
   * @param {{bodegaClave:string, segmento:string, filas:!Array<{rowNumber:number,
   *     codigo:string, areaClave:string, nivel:(number|string), bin:(number|string)}>}} payload
   * @return {{guardadas:number, limpiadas:number, advertencias:!Array<string>, vista:!Object}}
   */
  function save(payload) {
    const trace = perfStart_("UBICSURT_GUARDAR", {});
    try {
      const input = payload && typeof payload === "object" ? payload : {};
      const rows = Array.isArray(input.filas) ? input.filas : [];
      if (!rows.length) throw domainError_(ERR.PAYLOAD_INVALIDO, "No hay filas por guardar.");
      if (rows.length > CFG.MAX_FILAS_POR_GUARDADO) {
        throw domainError_(ERR.LIMITE_FILAS, "Guarda como máximo " + CFG.MAX_FILAS_POR_GUARDADO + " filas a la vez.");
      }
      const catalog = readCatalog_(trace, false);
      const warehouse = warehouseOf_(catalog, input.bodegaClave);
      const seen = new Set();
      const captures = rows.map(function(row) {
        const capture = buildCapture_(warehouse, row || {});
        if (seen.has(capture.rowNumber)) throw domainError_(ERR.PAYLOAD_INVALIDO, "La fila " + capture.rowNumber + " viene repetida.");
        seen.add(capture.rowNumber);
        return capture;
      });
      perfMark_(trace, "UBICSURT_CAPTURA_VALIDADA", { filas: captures.length });

      const written = withScriptLock_("UBICSURT_GUARDAR", function() {
        return UbicacionesSurtidoCodificacionRepository.writeCapturaUnderLock(captures, trace);
      }, CFG.LOCK_TIMEOUT_MS, trace);

      // El repositorio de ubicaciones de Reabastecimiento lee la misma hoja.
      if (typeof UbicacionesSurtidoRepository !== "undefined" && typeof UbicacionesSurtidoRepository.clearCache === "function") {
        UbicacionesSurtidoRepository.clearCache();
      }
      UbicacionesSurtidoCodificacionRepository.clearCache();

      const view = getSegment({ bodegaClave: warehouse.clave, segmento: input.segmento }, trace);
      const warnings = [];
      captures.forEach(function(capture) {
        if (!capture.codigoArea) return;
        const owners = (view.codigosEnUso[capture.codigoArea] || []).filter(function(code) { return code !== capture.codigo; });
        if (owners.length) warnings.push(capture.codigoArea + " también está asignado a " + owners.join(", ") + ".");
      });
      perfEnd_(trace, "ok", { filas: written.filas });
      return {
        guardadas: captures.filter(function(capture) { return capture.codigoArea; }).length,
        limpiadas: captures.filter(function(capture) { return !capture.codigoArea; }).length,
        advertencias: warnings,
        vista: view
      };
    } catch (error) {
      perfEnd_(trace, "error", { message: error && error.message });
      throw error;
    }
  }

  return Object.freeze({
    getCatalogo: getCatalog,
    getSegmento: getSegment,
    guardar: save,
    /** Solo pruebas: código del BIN. */
    _binCode: binCode_
  });
})();
