/**
 * VerificacionEntradaRepository.gs
 * Persistencia optimizada del módulo Verificación de entrada.
 *
 * Mejoras:
 * - Búsqueda selectiva con TextFinder por IDSESION e identificadores.
 * - Lectura agrupada de filas contiguas.
 * - Actualización directa por rowNumber conocido.
 * - Actualización agrupada de VE_DETALLE.
 * - Detección de HASH/UUID con una sola lectura.
 * - Escrituras por lote para cajas y eventos.
 * - Trazabilidad por estrategia de lectura y escritura.
 */
const VerificacionEntradaRepository = (() => {
  "use strict";

  const KEYS = Object.freeze({
    SESIONES: "VERIFICACION_ENTRADA_SESIONES",
    DETALLE: "VERIFICACION_ENTRADA_DETALLE",
    CAJAS: "VERIFICACION_ENTRADA_CAJAS",
    EVENTOS: "VERIFICACION_ENTRADA_EVENTOS",
    EQUIVALENCIAS: "VERIFICACION_ENTRADA_EQUIVALENCIAS"
  });

  const HEADERS_BY_KEY = Object.freeze({
    VERIFICACION_ENTRADA_SESIONES: VERIFICACION_ENTRADA_HEADERS.SESIONES,
    VERIFICACION_ENTRADA_DETALLE: VERIFICACION_ENTRADA_HEADERS.DETALLE,
    VERIFICACION_ENTRADA_CAJAS: VERIFICACION_ENTRADA_HEADERS.CAJAS,
    VERIFICACION_ENTRADA_EVENTOS: VERIFICACION_ENTRADA_HEADERS.EVENTOS,
    VERIFICACION_ENTRADA_EQUIVALENCIAS: VERIFICACION_ENTRADA_HEADERS.EQUIVALENCIAS
  });

  const COL_BY_KEY = Object.freeze({
    VERIFICACION_ENTRADA_SESIONES: COL.VERIFICACION_ENTRADA_SESIONES,
    VERIFICACION_ENTRADA_DETALLE: COL.VERIFICACION_ENTRADA_DETALLE,
    VERIFICACION_ENTRADA_CAJAS: COL.VERIFICACION_ENTRADA_CAJAS,
    VERIFICACION_ENTRADA_EVENTOS: COL.VERIFICACION_ENTRADA_EVENTOS,
    VERIFICACION_ENTRADA_EQUIVALENCIAS: COL.VERIFICACION_ENTRADA_EQUIVALENCIAS
  });

  const CONFIG_CACHE_KEY = "VE_REPOSITORY_CONFIG_V4";
  const EQUIVALENCE_GENERATION_KEY = "VE_EQUIVALENCES_GENERATION_V2";
  const CONFIG_CACHE_TTL_SECONDS = 21600;
  const EQUIVALENCE_CACHE_TTL_SECONDS = 600;
  const CACHE_VALUE_MAX_CHARS = 90000;

  let configurationValidated_ = false;
  let equivalenceGeneration_ = "";

  function _width_(key) {
    const width = Number(VERIFICACION_ENTRADA_EXPECTED_WIDTHS[key] || 0);
    if (!Number.isInteger(width) || width <= 0) {
      throw new Error("Ancho no configurado para la hoja: " + key);
    }
    return width;
  }

  function _columns_(key) {
    const value = COL_BY_KEY[key];
    if (!value) throw new Error("No existe configuración de columnas para: " + key);
    return value;
  }

  function _headers_(key) {
    const value = HEADERS_BY_KEY[key];
    if (!Array.isArray(value)) throw new Error("No existe contrato de encabezados para: " + key);
    return value;
  }

  function _text_(value) { return toStr_(value); }

  function _upper_(value) { return toStrUpper_(value); }

  function _number_(value) { return toNum_(value); }

  function _date_(value) { return value instanceof Date && !isNaN(value.getTime()) ? value : (value || ""); }

  function _boolean_(value) {
    if (value === true) return true;
    if (value === false) return false;
    return ["SI", "SÍ", "TRUE", "VERDADERO", "1", "ACTIVO"].includes(_upper_(value));
  }

  function _json_(value, maxLength) {
    if (value === null || value === undefined || value === "") return "";
    let text = "";
    try { text = typeof value === "string" ? value : JSON.stringify(value); } catch (error) { text = ""; }
    const limit = Math.max(1, Number(maxLength || VERIFICACION_ENTRADA.LIMITES.METADATA_JSON_MAX_LENGTH || 5000));
    return text.length > limit ? text.slice(0, limit) : text;
  }

  function _blank_(key) { return new Array(_width_(key)).fill(""); }

  function _assertUniqueColumns_(key) {
    const columns = _columns_(key);
    const width = _width_(key);
    const seen = {};
    const indexes = Object.keys(columns).map(function(name) { return columns[name]; });
    indexes.forEach(function(index) {
      if (!Number.isInteger(index) || index < 0 || index >= width) throw new Error("Índice inválido en " + key + ": " + index);
      if (seen[index]) throw new Error("Índice repetido en " + key + ": " + index);
      seen[index] = true;
    });
    if (indexes.length !== width) throw new Error("Columnas configuradas distintas al ancho de " + key + ".");
  }

  function _assertSheet_(key, trace) {
    const startedAt = Date.now();
    const config = SHEETS[key];
    if (!config) throw new Error("No existe SHEETS." + key);
    if (config.file !== "GESTION2") throw new Error("La hoja " + key + " debe usar GESTION2.");
    const width = _width_(key);
    const headers = _headers_(key);
    if (headers.length !== width) throw new Error("Encabezados y ancho no coinciden en " + key + ".");
    _assertUniqueColumns_(key);
    const sheet = getSheetByKey_(key, trace);
    if (sheet.getLastColumn() !== width) throw new Error("Ancho físico incorrecto en " + key + ".");
    const actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(_upper_);
    const mismatches = [];
    headers.forEach(function(header, index) {
      if (actual[index] !== _upper_(header)) mismatches.push({ column: index + 1, expected: _upper_(header), actual: actual[index] });
    });
    if (mismatches.length) throw new Error("Encabezados incorrectos en " + key + ": " + JSON.stringify(mismatches.slice(0, 10)));
    perfMark_(trace, "VE_REPOSITORY_SHEET_CONFIG_VALIDATED", { sheetKey: key, elapsedMs: Date.now() - startedAt, width: width });
    return true;
  }

  function _scriptCache_() {
    return CacheService.getScriptCache();
  }

  function _equivalenceGeneration_() {
    if (equivalenceGeneration_) return equivalenceGeneration_;

    const cache = _scriptCache_();
    let generation = cache.get(EQUIVALENCE_GENERATION_KEY);

    if (!generation) {
      generation = String(Date.now());
      cache.put(
        EQUIVALENCE_GENERATION_KEY,
        generation,
        CONFIG_CACHE_TTL_SECONDS
      );
    }

    equivalenceGeneration_ = generation;
    return generation;
  }

  function _cacheKeyForEquivalence_(rfc, label) {
    const raw = [
      _equivalenceGeneration_(),
      _upper_(rfc),
      _upper_(label)
    ].join("|");

    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      raw,
      Utilities.Charset.UTF_8
    );

    return "VE_EQ_LABEL_V2_" +
      Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "");
  }

  function assertConfiguration(trace) {
    if (configurationValidated_) {
      perfMark_(trace, "VE_REPOSITORY_CONFIG_CACHE_HIT", {
        sheets: Object.keys(KEYS).length,
        strategy: "EXECUTION_MEMORY"
      });
      return true;
    }

    const cache = _scriptCache_();

    if (cache.get(CONFIG_CACHE_KEY) === "OK") {
      configurationValidated_ = true;
      perfMark_(trace, "VE_REPOSITORY_CONFIG_SCRIPT_CACHE_HIT", {
        sheets: Object.keys(KEYS).length,
        strategy: "SCRIPT_CACHE"
      });
      return true;
    }

    const startedAt = Date.now();

    Object.keys(KEYS).forEach(function(name) {
      _assertSheet_(KEYS[name], trace);
    });

    configurationValidated_ = true;
    cache.put(
      CONFIG_CACHE_KEY,
      "OK",
      CONFIG_CACHE_TTL_SECONDS
    );

    perfMark_(trace, "VE_REPOSITORY_CONFIG_VALIDATED", {
      elapsedMs: Date.now() - startedAt,
      sheets: Object.keys(KEYS).length,
      strategy: "PHYSICAL_VALIDATION"
    });

    return true;
  }

  function _mapSesion_(r, n) { 
    const c = COL.VERIFICACION_ENTRADA_SESIONES; 
      return {
      rowNumber:Number(n||0),
      idSesion:_text_(r[c.IDSESION]),
      hashXml:_text_(r[c.HASHXML]),
      uuidCfdi:_upper_(r[c.UUIDCFDI]),
      rfcEmisor:_upper_(r[c.RFCEMISOR]),
      nombreEmisor:_text_(r[c.NOMBREEMISOR]),
      serie:_upper_(r[c.SERIE]),
      folio:_text_(r[c.FOLIO]),
      fechaCfdi:_date_(r[c.FECHACFDI]),
      versionCfdi:_text_(r[c.VERSIONCFDI]),
      tipoComprobante:_upper_(r[c.TIPOCOMPROBANTE]),
      moneda:_upper_(r[c.MONEDA]),
      nombreArchivo:_text_(r[c.NOMBREARCHIVO]),
      estrategiaEtiqueta:_upper_(r[c.ESTRATEGIAETIQUETA]),
      estadoSesion:_upper_(r[c.ESTADOSESION]),
      totalSkus:_number_(r[c.TOTALSKUS]),
      totalConceptos:_number_(r[c.TOTALCONCEPTOS]),
      conceptosExcluidos:_number_(r[c.CONCEPTOSEXCLUIDOS]),
      cantidadEsperada:_number_(r[c.CANTIDADESPERADA]),
      cantidadCapturada:_number_(r[c.CANTIDADCAPTURADA]),
      cantidadFaltante:_number_(r[c.CANTIDADFALTANTE]),
      cantidadSobrante:_number_(r[c.CANTIDADSOBRANTE]),
      totalCajas:_number_(r[c.TOTALCAJAS]),
      iniciadaPor:_text_(r[c.INICIADAPOR]),
      fechaInicio:_date_(r[c.FECHAINICIO]),
      horaInicio:_date_(r[c.HORAINICIO]),
      fechaCierre:_date_(r[c.FECHACIERRE]),
      horaCierre:_date_(r[c.HORACIERRE]),
      cerradaPor:_text_(r[c.CERRADAPOR]),
      segundosActivos:_number_(r[c.SEGUNDOSACTIVOS]),
      segundosPausados:_number_(r[c.SEGUNDOSPAUSADOS]),
      observacionCierre:_text_(r[c.OBSERVACIONCIERRE]),
      resultadoFinal:_upper_(r[c.RESULTADOFINAL]),
      versionPerfil:_text_(r[c.VERSIONPERFIL]),
      creadoEn:_date_(r[c.CREADOEN]),
      actualizadoEn:_date_(r[c.ACTUALIZADOEN])
    }; }

  function _mapDetalle_(r,n){
    const c=COL.VERIFICACION_ENTRADA_DETALLE;
      return{
      rowNumber:Number(n||0),
      idDetalle:_text_(r[c.IDDETALLE]),
      idSesion:_text_(r[c.IDSESION]),
      rfcEmisor:_upper_(r[c.RFCEMISOR]),
      codigoProveedorXml:_upper_(r[c.CODIGOPROVEEDORXML]),
      codigoInterno:_upper_(r[c.CODIGOINTERNO]),
      idProducto:_text_(r[c.IDPRODUCTO]),
      descripcionXml:_text_(r[c.DESCRIPCIONXML]),
      descripcionInterna:_text_(r[c.DESCRIPCIONINTERNA]),
      claveProdServ:_upper_(r[c.CLAVEPRODSERV]),
      claveUnidadXml:_upper_(r[c.CLAVEUNIDADXML]),
      unidadXml:_upper_(r[c.UNIDADXML]),
      unidadInterna:_upper_(r[c.UNIDADINTERNA]),
      factorConversion:_number_(r[c.FACTORCONVERSION]),
      cantidadXml:_number_(r[c.CANTIDADXML]),
      cantidadEsperada:_number_(r[c.CANTIDADESPERADA]),
      cantidadCapturada:_number_(r[c.CANTIDADCAPTURADA]),
      cantidadFaltante:_number_(r[c.CANTIDADFALTANTE]),
      cantidadSobrante:_number_(r[c.CANTIDADSOBRANTE]),
      totalCajas:_number_(r[c.TOTALCAJAS]),
      estadoSku:_upper_(r[c.ESTADOSKU]),
      clasificacion:_upper_(r[c.CLASIFICACION]),
      incluirEnConteo:_boolean_(r[c.INCLUIRENCONTEO]),
      confianzaClasificacion:_upper_(r[c.CONFIANZACLASIFICACION]),
      motivoExclusion:_text_(r[c.MOTIVOEXCLUSION]),
      renglonesOriginales:_json_(r[c.RENGLONESORIGINALES]),
      requiereRevision:_boolean_(r[c.REQUIEREREVISION]),
      observacion:_text_(r[c.OBSERVACION]),
      creadoEn:_date_(r[c.CREADOEN]),
      actualizadoEn:_date_(r[c.ACTUALIZADOEN])
    };}

  function _mapCaja_(r,n){
    const c=COL.VERIFICACION_ENTRADA_CAJAS;
      return{
      rowNumber:Number(n||0),
      idUnicoCaja:_text_(r[c.IDUNICOCAJA]),
      idSesion:_text_(r[c.IDSESION]),
      idDetalle:_text_(r[c.IDDETALLE]),
      rfcEmisor:_upper_(r[c.RFCEMISOR]),
      codigoProveedorXml:_upper_(r[c.CODIGOPROVEEDORXML]),
      codigoEtiqueta:_upper_(r[c.CODIGOETIQUETA]),
      codigoInterno:_upper_(r[c.CODIGOINTERNO]),
      idProducto:_text_(r[c.IDPRODUCTO]),
      cantidadCaja:_number_(r[c.CANTIDADCAJA]),
      unidad:_upper_(r[c.UNIDAD]),
      consecutivoProveedor:_text_(r[c.CONSECUTIVOPROVEEDOR]),
      estrategiaEtiqueta:_upper_(r[c.ESTRATEGIAETIQUETA]),
      huellaLectura:_text_(r[c.HUELLALECTURA]),
      longitudLectura:_number_(r[c.LONGITUDLECTURA]),
      estadoCaja:_upper_(r[c.ESTADOCAJA]),
      resultadoValidacion:_upper_(r[c.RESULTADOVALIDACION]),
      advertencias:_json_(r[c.ADVERTENCIAS]),
      capturadaPor:_text_(r[c.CAPTURADAPOR]),
      fechaCaptura:_date_(r[c.FECHACAPTURA]),
      horaCaptura:_date_(r[c.HORACAPTURA]),
      canceladaPor:_text_(r[c.CANCELADAPOR]),
      fechaCancelacion:_date_(r[c.FECHACANCELACION]),
      horaCancelacion:_date_(r[c.HORACANCELACION]),
      motivoCancelacion:_text_(r[c.MOTIVOCANCELACION]),
      observacion:_text_(r[c.OBSERVACION]),
      creadoEn:_date_(r[c.CREADOEN])
    };}

  function _mapEvento_(r,n){const c=COL.VERIFICACION_ENTRADA_EVENTOS;return{
    rowNumber:Number(n||0),idEvento:_text_(r[c.IDEVENTO]),idSesion:_text_(r[c.IDSESION]),tipoEvento:_upper_(r[c.TIPOEVENTO]),idUnicoCaja:_text_(r[c.IDUNICOCAJA]),idDetalle:_text_(r[c.IDDETALLE]),codigoInterno:_upper_(r[c.CODIGOINTERNO]),cantidad:_number_(r[c.CANTIDAD]),estadoAnterior:_upper_(r[c.ESTADOANTERIOR]),estadoNuevo:_upper_(r[c.ESTADONUEVO]),resultado:_upper_(r[c.RESULTADO]),codigoMotivo:_upper_(r[c.CODIGOMOTIVO]),mensaje:_text_(r[c.MENSAJE]),usuario:_text_(r[c.USUARIO]),rolUsuario:_upper_(r[c.ROLUSUARIO]),fecha:_date_(r[c.FECHA]),hora:_date_(r[c.HORA]),timestampMs:_number_(r[c.TIMESTAMPMS]),metadataJson:_json_(r[c.METADATAJSON]),creadoEn:_date_(r[c.CREADOEN])
  };}

  function _mapEquivalencia_(r,n){const c=COL.VERIFICACION_ENTRADA_EQUIVALENCIAS;return{
    rowNumber:Number(n||0),idEquivalencia:_text_(r[c.IDEQUIVALENCIA]),rfcEmisor:_upper_(r[c.RFCEMISOR]),idProveedor:_text_(r[c.IDPROVEEDOR]),codigoProveedorXml:_upper_(r[c.CODIGOPROVEEDORXML]),codigoEtiqueta:_upper_(r[c.CODIGOETIQUETA]),codigoInterno:_upper_(r[c.CODIGOINTERNO]),idProducto:_text_(r[c.IDPRODUCTO]),descripcionInterna:_text_(r[c.DESCRIPCIONINTERNA]),claveUnidadXml:_upper_(r[c.CLAVEUNIDADXML]),unidadXml:_upper_(r[c.UNIDADXML]),unidadInterna:_upper_(r[c.UNIDADINTERNA]),factorConversion:_number_(r[c.FACTORCONVERSION]),tipoConcepto:_upper_(r[c.TIPOCONCEPTO]),activo:_boolean_(r[c.ACTIVO]),nivelConfianza:_upper_(r[c.NIVELCONFIANZA]),origenRegla:_upper_(r[c.ORIGENREGLA]),fechaInicio:_date_(r[c.FECHAINICIO]),fechaFin:_date_(r[c.FECHAFIN]),creadoPor:_text_(r[c.CREADOPOR]),fechaCreacion:_date_(r[c.FECHACREACION]),modificadoPor:_text_(r[c.MODIFICADOPOR]),fechaModificacion:_date_(r[c.FECHAMODIFICACION]),observacion:_text_(r[c.OBSERVACION])
  };}

  function _readAndMap_(key, mapper, trace) {
    assertConfiguration(trace);
    const startedAt=Date.now();
    const rows=readSheetRows_(key,_width_(key),trace);
    const mapped=rows.map(function(row,index){return mapper(row,index+2);});
    perfMark_(trace,"VE_REPOSITORY_ROWS_MAPPED",{sheetKey:key,elapsedMs:Date.now()-startedAt,rows:mapped.length,strategy:"FULL_SCAN"});
    return mapped;
  }

  function _findRowNumbers_(key, columnName, value, trace) {
    assertConfiguration(trace);
    const normalized=_text_(value);
    if(!normalized)return[];
    const startedAt=Date.now();
    const sheet=getSheetByKey_(key,trace);
    const lastRow=sheet.getLastRow();
    if(lastRow<=1)return[];
    const column=_columns_(key)[columnName];
    if(!Number.isInteger(column))throw new Error("Columna no configurada: "+key+"."+columnName);
    const matches=sheet.getRange(2,column+1,lastRow-1,1).createTextFinder(normalized).matchEntireCell(true).findAll();
    const numbers=matches.map(function(cell){return cell.getRow();}).sort(function(a,b){return a-b;});
    perfMark_(trace,"VE_REPOSITORY_TEXT_FINDER_READY",{sheetKey:key,columnName:columnName,elapsedMs:Date.now()-startedAt,sourceRows:lastRow-1,matches:numbers.length});
    return numbers;
  }

  function _groupRowNumbers_(numbers) {
    const groups=[];
    numbers.forEach(function(rowNumber){
      const last=groups[groups.length-1];
      if(!last||rowNumber!==last.end+1)groups.push({start:rowNumber,end:rowNumber});
      else last.end=rowNumber;
    });
    return groups;
  }

  function _readRowsByNumbers_(key, numbers, mapper, trace) {
    if(!numbers.length)return[];
    const startedAt=Date.now();
    const sheet=getSheetByKey_(key,trace);
    const width=_width_(key);
    const result=[];
    const groups=_groupRowNumbers_(numbers);
    groups.forEach(function(group){
      const length=group.end-group.start+1;
      const rows=sheet.getRange(group.start,1,length,width).getValues();
      rows.forEach(function(row,index){result.push(mapper(row,group.start+index));});
    });
    perfMark_(trace,"VE_REPOSITORY_SELECTIVE_ROWS_MAPPED",{sheetKey:key,elapsedMs:Date.now()-startedAt,rows:result.length,readGroups:groups.length,strategy:"TEXT_FINDER_GROUPED"});
    return result;
  }

  function _getByColumn_(key,columnName,value,mapper,trace) {
    return _readRowsByNumbers_(key,_findRowNumbers_(key,columnName,value,trace),mapper,trace);
  }

  function _buildRow_(key,object,fieldMap){const row=_blank_(key),columns=_columns_(key),source=object||{};Object.keys(fieldMap).forEach(function(columnName){if(!Object.prototype.hasOwnProperty.call(columns,columnName))throw new Error("Columna no configurada: "+key+"."+columnName);const value=source[fieldMap[columnName]];row[columns[columnName]]=value===null||value===undefined?"":value;});return row;}

  const SESSION_FIELD_MAP=Object.freeze({IDSESION:"idSesion",HASHXML:"hashXml",UUIDCFDI:"uuidCfdi",RFCEMISOR:"rfcEmisor",NOMBREEMISOR:"nombreEmisor",SERIE:"serie",FOLIO:"folio",FECHACFDI:"fechaCfdi",VERSIONCFDI:"versionCfdi",TIPOCOMPROBANTE:"tipoComprobante",MONEDA:"moneda",NOMBREARCHIVO:"nombreArchivo",ESTRATEGIAETIQUETA:"estrategiaEtiqueta",ESTADOSESION:"estadoSesion",TOTALSKUS:"totalSkus",TOTALCONCEPTOS:"totalConceptos",CONCEPTOSEXCLUIDOS:"conceptosExcluidos",CANTIDADESPERADA:"cantidadEsperada",CANTIDADCAPTURADA:"cantidadCapturada",CANTIDADFALTANTE:"cantidadFaltante",CANTIDADSOBRANTE:"cantidadSobrante",TOTALCAJAS:"totalCajas",INICIADAPOR:"iniciadaPor",FECHAINICIO:"fechaInicio",HORAINICIO:"horaInicio",FECHACIERRE:"fechaCierre",HORACIERRE:"horaCierre",CERRADAPOR:"cerradaPor",SEGUNDOSACTIVOS:"segundosActivos",SEGUNDOSPAUSADOS:"segundosPausados",OBSERVACIONCIERRE:"observacionCierre",RESULTADOFINAL:"resultadoFinal",VERSIONPERFIL:"versionPerfil",CREADOEN:"creadoEn",ACTUALIZADOEN:"actualizadoEn"});
  const DETAIL_FIELD_MAP=Object.freeze({IDDETALLE:"idDetalle",IDSESION:"idSesion",RFCEMISOR:"rfcEmisor",CODIGOPROVEEDORXML:"codigoProveedorXml",CODIGOINTERNO:"codigoInterno",IDPRODUCTO:"idProducto",DESCRIPCIONXML:"descripcionXml",DESCRIPCIONINTERNA:"descripcionInterna",CLAVEPRODSERV:"claveProdServ",CLAVEUNIDADXML:"claveUnidadXml",UNIDADXML:"unidadXml",UNIDADINTERNA:"unidadInterna",FACTORCONVERSION:"factorConversion",CANTIDADXML:"cantidadXml",CANTIDADESPERADA:"cantidadEsperada",CANTIDADCAPTURADA:"cantidadCapturada",CANTIDADFALTANTE:"cantidadFaltante",CANTIDADSOBRANTE:"cantidadSobrante",TOTALCAJAS:"totalCajas",ESTADOSKU:"estadoSku",CLASIFICACION:"clasificacion",INCLUIRENCONTEO:"incluirEnConteo",CONFIANZACLASIFICACION:"confianzaClasificacion",MOTIVOEXCLUSION:"motivoExclusion",RENGLONESORIGINALES:"renglonesOriginales",REQUIEREREVISION:"requiereRevision",OBSERVACION:"observacion",CREADOEN:"creadoEn",ACTUALIZADOEN:"actualizadoEn"});
  const BOX_FIELD_MAP=Object.freeze({IDUNICOCAJA:"idUnicoCaja",IDSESION:"idSesion",IDDETALLE:"idDetalle",RFCEMISOR:"rfcEmisor",CODIGOPROVEEDORXML:"codigoProveedorXml",CODIGOETIQUETA:"codigoEtiqueta",CODIGOINTERNO:"codigoInterno",IDPRODUCTO:"idProducto",CANTIDADCAJA:"cantidadCaja",UNIDAD:"unidad",CONSECUTIVOPROVEEDOR:"consecutivoProveedor",ESTRATEGIAETIQUETA:"estrategiaEtiqueta",HUELLALECTURA:"huellaLectura",LONGITUDLECTURA:"longitudLectura",ESTADOCAJA:"estadoCaja",RESULTADOVALIDACION:"resultadoValidacion",ADVERTENCIAS:"advertencias",CAPTURADAPOR:"capturadaPor",FECHACAPTURA:"fechaCaptura",HORACAPTURA:"horaCaptura",CANCELADAPOR:"canceladaPor",FECHACANCELACION:"fechaCancelacion",HORACANCELACION:"horaCancelacion",MOTIVOCANCELACION:"motivoCancelacion",OBSERVACION:"observacion",CREADOEN:"creadoEn"});
  const EVENT_FIELD_MAP=Object.freeze({IDEVENTO:"idEvento",IDSESION:"idSesion",TIPOEVENTO:"tipoEvento",IDUNICOCAJA:"idUnicoCaja",IDDETALLE:"idDetalle",CODIGOINTERNO:"codigoInterno",CANTIDAD:"cantidad",ESTADOANTERIOR:"estadoAnterior",ESTADONUEVO:"estadoNuevo",RESULTADO:"resultado",CODIGOMOTIVO:"codigoMotivo",MENSAJE:"mensaje",USUARIO:"usuario",ROLUSUARIO:"rolUsuario",FECHA:"fecha",HORA:"hora",TIMESTAMPMS:"timestampMs",METADATAJSON:"metadataJson",CREADOEN:"creadoEn"});
  const SESSION_PATCH_MAP=Object.freeze({estrategiaEtiqueta:"ESTRATEGIAETIQUETA",estadoSesion:"ESTADOSESION",cantidadCapturada:"CANTIDADCAPTURADA",cantidadFaltante:"CANTIDADFALTANTE",cantidadSobrante:"CANTIDADSOBRANTE",totalCajas:"TOTALCAJAS",fechaCierre:"FECHACIERRE",horaCierre:"HORACIERRE",cerradaPor:"CERRADAPOR",segundosActivos:"SEGUNDOSACTIVOS",segundosPausados:"SEGUNDOSPAUSADOS",observacionCierre:"OBSERVACIONCIERRE",resultadoFinal:"RESULTADOFINAL",actualizadoEn:"ACTUALIZADOEN"});
  const DETAIL_PATCH_MAP=Object.freeze({codigoInterno:"CODIGOINTERNO",idProducto:"IDPRODUCTO",descripcionInterna:"DESCRIPCIONINTERNA",unidadInterna:"UNIDADINTERNA",factorConversion:"FACTORCONVERSION",cantidadEsperada:"CANTIDADESPERADA",cantidadCapturada:"CANTIDADCAPTURADA",cantidadFaltante:"CANTIDADFALTANTE",cantidadSobrante:"CANTIDADSOBRANTE",totalCajas:"TOTALCAJAS",estadoSku:"ESTADOSKU",clasificacion:"CLASIFICACION",incluirEnConteo:"INCLUIRENCONTEO",confianzaClasificacion:"CONFIANZACLASIFICACION",motivoExclusion:"MOTIVOEXCLUSION",requiereRevision:"REQUIEREREVISION",observacion:"OBSERVACION",actualizadoEn:"ACTUALIZADOEN"});
  const BOX_PATCH_MAP=Object.freeze({estadoCaja:"ESTADOCAJA",resultadoValidacion:"RESULTADOVALIDACION",canceladaPor:"CANCELADAPOR",fechaCancelacion:"FECHACANCELACION",horaCancelacion:"HORACANCELACION",motivoCancelacion:"MOTIVOCANCELACION",observacion:"OBSERVACION"});

  function buildSesionRow(v){return _buildRow_(KEYS.SESIONES,v,SESSION_FIELD_MAP);} function buildDetalleRow(v){return _buildRow_(KEYS.DETALLE,Object.assign({},v||{},{renglonesOriginales:_json_(v&&v.renglonesOriginales)}),DETAIL_FIELD_MAP);} function buildCajaRow(v){return _buildRow_(KEYS.CAJAS,Object.assign({},v||{},{advertencias:_json_(v&&v.advertencias)}),BOX_FIELD_MAP);} function buildEventoRow(v){return _buildRow_(KEYS.EVENTOS,Object.assign({},v||{},{metadataJson:_json_(v&&v.metadataJson)}),EVENT_FIELD_MAP);}

  function _activeEquivalenceForRfc_(item, rfc) {
    return Boolean(
      item &&
      item.activo === true &&
      item.rfcEmisor === rfc
    );
  }

  function _readCachedEquivalences_(cacheKey, trace) {
    const cached = _scriptCache_().get(cacheKey);
    if (!cached) return null;

    try {
      const value = JSON.parse(cached);
      perfMark_(trace, "VE_EQUIVALENCES_SCRIPT_CACHE_HIT", {
        rows: Array.isArray(value) ? value.length : 0
      });
      return Array.isArray(value) ? value : null;
    } catch (error) {
      _scriptCache_().remove(cacheKey);
      return null;
    }
  }

  function _writeCachedEquivalences_(cacheKey, rows, trace) {
    const serializable = (rows || []).map(function(item) {
      return {
        rowNumber: item.rowNumber,
        idEquivalencia: item.idEquivalencia,
        rfcEmisor: item.rfcEmisor,
        idProveedor: item.idProveedor,
        codigoProveedorXml: item.codigoProveedorXml,
        codigoEtiqueta: item.codigoEtiqueta,
        codigoInterno: item.codigoInterno,
        idProducto: item.idProducto,
        descripcionInterna: item.descripcionInterna,
        claveUnidadXml: item.claveUnidadXml,
        unidadXml: item.unidadXml,
        unidadInterna: item.unidadInterna,
        factorConversion: item.factorConversion,
        tipoConcepto: item.tipoConcepto,
        activo: item.activo,
        nivelConfianza: item.nivelConfianza,
        origenRegla: item.origenRegla,
        observacion: item.observacion
      };
    });

    const json = JSON.stringify(serializable);

    if (json.length <= CACHE_VALUE_MAX_CHARS) {
      _scriptCache_().put(
        cacheKey,
        json,
        EQUIVALENCE_CACHE_TTL_SECONDS
      );
      perfMark_(trace, "VE_EQUIVALENCES_SCRIPT_CACHE_WRITTEN", {
        rows: serializable.length,
        chars: json.length
      });
    }
  }

  function getEquivalenciasPorRfc(rfcEmisor, trace) {
    const startedAt = Date.now();
    const rfc = _upper_(rfcEmisor);

    if (!rfc) return [];

    const rows = _getByColumn_(
      KEYS.EQUIVALENCIAS,
      "RFCEMISOR",
      rfc,
      _mapEquivalencia_,
      trace
    );

    const result = rows.filter(function(item) {
      return _activeEquivalenceForRfc_(item, rfc);
    });

    perfMark_(trace, "VE_EQUIVALENCES_BY_RFC_READY", {
      elapsedMs: Date.now() - startedAt,
      sourceRows: rows.length,
      activeRows: result.length,
      strategy: "RFC_TEXT_FINDER_GROUPED"
    });

    return result;
  }

  function getEquivalenciasPorEtiquetas(
    rfcEmisor,
    codigosEtiqueta,
    trace
  ) {
    const startedAt = Date.now();
    const rfc = _upper_(rfcEmisor);
    const codes = Array.from(new Set(
      (codigosEtiqueta || []).map(_upper_).filter(Boolean)
    ));

    if (!rfc || !codes.length) return [];

    const resultById = {};
    let cacheHits = 0;
    let sheetLookups = 0;

    codes.forEach(function(code) {
      const cacheKey = _cacheKeyForEquivalence_(rfc, code);
      let matches = _readCachedEquivalences_(cacheKey, trace);

      if (matches) {
        cacheHits += 1;
      } else {
        sheetLookups += 1;
        matches = _getByColumn_(
          KEYS.EQUIVALENCIAS,
          "CODIGOETIQUETA",
          code,
          _mapEquivalencia_,
          trace
        ).filter(function(item) {
          return _activeEquivalenceForRfc_(item, rfc);
        });

        _writeCachedEquivalences_(cacheKey, matches, trace);
      }

      matches.forEach(function(item) {
        const key = item.idEquivalencia || [
          item.rfcEmisor,
          item.codigoProveedorXml,
          item.codigoEtiqueta,
          item.codigoInterno,
          item.idProducto
        ].join("|");
        resultById[key] = item;
      });
    });

    const result = Object.keys(resultById).map(function(key) {
      return resultById[key];
    });

    perfMark_(trace, "VE_EQUIVALENCES_BY_LABELS_READY", {
      elapsedMs: Date.now() - startedAt,
      requestedCodes: codes.length,
      rows: result.length,
      cacheHits: cacheHits,
      sheetLookups: sheetLookups,
      strategy: "LABEL_TEXT_FINDER_WITH_SCRIPT_CACHE"
    });

    return result;
  }
  function getAllSesiones(trace){return _readAndMap_(KEYS.SESIONES,_mapSesion_,trace);}
  function getSesionPorId(id,trace){const rows=_getByColumn_(KEYS.SESIONES,"IDSESION",_text_(id),_mapSesion_,trace);return rows[0]||null;}
  function getSesionDuplicada(hash,uuid,trace){const sesiones=getAllSesiones(trace),h=_text_(hash),u=_upper_(uuid);return{byHash:sesiones.find(function(x){return h&&x.hashXml===h;})||null,byUuid:sesiones.find(function(x){return u&&x.uuidCfdi===u;})||null};}
  function getSesionPorHashXml(hash,trace){return getSesionDuplicada(hash,"",trace).byHash;} function getSesionPorUuidCfdi(uuid,trace){return getSesionDuplicada("",uuid,trace).byUuid;}
  function getDetallePorSesion(id,trace){return _getByColumn_(KEYS.DETALLE,"IDSESION",_text_(id),_mapDetalle_,trace);}
  function getCajasPorSesion(id,trace){const startedAt=Date.now(),result=_getByColumn_(KEYS.CAJAS,"IDSESION",_text_(id),_mapCaja_,trace);perfMark_(trace,"VE_BOXES_BY_SESSION_READY",{elapsedMs:Date.now()-startedAt,rows:result.length,strategy:"TEXT_FINDER_GROUPED"});return result;}
  function getCajaPorId(id,trace){const rows=_getByColumn_(KEYS.CAJAS,"IDUNICOCAJA",_text_(id),_mapCaja_,trace);return rows[0]||null;}
  function getEventosPorSesion(id,trace){return _getByColumn_(KEYS.EVENTOS,"IDSESION",_text_(id),_mapEvento_,trace).sort(function(a,b){return a.timestampMs-b.timestampMs;});}
  function existeHuellaLecturaEnSesion(id,huella,trace){const h=_text_(huella);return Boolean(h&&getCajasPorSesion(id,trace).some(function(x){return x.huellaLectura===h&&x.estadoCaja!==VERIFICACION_ENTRADA.ESTADOS_CAJA.CANCELADA;}));}

  function insertarSesion(v,t){assertConfiguration(t);return writeRowsBatch_(KEYS.SESIONES,[buildSesionRow(v)],_width_(KEYS.SESIONES),t);} function insertarDetalles(v,t){assertConfiguration(t);return writeRowsBatch_(KEYS.DETALLE,(v||[]).map(buildDetalleRow),_width_(KEYS.DETALLE),t);} function insertarCajas(v,t){assertConfiguration(t);return writeRowsBatch_(KEYS.CAJAS,(v||[]).map(buildCajaRow),_width_(KEYS.CAJAS),t);} function insertarEventos(v,t){assertConfiguration(t);return writeRowsBatch_(KEYS.EVENTOS,(v||[]).map(buildEventoRow),_width_(KEYS.EVENTOS),t);}
  function crearSesionConDetalle(s,d,e,t){return{sesion:insertarSesion(s,t),detalles:insertarDetalles(d,t),eventos:insertarEventos(e||[],t)};} function registrarCajasConEventos(c,e,t){return{cajas:insertarCajas(c,t),eventos:insertarEventos(e||[],t)};}

  function _applyPatch_(row,key,patch,map){const columns=_columns_(key);let changed=0;Object.keys(patch||{}).forEach(function(name){const col=map[name];if(!col)throw new Error("Campo no actualizable en "+key+": "+name);const value=patch[name];row[columns[col]]=value===null||value===undefined?"":value;changed++;});return changed;}
  function _updateKnownRow_(key,rowNumber,patch,map,trace){assertConfiguration(trace);const rowNo=Number(rowNumber);if(!Number.isInteger(rowNo)||rowNo<2)throw new Error("Número de fila inválido en "+key+".");const sheet=getSheetByKey_(key,trace),width=_width_(key),row=sheet.getRange(rowNo,1,1,width).getValues()[0],changed=_applyPatch_(row,key,patch||{},map);if(!changed)return{updated:false,rowNumber:rowNo,changedFields:0};const startedAt=Date.now();sheet.getRange(rowNo,1,1,width).setValues([row]);const elapsed=Date.now()-startedAt;perfMark_(trace,"VE_KNOWN_ROW_UPDATED",{sheetKey:key,elapsedMs:elapsed,rowNumber:rowNo,changedFields:changed});return{updated:true,rowNumber:rowNo,changedFields:changed};}
  function _updateRowById_(key,idColumn,id,patch,map,trace){const numbers=_findRowNumbers_(key,idColumn,id,trace);if(!numbers.length)throw new Error("No se encontró el registro "+id+" en "+key+".");return _updateKnownRow_(key,numbers[0],patch,map,trace);}

  function actualizarDetallesPorLote(detalles,trace){assertConfiguration(trace);const source=Array.isArray(detalles)?detalles:[];if(!source.length)return{updated:0,requested:0,writeGroups:0,strategy:"EMPTY"};const startedAt=Date.now(),key=KEYS.DETALLE,width=_width_(key),sheet=getSheetByKey_(key,trace);let strategy="KNOWN_ROWS",entries=[];const allKnown=source.every(function(item){return Number.isInteger(Number(item&&item.rowNumber))&&Number(item.rowNumber)>=2;});
    if(allKnown){entries=source.map(function(item){return{rowNumber:Number(item.rowNumber),item:item};});}
    else{strategy="ID_LOOKUP";const lastRow=sheet.getLastRow();if(lastRow<=1)throw new Error("VE_DETALLE no contiene registros.");const rows=sheet.getRange(2,1,lastRow-1,width).getValues(),idCol=_columns_(key).IDDETALLE,index={};rows.forEach(function(row,i){const id=_text_(row[idCol]);if(id)index[id]=i+2;});const missing=[];source.forEach(function(item){const id=_text_(item&&item.idDetalle),rowNumber=index[id];if(!rowNumber)missing.push(id);else entries.push({rowNumber:rowNumber,item:item});});if(missing.length)throw new Error("No se encontraron detalles: "+JSON.stringify(missing.slice(0,20)));}
    const byRow={};entries.forEach(function(entry){byRow[entry.rowNumber]=entry.item;});const numbers=Object.keys(byRow).map(Number).sort(function(a,b){return a-b;}),groups=_groupRowNumbers_(numbers),writeStartedAt=Date.now();groups.forEach(function(group){const length=group.end-group.start+1,rows=sheet.getRange(group.start,1,length,width).getValues();rows.forEach(function(row,index){const item=byRow[group.start+index];if(item)_applyPatch_(row,key,item.patch||{},DETAIL_PATCH_MAP);});sheet.getRange(group.start,1,length,width).setValues(rows);});const writeMs=Date.now()-writeStartedAt;perfMark_(trace,"VE_DETAIL_BATCH_UPDATED",{elapsedMs:Date.now()-startedAt,writeElapsedMs:writeMs,requested:source.length,updated:numbers.length,writeGroups:groups.length,strategy:strategy});return{updated:numbers.length,requested:source.length,writeGroups:groups.length,strategy:strategy};}

  function actualizarSesion(id,p,t){return _updateRowById_(KEYS.SESIONES,"IDSESION",id,p,SESSION_PATCH_MAP,t);} function actualizarSesionPorFila(row,p,t){return _updateKnownRow_(KEYS.SESIONES,row,p,SESSION_PATCH_MAP,t);} function actualizarDetalle(id,p,t){return _updateRowById_(KEYS.DETALLE,"IDDETALLE",id,p,DETAIL_PATCH_MAP,t);} function actualizarCaja(id,p,t){return _updateRowById_(KEYS.CAJAS,"IDUNICOCAJA",id,p,BOX_PATCH_MAP,t);}

  function clearCache() {
    configurationValidated_ = false;
    equivalenceGeneration_ = "";

    const cache = _scriptCache_();
    cache.remove(CONFIG_CACHE_KEY);
    cache.remove(EQUIVALENCE_GENERATION_KEY);

    console.log("[CACHE] VerificacionEntradaRepository limpio");
    return true;
  }

  return Object.freeze({assertConfiguration:assertConfiguration,getEquivalenciasPorRfc:getEquivalenciasPorRfc,getEquivalenciasPorEtiquetas:getEquivalenciasPorEtiquetas,getAllSesiones:getAllSesiones,getSesionPorId:getSesionPorId,getSesionPorHashXml:getSesionPorHashXml,getSesionPorUuidCfdi:getSesionPorUuidCfdi,getSesionDuplicada:getSesionDuplicada,getDetallePorSesion:getDetallePorSesion,getCajasPorSesion:getCajasPorSesion,getCajaPorId:getCajaPorId,getEventosPorSesion:getEventosPorSesion,existeHuellaLecturaEnSesion:existeHuellaLecturaEnSesion,buildSesionRow:buildSesionRow,buildDetalleRow:buildDetalleRow,buildCajaRow:buildCajaRow,buildEventoRow:buildEventoRow,insertarSesion:insertarSesion,insertarDetalles:insertarDetalles,insertarCajas:insertarCajas,insertarEventos:insertarEventos,crearSesionConDetalle:crearSesionConDetalle,registrarCajasConEventos:registrarCajasConEventos,actualizarSesion:actualizarSesion,actualizarSesionPorFila:actualizarSesionPorFila,actualizarDetalle:actualizarDetalle,actualizarDetallesPorLote:actualizarDetallesPorLote,actualizarCaja:actualizarCaja,clearCache:clearCache});
})();

function testVerificacionEntradaRepositoryLectura(){const trace=perfStart_("VE_REPOSITORY_READ_TEST",{test:true});try{VerificacionEntradaRepository.assertConfiguration(trace);const sesiones=VerificacionEntradaRepository.getAllSesiones(trace),result={configuracionOk:true,sesiones:sesiones.length,tieneSesiones:sesiones.length>0,primeraSesionId:sesiones.length?sesiones[0].idSesion:"",actualizarDetallesPorLoteDisponible:typeof VerificacionEntradaRepository.actualizarDetallesPorLote==="function",actualizarSesionPorFilaDisponible:typeof VerificacionEntradaRepository.actualizarSesionPorFila==="function",getSesionDuplicadaDisponible:typeof VerificacionEntradaRepository.getSesionDuplicada==="function",getEquivalenciasPorEtiquetasDisponible:typeof VerificacionEntradaRepository.getEquivalenciasPorEtiquetas==="function"};perfEnd_(trace,"ok",{sesiones:sesiones.length,responseChars:perfMeasureJsonChars_(result)});return result;}catch(error){perfFail_(trace,error);throw error;}}
