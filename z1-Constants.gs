/**
 * 
 * z1-Constants.gs
 * 
 * @fileoverview Configuración central e inmutable de APPALMACEN.
 *
 * Este módulo concentra los contratos compartidos por la aplicación: archivos de
 * Google Sheets, hojas físicas, índices de columnas, reglas de los dominios de
 * Verificación de entrada y Reabastecimiento, perfiles de proveedores,
 * encabezados, límites, presentación visual, navegación y almacenes.
 *
 * PRINCIPIOS DE MANTENIMIENTO
 * 1. Mantener este archivo libre de lógica de negocio y efectos secundarios.
 * 2. Agregar nuevas propiedades sin renombrar claves existentes consumidas por
 *    otros módulos, salvo que exista un plan explícito de migración.
 * 3. Actualizar conjuntamente COL, HEADERS y la hoja física cuando cambie un
 *    esquema tabular.
 * 4. Tratar los identificadores y las URL como configuración operativa, no como
 *    secretos. Las credenciales nunca deben almacenarse en el código fuente.
 * 5. Conservar Object.freeze en objetos y arreglos para detectar mutaciones
 *    accidentales durante la ejecución.
 *
 * CONVENCIONES
 * - Índices de columnas: base cero (A = 0, B = 1, etc.).
 * - Claves de configuración: UPPER_SNAKE_CASE.
 * - Propiedades que forman parte de contratos de interfaz: se preserva su estilo
 *   actual para mantener compatibilidad con los consumidores existentes.
 * - Un ID de Spreadsheet corresponde al segmento entre `/d/` y `/edit` en su URL.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version APPALMACEN-2026-11-14-10
 */

/**
 * Identificadores de los libros de Google Sheets utilizados por la aplicación.
 *
 * Las claves se referencian desde SHEETS.file. Cambiar una clave requiere revisar
 * todos los consumidores; cambiar únicamente el ID permite sustituir el libro sin
 * modificar el resto del código.
 *
 * @readonly
 * @enum {string}
 */
const FILES = Object.freeze({
  GESTION1: "1xPMnPg_-m7yQQoMq6ku1iwyXRlZC-RjypGpC_2gv4xE",
  GESTION2: "1hXRyADfhVn_teWydRvCisNBEQnqh6U-9wue9A5_zpeo",
  GESTION3: "102KnS9dsTzVxr3XX983MopCGpaGmST9ccf0n_KhYbqc",
  GESTION4: "1PI4JkHcIl6mHKM9uCtolBGx0olIYdGhZO-ao3_QaT4Q",
  GESTION5: "1_L_Ur3szSFcJX0Z1gxZpSNXSDoBiJDrV7uJaDuZlOTU",
  PEDIDOS: "1PJh2JaMH2FVDNOzZ7vTcKlFSJ48R5rYGjsF_HyjMWO0"
});

/**
 * Registro de hojas físicas y del libro que las contiene.
 *
 * @typedef {{file: string, name: string}} SheetDescriptor
 * @readonly
 * @type {Object<string, SheetDescriptor>}
 */
const SHEETS = Object.freeze({
  CATALOGO: Object.freeze({ file: "GESTION1", name: "CATALOGO" }),
  ETIQUETAS: Object.freeze({ file: "GESTION1", name: "ETIQUETAS" }),
  EXCEDENTES: Object.freeze({ file: "GESTION1", name: "BD-EXCEDENTES" }),
  TRASPASOS: Object.freeze({ file: "GESTION1", name: "Bitacora-TRASPASOS" }),
  UBICACIONES_EXCEDENTES: Object.freeze({ file: "GESTION1", name: "UBICACIONES" }),
  UBICACIONES_SURTIDO: Object.freeze({ file: "GESTION1", name: "UBICACIONES_SURTIDO" }),
  USUARIOS: Object.freeze({ file: "GESTION1", name: "USUARIOS" }),
  EXISTENCIAS: Object.freeze({ file: "GESTION1", name: "EXISTENCIAS" }),
  SINCRONIZACION_EXISTENCIAS: Object.freeze({ file: "GESTION1", name: "BITACORA-SINCRONIZACION-EXISTENCIAS" }),
  MAXMIN: Object.freeze({ file: "GESTION1", name: "MAXMIN" }),
  AUDITORIA_EXCEDENTES: Object.freeze({ file: "GESTION1", name: "AUDITORIAEXCEDENTES" }),
  AUDITORIA_EXCEDENTES_DETALLE: Object.freeze({ file: "GESTION1", name: "AUDITORIAEXCEDENTESDETALLE" }),
  DETALLES_PRODUCTOS: Object.freeze({ file: "GESTION1", name: "DETALLESPRODUCTO" }),

  /** Verificación de entrada. Todas estas hojas viven en GESTION2. */
  VERIFICACION_ENTRADA_SESIONES: Object.freeze({ file: "GESTION2", name: "VE_SESIONES" }),
  VERIFICACION_ENTRADA_DETALLE: Object.freeze({ file: "GESTION2", name: "VE_DETALLE" }),
  VERIFICACION_ENTRADA_CAJAS: Object.freeze({ file: "GESTION2", name: "VE_CAJAS" }),
  VERIFICACION_ENTRADA_EVENTOS: Object.freeze({ file: "GESTION2", name: "VE_EVENTOS" }),
  VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES: Object.freeze({ file: "GESTION2", name: "VE_CATALOGO_PROVEEDORES" }),
  VERIFICACION_ENTRADA_EQUIVALENCIAS: Object.freeze({ file: "GESTION2", name: "VE_EQUIVALENCIAS" }),

  /** Cola de trabajo documental. Todas estas hojas viven en GESTION3. */
  MAT_DOCUMENTOS: Object.freeze({ file: "GESTION3", name: "MAT_DOCUMENTOS" }),
  MAT_DOCUMENTODETALLE: Object.freeze({ file: "GESTION3", name: "MAT_DOCUMENTODETALLE" }),

  /** Ubicaciones, existencias y parámetros de máximos y mínimos. Vive en GESTION4. */
  UBICACIONES_MAXMIN: Object.freeze({
    file: "GESTION4",
    name: "UBICACIONES_MAXMIN"
  }),
  /** Tickets de reabastecimiento. Todas estas hojas viven en GESTION5. */
  REABASTECIMIENTO_SOLICITUDES: Object.freeze({
    file: "GESTION5",
    name: "REABASTECIMIENTO_SOLICITUDES"
  }),
  REABASTECIMIENTO_PARTIDAS: Object.freeze({
    file: "GESTION5",
    name: "REABASTECIMIENTO_PARTIDAS"
  }),
  REABASTECIMIENTO_DETALLES: Object.freeze({
    file: "GESTION5",
    name: "REABASTECIMIENTO_DETALLES"
  })
});

/**
 * Índices base cero de las columnas físicas.
 *
 * IMPORTANTE: estos valores constituyen un contrato con las hojas de cálculo.
 * Ante una inserción, eliminación o reordenamiento de columnas debe actualizarse
 * la sección correspondiente y validarse contra sus encabezados declarados.
 *
 * @readonly
 * @type {Object<string, Object<string, number>>}
 */
const COL = Object.freeze({
  CATALOGO: Object.freeze({ IDPRODUCTO: 0, CODIGO: 1, DESCRIPCION: 2, STATUS: 3 }),

  USUARIOS: Object.freeze({ IDUSUARIOS: 0, NOMBRE: 1, ROL: 2 }),
  
  ETIQUETAS: Object.freeze({ NOMBRE: 0, ANCHO: 1, ALTO: 2 }),
  
  UBICACIONES_EXCEDENTES: Object.freeze({ IDUBICACIONES_EXCEDENTES: 0, BODEGA: 1, UBICACION: 2 }),
  
  UBICACIONES_SURTIDO: Object.freeze({ IDUBICACION: 0, CODIGO: 1, BODEGA: 2, PASILLO: 3, ANAQUEL: 4, REPISA: 5, IDPRODUCTO: 6, UBICACION: 7 }),
  
  EXCEDENTES: Object.freeze({ IDUNICO: 0, FECHA: 1, HORA: 2, IDPRODUCTO: 3, CODIGO: 4, DESCRIPCION: 5, CANTIDAD: 6, STATUS: 7, RESPONSABLEIMPRESION: 8 }),
  
  TRASPASOS: Object.freeze({ FECHA: 0, HORA: 1, TIPOMOVIMIENTO: 2, SERIE: 3, BODEGA_SALIDA: 4, UBICACION_SALIDA: 5, BODEGA_ENTRADA: 6, UBICACION_ENTRADA: 7, SOLICITANTE: 8, CODIGO: 9, 
  DESCRIPCION: 10, CANTIDAD: 11, FOLIO: 12, RESPONSABLE: 13, IDUNICO: 14, FECHARESPUESTA: 15, HORARESPUESTA: 16 }),
  
  EXISTENCIAS: Object.freeze({ IDPRODUCTO: 0, CODIGO: 1, DESCRIPCION: 2, ALMACENBIRLOS: 3, EXCEDENTEBODEGA: 4, EXCEDENTECASABLANCA: 5 }),
  
  SINCRONIZACION_EXISTENCIAS: Object.freeze({ CLAVE: 0, IDUNICO: 1, TIPOMOVIMIENTO: 2, IDPRODUCTO: 3, CODIGO: 4, BODEGA_SALIDA: 5, BODEGA_ENTRADA: 6, CANTIDAD: 7, FECHA_APLICACION: 8, RESULTADO: 9 }),
  
  MAXMIN: Object.freeze({ CODIGO: 0, MINIMO: 1, MAXIMO: 2 }),

  /**
   * Contrato físico de la hoja UBICACIONES_MAXMIN, rango A:O.
   * Los índices utilizan base cero y deben coincidir con la fila de encabezados.
   */
  UBICACIONES_MAXMIN: Object.freeze({
    CODIGO: 0,
    DESCRIPCION: 1,
    BODEGA: 2,
    UBICACION: 3,
    EXISTENCIA: 4,
    PORCENTAJE: 5,
    MAXIMO: 6,
    MINIMO: 7,
    ZONA_BODEGA: 8,
    ZONA_ABASTECIMIENTO: 9,
    ZONA_NIVEL: 10,
    FECHA: 11,
    HORA: 12,
    USUARIO: 13,
    VALIDACION: 14
  }),
  
  AUDITORIA_EXCEDENTES: Object.freeze({ IDAUDITORIA: 0, FECHA: 1, HORAINICIO: 2, HORAFIN: 3, DURACIONMIN: 4, AUDITOR: 5, TIPOAUDITORIA: 6, BODEGAOBJETIVO: 7, ESTATUS: 8, UBICACIONESAUDITADAS: 9, UBICACIONESCONDIFERENCIA: 10, IDUNICOS_ESPERADOS_TOTALES: 11, IDUNICOS_ESCANEADOS_TOTALES: 12, IDUNICOS_CORRECTOS_TOTALES: 13, IDUNICOS_FALTANTES_TOTALES: 14, IDUNICOS_SOBRANTES_TOTALES: 15, CONFIABILIDAD_TOTAL: 16, OBSERVACIONES: 17 }),
  
  AUDITORIA_EXCEDENTES_DETALLE: Object.freeze({ IDAUDITORIA: 0, SECUENCIA_UBICACION: 1, BODEGA: 2, UBICACION: 3, HORAINICIO_UBICACION: 4, HORAFIN_UBICACION: 5, IDUNICO: 6, CODIGO: 7, DESCRIPCION: 8, HORAESCANEO_IDUNICO: 9, ESCORRECTO: 10, ESFALTANTE: 11, ESSOBRANTE: 12, OBSERVACIONES: 13 }),
  
  DETALLES_PRODUCTOS: Object.freeze({ ID: 0, CODIGO: 1, DESCRIPCION: 2, TIPOHILO: 3, HILO: 4, LARGOCUERPO: 5, LARGOCABEZA: 6, ANCHOCUERPO: 7, ANCHOCABEZA: 8, LARGOTOTAL: 9, ANCHOTOTAL: 10, 
  PESOTEORICO: 11, ROSCADO: 12, LARGOROSCADO: 13 }),

  VERIFICACION_ENTRADA_SESIONES: Object.freeze({
    IDSESION: 0, HASHXML: 1, UUIDCFDI: 2, RFCEMISOR: 3, NOMBREEMISOR: 4,
    SERIE: 5, FOLIO: 6, FECHACFDI: 7, VERSIONCFDI: 8, TIPOCOMPROBANTE: 9,
    MONEDA: 10, NOMBREARCHIVO: 11, ESTRATEGIAETIQUETA: 12, ESTADOSESION: 13,
    TOTALSKUS: 14, TOTALCONCEPTOS: 15, CONCEPTOSEXCLUIDOS: 16,
    CANTIDADESPERADA: 17, CANTIDADCAPTURADA: 18, CANTIDADFALTANTE: 19,
    CANTIDADSOBRANTE: 20, TOTALCAJAS: 21, INICIADAPOR: 22, FECHAINICIO: 23,
    HORAINICIO: 24, FECHACIERRE: 25, HORACIERRE: 26, CERRADAPOR: 27,
    SEGUNDOSACTIVOS: 28, SEGUNDOSPAUSADOS: 29, OBSERVACIONCIERRE: 30,
    RESULTADOFINAL: 31, VERSIONPERFIL: 32, CREADOEN: 33, ACTUALIZADOEN: 34
  }),
  VERIFICACION_ENTRADA_DETALLE: Object.freeze({
    IDDETALLE: 0, IDSESION: 1, RFCEMISOR: 2, CODIGOPROVEEDORXML: 3,
    CODIGOINTERNO: 4, IDPRODUCTO: 5, DESCRIPCIONXML: 6,
    DESCRIPCIONINTERNA: 7, CLAVEPRODSERV: 8, CLAVEUNIDADXML: 9,
    UNIDADXML: 10, UNIDADINTERNA: 11, FACTORCONVERSION: 12, CANTIDADXML: 13,
    CANTIDADESPERADA: 14, CANTIDADCAPTURADA: 15, CANTIDADFALTANTE: 16,
    CANTIDADSOBRANTE: 17, TOTALCAJAS: 18, ESTADOSKU: 19, CLASIFICACION: 20,
    INCLUIRENCONTEO: 21, CONFIANZACLASIFICACION: 22, MOTIVOEXCLUSION: 23,
    RENGLONESORIGINALES: 24, REQUIEREREVISION: 25, OBSERVACION: 26,
    CREADOEN: 27, ACTUALIZADOEN: 28
  }),
  VERIFICACION_ENTRADA_CAJAS: Object.freeze({
    IDUNICOCAJA: 0, IDSESION: 1, IDDETALLE: 2, RFCEMISOR: 3,
    CODIGOPROVEEDORXML: 4, CODIGOETIQUETA: 5, CODIGOINTERNO: 6,
    IDPRODUCTO: 7, CANTIDADCAJA: 8, UNIDAD: 9, CONSECUTIVOPROVEEDOR: 10,
    ESTRATEGIAETIQUETA: 11, HUELLALECTURA: 12, LONGITUDLECTURA: 13,
    ESTADOCAJA: 14, RESULTADOVALIDACION: 15, ADVERTENCIAS: 16,
    CAPTURADAPOR: 17, FECHACAPTURA: 18, HORACAPTURA: 19, CANCELADAPOR: 20,
    FECHACANCELACION: 21, HORACANCELACION: 22, MOTIVOCANCELACION: 23,
    OBSERVACION: 24, CREADOEN: 25
  }),
  VERIFICACION_ENTRADA_EVENTOS: Object.freeze({
    IDEVENTO: 0, IDSESION: 1, TIPOEVENTO: 2, IDUNICOCAJA: 3,
    IDDETALLE: 4, CODIGOINTERNO: 5, CANTIDAD: 6, ESTADOANTERIOR: 7,
    ESTADONUEVO: 8, RESULTADO: 9, CODIGOMOTIVO: 10, MENSAJE: 11,
    USUARIO: 12, ROLUSUARIO: 13, FECHA: 14, HORA: 15, TIMESTAMPMS: 16,
    METADATAJSON: 17, CREADOEN: 18
  }),
  VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES: Object.freeze({
    IDFILA: 0, IDPRECIOCOMPRA: 1, IDPRODUCTO: 2, CODIGOPRODUCTO: 3,
    NOMBREPRODUCTO: 4, STATUSPRODUCTO: 5, IDPROVEEDOR: 6,
    CODIGOPROVEEDOR: 7, NOMBREPROVEEDOR: 8, RFCPROVEEDOR: 9,
    CODIGOPRODUCTOPROVEEDOR: 10, PRECIOCOMPRA: 11, IDMONEDA: 12,
    MONEDA: 13, SIMBOLO: 14, IDUNIDAD: 15, UNIDAD: 16, TIMESTAMP: 17
  }),
  VERIFICACION_ENTRADA_EQUIVALENCIAS: Object.freeze({
    IDEQUIVALENCIA: 0, RFCEMISOR: 1, IDPROVEEDOR: 2,
    CODIGOPROVEEDORXML: 3, CODIGOETIQUETA: 4, CODIGOINTERNO: 5,
    IDPRODUCTO: 6, DESCRIPCIONINTERNA: 7, CLAVEUNIDADXML: 8, UNIDADXML: 9,
    UNIDADINTERNA: 10, FACTORCONVERSION: 11, TIPOCONCEPTO: 12, ACTIVO: 13,
    NIVELCONFIANZA: 14, ORIGENREGLA: 15, FECHAINICIO: 16, FECHAFIN: 17,
    CREADOPOR: 18, FECHACREACION: 19, MODIFICADOPOR: 20,
    FECHAMODIFICACION: 21, OBSERVACION: 22
  }),
  /**
   * Solicitudes de reabastecimiento, una fila por ticket.
   */
  REABASTECIMIENTO_SOLICITUDES: Object.freeze({
    ID_SOLICITUD: 0,
    ID_SOLICITUDCONSECUTIVO: 1,
    SOLICITUD_FECHACREACION: 2,
    SOLICITUD_HORACREACION: 3,
    SOLICITUD_SOLICITANTE: 4,
    SOLICITUD_BODEGA: 5,
    SOLICITUD_SKUSOLICITADOS: 6,
    SOLICITUD_FECHAINICIOATENCION: 7,
    SOLICITUD_HORAINICIOATENCION: 8,
    SOLICITUD_FECHACIERREATENCION: 9,
    SOLICITUD_HORACIERREATENCION: 10,
    CAJASINVOLUCRADAS: 11
  }),
  /**
   * Partidas de reabastecimiento, una fila por SKU y ubicación solicitados.
   */
  REABASTECIMIENTO_PARTIDAS: Object.freeze({
    ID_SOLICITUD: 0,
    ID_PARTIDACONSECUTIVO: 1,
    SOLICITUD_CODIGOSOLICITADO: 2,
    SOLICITUD_DESCRIPCIONSOLICITADA: 3,
    SOLICITUD_CODIGOSOLICITADOUBICACION: 4,
    SOLICITUD_CODIGOESTADO: 5,
    SOLICITUD_FECHAATENCION: 6,
    SOLICITUD_HORAATENCION: 7,
    SOLICITUD_USUARIOATENCION: 8
  }),
  /**
   * Detalles de reabastecimiento, una fila por IDUNICO escaneado.
   */
  REABASTECIMIENTO_DETALLES: Object.freeze({
    ID_SOLICITUD: 0,
    ID_DETALLECONSECUTIVO: 1,
    SOLICITUD_IDUNICOESCANEADO: 2,
    SOLICITUD_IDUNICOESCANEADOCODIGO: 3,
    SOLICITUD_IDUNICOESCANEADODESCRIPCION: 4,
    SOLICITUD_IDUNICOESCANEADOCANTIDAD: 5,
    SOLICITUD_IDUNICOESCANEADOFECHAESCANEO: 6,
    SOLICITUD_IDUNICOESCANEADOHORAESCANEO: 7,
    SOLICITUD_USUARIORESPONSABLE: 8
  }),
  /**
   * Cola documental. COTIZACION_NUM es única en MAT_DOCUMENTOS y repetible
   * como clave foránea en MAT_DOCUMENTODETALLE.
   */
  MAT_DOCUMENTOS: Object.freeze({
    ID_DOCUMENTO_MAT: 0,
    ID_CONSECUTIVODIARIO: 1,
    COTIZACION_FECHA: 2,
    COTIZACION_HORA: 3,
    COTIZACION_NUM: 4,
    CLIENTE_NUM: 5,
    CLIENTE_NOMBRE: 6,
    VENDEDOR_NOMBRE: 7,
    SURTIDO_NOMBRE: 8,
    SURTIDO_DIA: 9,
    SURTIDO_HORAINICIO: 10,
    SURTIDO_HORAFIN: 11,
    VERIFICADOR_NOMBRE: 12,
    VERIFICACION_DIA: 13,
    VERIFICACION_HORAINICIO: 14,
    VERIFICACION_HORAFIN: 15,
    VERIFICADO_UBICACION: 16,
    VERIFICADO_UBICADOFECHA: 17,
    VERIFICADO_UBICADOHORA: 18,
    EMPAQUE_RESUMEN: 19,
    PAGO_MONTO: 20,
    PAGO_METODO: 21,
    PAGO_VERIFICACION: 22,
    CFDI_USO: 23,
    ENTREGA_NOMBRE: 24,
    ENTREGA_DIA: 25,
    ENTREGA_HORA: 26
  }),
  MAT_DOCUMENTODETALLE: Object.freeze({
    COTIZACION_NUM: 0,
    SURTIDO_CODIGO: 1,
    SURTIDO_COMPLETO: 2,
    SURTIDO_FALTANTE: 3,
    SURTIDO_PARCIAL: 4,
    SURTIDO_OBSERVACIONES: 5,
    VERIFICACION_CORRECTO: 6,
    VERIFICACION_ERROR: 7,
    VERIFICACION_ERROR_TIPO1: 8,
    VERIFICACION_ERROR_TIPO2: 9,
    VERIFICACION_ERROR_TIPO3: 10,
    VERIFICACION_ERROR_TIPO4: 11,
    VERIFICACION_ERROR_TIPO5: 12,
    VERIFICADO_UBICACION: 13,
    VERIFICADO_UBICACIONFECHA: 14,
    VERIFICADO_UBICACIONHORA: 15,
    EMPAQUE_CONTENEDORTIPO: 16,
    EMPAQUE_CONTENEDORIDENTIFICADOR: 17
  })
});

/**
 * Contratos físicos de las hojas del módulo de Reabastecimiento.
 *
 * MODELO RELACIONAL
 * - REABASTECIMIENTO_SOLICITUDES contiene una fila por ticket.
 * - REABASTECIMIENTO_PARTIDAS contiene una fila por SKU y ubicación solicitados.
 * - REABASTECIMIENTO_DETALLES contiene una fila por IDUNICO escaneado y se
 *   relaciona con la partida mediante ID_SOLICITUD + código.
 *
 * Las listas son la fuente única para validar encabezados y calcular los anchos.
 * El orden debe coincidir exactamente con COL y con la fila 1 de cada hoja.
 *
 * @readonly
 * @type {!Object<string, ReadonlyArray<string>>}
 */
const REABASTECIMIENTO_HEADERS = Object.freeze({
  SOLICITUDES: Object.freeze([
    "ID_SOLICITUD",
    "ID_SOLICITUDCONSECUTIVO",
    "SOLICITUD_FECHACREACION",
    "SOLICITUD_HORACREACION",
    "SOLICITUD_SOLICITANTE",
    "SOLICITUD_BODEGA",
    "SOLICITUD_SKUSOLICITADOS",
    "SOLICITUD_FECHAINICIOATENCION",
    "SOLICITUD_HORAINICIOATENCION",
    "SOLICITUD_FECHACIERREATENCION",
    "SOLICITUD_HORACIERREATENCION",
    "CAJASINVOLUCRADAS"
  ]),
  PARTIDAS: Object.freeze([
    "ID_SOLICITUD",
    "ID_PARTIDACONSECUTIVO",
    "SOLICITUD_CODIGOSOLICITADO",
    "SOLICITUD_DESCRIPCIONSOLICITADA",
    "SOLICITUD_CODIGOSOLICITADOUBICACION",
    "SOLICITUD_CODIGOESTADO",
    "SOLICITUD_FECHAATENCION",
    "SOLICITUD_HORAATENCION",
    "SOLICITUD_USUARIOATENCION"
  ]),
  DETALLES: Object.freeze([
    "ID_SOLICITUD",
    "ID_DETALLECONSECUTIVO",
    "SOLICITUD_IDUNICOESCANEADO",
    "SOLICITUD_IDUNICOESCANEADOCODIGO",
    "SOLICITUD_IDUNICOESCANEADODESCRIPCION",
    "SOLICITUD_IDUNICOESCANEADOCANTIDAD",
    "SOLICITUD_IDUNICOESCANEADOFECHAESCANEO",
    "SOLICITUD_IDUNICOESCANEADOHORAESCANEO",
    "SOLICITUD_USUARIORESPONSABLE"
  ])
});

/**
 * Anchos esperados derivados de los contratos de encabezados.
 *
 * @readonly
 * @enum {number}
 */
const REABASTECIMIENTO_EXPECTED_WIDTHS = Object.freeze({
  REABASTECIMIENTO_SOLICITUDES:
    REABASTECIMIENTO_HEADERS.SOLICITUDES.length,
  REABASTECIMIENTO_PARTIDAS:
    REABASTECIMIENTO_HEADERS.PARTIDAS.length,
  REABASTECIMIENTO_DETALLES:
    REABASTECIMIENTO_HEADERS.DETALLES.length
});

/**
 * Configuración declarativa del dominio de Reabastecimiento.
 *
 * REGLAS DE AUTORIDAD
 * - El servidor genera folios, consecutivos, fechas y horas.
 * - SOLICITUD_SKUSOLICITADOS se deriva del número de partidas persistidas.
 * - CAJASINVOLUCRADAS se deriva del número de IDUNICO únicos persistidos.
 * - El estado de la solicitud no se persiste; el Service lo deriva de sus marcas
 *   de inicio y cierre, y utiliza INCONSISTENTE para combinaciones inválidas.
 * - El estado de partida sí se persiste y solo admite PENDIENTE o ATENDIDO.
 * - ATENDIDO significa que el usuario consultó las ubicaciones de excedente para
 *   el SKU; el surtido físico se acredita mediante REABASTECIMIENTO_DETALLES.
 *
 * INVARIANTES
 * - El folio utiliza REA- + yyyyMMdd + consecutivo diario de dos dígitos.
 * - La generación de folio y las escrituras relacionadas requieren ScriptLock.
 * - Dentro de una solicitud no se repite el código solicitado; esta unicidad
 *   permite relacionar cada detalle con una sola partida mediante solicitud + código.
 * - Un IDUNICO no se registra dos veces dentro de una misma solicitud.
 * - La transición ordinaria de partida es PENDIENTE a ATENDIDO.
 *
 * @readonly
 */
const REABASTECIMIENTO_CONFIG = Object.freeze({
  VERSION: "REABASTECIMIENTO-2026-11-10-01",
  SHEET_KEYS: Object.freeze({
    SOLICITUDES: "REABASTECIMIENTO_SOLICITUDES",
    PARTIDAS: "REABASTECIMIENTO_PARTIDAS",
    DETALLES: "REABASTECIMIENTO_DETALLES"
  }),
  FOLIO: Object.freeze({
    PREFIJO: "REA-",
    FORMATO_FECHA: "yyyyMMdd",
    CONSECUTIVO_DIGITOS: 2,
    MAX_SOLICITUDES_DIARIAS: 99
  }),
  CONSECUTIVOS: Object.freeze({
    PARTIDA_DIGITOS: 2,
    DETALLE_DIGITOS: 3
  }),
  FORMATOS: Object.freeze({
    FECHA: "dd/MM/yyyy",
    HORA: "HH:mm"
  }),
  SOLICITUD_ESTADOS_DERIVADOS: Object.freeze({
    ABIERTA: "ABIERTA",
    EN_ATENCION: "EN_ATENCION",
    CERRADA: "CERRADA",
    INCONSISTENTE: "INCONSISTENTE"
  }),
  PARTIDA_ESTADOS: Object.freeze({
    PENDIENTE: "PENDIENTE",
    ATENDIDO: "ATENDIDO"
  }),
  TRANSICIONES_PARTIDA: Object.freeze({
    PENDIENTE: Object.freeze(["ATENDIDO"]),
    ATENDIDO: Object.freeze([])
  }),
  LIMITES: Object.freeze({
    MAX_SKUS_POR_SOLICITUD: 99,
    MAX_DETALLES_POR_SOLICITUD: 999,
    FOLIO_MAX_LENGTH: 32,
    CODIGO_MAX_LENGTH: 100,
    DESCRIPCION_MAX_LENGTH: 500,
    UBICACION_MAX_LENGTH: 150,
    BODEGA_MAX_LENGTH: 150,
    USUARIO_MAX_LENGTH: 250,
    IDUNICO_MAX_LENGTH: 250,
    LOCK_TIMEOUT_MS: 30000
  }),
  CLIENT_REFRESH: Object.freeze({
    WATCHDOG_MS: 30000,
    AUTO_REFRESH_MS: 60000,
    CONFIRMATION_RETRY_DELAYS_MS: Object.freeze([400, 1200, 3000]),
    RECENT_HIGHLIGHT_MS: 8000
  }),
  PERFORMANCE: Object.freeze({
    ENABLED: true,
    LOG_PREFIX: "[APPALMACEN][REABASTECIMIENTO][PERF]",
    MAX_MARKS: 100,
    MAX_METADATA_TEXT_LENGTH: 250,
    WARN_TOTAL_MS: 3000,
    WARN_SHEET_READ_MS: 1200,
    WARN_SHEET_WRITE_MS: 900,
    WARN_LOCK_WAIT_MS: 500,
    MEASURE_RESPONSE_CHARS: true
  }),
  ERROR_CODES: Object.freeze({
    PAYLOAD_INVALIDO: "REAB_PAYLOAD_INVALIDO",
    SOLICITUD_REQUERIDA: "REAB_SOLICITUD_REQUERIDA",
    SOLICITUD_NO_ENCONTRADA: "REAB_SOLICITUD_NO_ENCONTRADA",
    SOLICITUD_CERRADA: "REAB_SOLICITUD_CERRADA",
    SOLICITUD_INCONSISTENTE: "REAB_SOLICITUD_INCONSISTENTE",
    SOLICITUD_DUPLICADA: "REAB_SOLICITUD_DUPLICADA",
    PARTIDA_NO_ENCONTRADA: "REAB_PARTIDA_NO_ENCONTRADA",
    PARTIDA_DUPLICADA: "REAB_PARTIDA_DUPLICADA",
    PARTIDA_YA_ATENDIDA: "REAB_PARTIDA_YA_ATENDIDA",
    TRANSICION_INVALIDA: "REAB_TRANSICION_INVALIDA",
    IDUNICO_REQUERIDO: "REAB_IDUNICO_REQUERIDO",
    IDUNICO_NO_ENCONTRADO: "REAB_IDUNICO_NO_ENCONTRADO",
    IDUNICO_DUPLICADO: "REAB_IDUNICO_DUPLICADO",
    IDUNICO_CODIGO_INCORRECTO: "REAB_IDUNICO_CODIGO_INCORRECTO",
    IDUNICO_SIN_SALDO: "REAB_IDUNICO_SIN_SALDO",
    USUARIO_REQUERIDO: "REAB_USUARIO_REQUERIDO",
    USUARIO_NO_ENCONTRADO: "REAB_USUARIO_NO_ENCONTRADO",
    ENCABEZADOS_INVALIDOS: "REAB_ENCABEZADOS_INVALIDOS",
    ANCHO_INVALIDO: "REAB_ANCHO_INVALIDO",
    LIMITE_DIARIO_ALCANZADO: "REAB_LIMITE_DIARIO_ALCANZADO",
    LIMITE_PARTIDAS_EXCEDIDO: "REAB_LIMITE_PARTIDAS_EXCEDIDO",
    LIMITE_DETALLES_EXCEDIDO: "REAB_LIMITE_DETALLES_EXCEDIDO",
    LOCK_TIMEOUT: "REAB_LOCK_TIMEOUT"
  })
});

/**
 * Encabezados físicos de la hoja UBICACIONES_MAXMIN.
 *
 * El orden debe coincidir exactamente con COL.UBICACIONES_MAXMIN y con la fila 1
 * de la hoja física. Cualquier cambio requiere una migración coordinada de datos,
 * repositorio, servicio y vista.
 *
 * @readonly
 * @type {ReadonlyArray<string>}
 */
const UBICACIONES_MAXMIN_HEADERS = Object.freeze([
  "CODIGO",
  "DESCRIPCION",
  "BODEGA",
  "UBICACION",
  "EXISTENCIA",
  "PORCENTAJE",
  "MAXIMO",
  "MINIMO",
  "ZONA_BODEGA",
  "ZONA_ABASTECIMIENTO",
  "ZONA_NIVEL",
  "FECHA",
  "HORA",
  "USUARIO",
  "VALIDACION"
]);

/**
 * Ancho esperado de UBICACIONES_MAXMIN, derivado del contrato de encabezados.
 * El resultado esperado es 15 columnas, correspondientes al rango A:O.
 *
 * @readonly
 * @type {number}
 */
const UBICACIONES_MAXMIN_EXPECTED_WIDTH =
  UBICACIONES_MAXMIN_HEADERS.length;

/**
 * Configuración declarativa del módulo FormularioUbicacionesMaxMin.
 *
 * Este objeto no contiene lógica de negocio. El Repository validará el contrato
 * físico de la hoja y el Service aplicará las reglas, límites y códigos de error.
 *
 * IDENTIDAD FUNCIONAL PROPUESTA
 * - CODIGO + BODEGA + UBICACION identifica un registro lógico.
 *
 * AUTORIDAD DE CAMPOS
 * - FECHA y HORA son generadas exclusivamente por el servidor.
 * - USUARIO es seleccionado por el cliente y validado por el Service contra
 *   UsuariosRepository antes de persistirse.
 * - VALIDACION pertenece a un flujo posterior y se conserva durante la captura
 *   inicial; el navegador no puede sobrescribirla.
 * - CODIGO, BODEGA, UBICACION, MINIMO y zonas se recuperan de la fila física
 *   autoritativa cuando se actualiza mediante numFila.
 *
 * REGLAS DE CAPTURA
 * - EXISTENCIA admite enteros mayores o iguales a cero.
 * - PORCENTAJE admite enteros entre 1 y 100.
 * - Si PORCENTAJE es menor que 100, MAXIMO se calcula en el Service y se redondea
 *   al múltiplo de diez más cercano.
 * - Si PORCENTAJE es 100, MAXIMO puede capturarse; vacío equivale a EXISTENCIA.
 *
 * @readonly
 */
const UBICACIONES_MAXMIN_CONFIG = Object.freeze({
  VERSION: "UBICACIONES-MAXMIN-2026-11-06-03",
  SHEET_KEY: "UBICACIONES_MAXMIN",

  IDENTITY_FIELDS: Object.freeze([
    "CODIGO",
    "BODEGA",
    "UBICACION"
  ]),

  /** Campos generados directamente por el servidor. */
  SERVER_MANAGED_FIELDS: Object.freeze([
    "FECHA",
    "HORA"
  ]),

  /** Campos seleccionados en cliente y autorizados por el Service. */
  SERVER_VALIDATED_FIELDS: Object.freeze([
    "USUARIO"
  ]),

  /** Campos protegidos que la captura inicial debe conservar. */
  PROTECTED_FIELDS: Object.freeze([
    "VALIDACION"
  ]),

  /** Campos recuperados desde la fila física autoritativa. */
  ROW_AUTHORITATIVE_FIELDS: Object.freeze([
    "CODIGO",
    "BODEGA",
    "UBICACION",
    "MINIMO",
    "ZONA_BODEGA",
    "ZONA_ABASTECIMIENTO",
    "ZONA_NIVEL"
  ]),

  CAPTURE_RULES: Object.freeze({
    EXISTENCIA_MINIMA: 0,
    PORCENTAJE_MINIMO: 1,
    PORCENTAJE_MAXIMO: 100,
    MAXIMO_EDITABLE_AL_CIEN: true,
    MAXIMO_VACIO_AL_CIEN_USA_EXISTENCIA: true,
    REDONDEO_MAXIMO_MULTIPLO: 10
  }),

  LIMITS: Object.freeze({
    CODIGO_MAX_LENGTH: 100,
    DESCRIPCION_MAX_LENGTH: 500,
    BODEGA_MAX_LENGTH: 150,
    UBICACION_MAX_LENGTH: 150,
    ZONA_MAX_LENGTH: 150,
    USUARIO_MAX_LENGTH: 250,
    PORCENTAJE_MINIMO: 1,
    PORCENTAJE_MAXIMO: 100,
    MAX_REGISTROS_POR_LOTE: 1000,
    FILTRO_LOCAL_MIN_LENGTH: 0,
    RENDER_MAX_RESULTADOS: 100,
    LOCK_TIMEOUT_MS: 30000
  }),


  /** Configuración de observabilidad específica de UBICACIONES_MAXMIN. */
  PERFORMANCE: Object.freeze({
    ENABLED: true,
    LOG_PREFIX: "[APPALMACEN][UBICACIONES_MAXMIN][PERF]",
    MAX_MARKS: 100,
    MAX_METADATA_TEXT_LENGTH: 250,
    WARN_TOTAL_MS: 2500,
    WARN_SHEET_READ_MS: 900,
    WARN_SHEET_WRITE_MS: 700,
    WARN_LOCK_WAIT_MS: 500,
    WARN_BOOTSTRAP_MS: 1800,
    WARN_REPOSITORY_MS: 1200,
    WARN_SERVICE_MS: 2000,
    WARN_CONTROLLER_MS: 2300,
    MEASURE_RESPONSE_CHARS: true,
    INCLUDE_ROW_NUMBER: false
  }),
  ERROR_CODES: Object.freeze({
    PAYLOAD_INVALIDO: "UBMAXMIN_PAYLOAD_INVALIDO",
    USUARIO_REQUERIDO: "UBMAXMIN_USUARIO_REQUERIDO",
    USUARIO_NO_ENCONTRADO: "UBMAXMIN_USUARIO_NO_ENCONTRADO",
    USUARIO_DUPLICADO: "UBMAXMIN_USUARIO_DUPLICADO",
    CODIGO_REQUERIDO: "UBMAXMIN_CODIGO_REQUERIDO",
    BODEGA_REQUERIDA: "UBMAXMIN_BODEGA_REQUERIDA",
    UBICACION_REQUERIDA: "UBMAXMIN_UBICACION_REQUERIDA",
    EXISTENCIA_INVALIDA: "UBMAXMIN_EXISTENCIA_INVALIDA",
    MAXIMO_INVALIDO: "UBMAXMIN_MAXIMO_INVALIDO",
    MINIMO_INVALIDO: "UBMAXMIN_MINIMO_INVALIDO",
    RANGO_INVALIDO: "UBMAXMIN_RANGO_INVALIDO",
    PORCENTAJE_INVALIDO: "UBMAXMIN_PORCENTAJE_INVALIDO",
    VALIDACION_INVALIDA: "UBMAXMIN_VALIDACION_INVALIDA",
    ENCABEZADOS_INVALIDOS: "UBMAXMIN_ENCABEZADOS_INVALIDOS",
    ANCHO_INVALIDO: "UBMAXMIN_ANCHO_INVALIDO",
    REGISTRO_DUPLICADO: "UBMAXMIN_REGISTRO_DUPLICADO",
    REGISTRO_NO_ENCONTRADO: "UBMAXMIN_REGISTRO_NO_ENCONTRADO",
    LOTE_EXCEDIDO: "UBMAXMIN_LOTE_EXCEDIDO",
    LOCK_TIMEOUT: "UBMAXMIN_LOCK_TIMEOUT"
  })
});

/**
 * Contratos y reglas del dominio de la cola documental de Gestión de Material.
 *
 * RELACIÓN FUNCIONAL
 * MAT_DOCUMENTOS.COTIZACION_NUM = MAT_DOCUMENTODETALLE.COTIZACION_NUM
 *
 * REGLAS DE IDENTIDAD
 * - COTIZACION_NUM es única, obligatoria e inmutable en MAT_DOCUMENTOS.
 * - COTIZACION_NUM es obligatoria y repetible en MAT_DOCUMENTODETALLE.
 * - No puede existir detalle sin una cabecera previamente registrada.
 *
 * @readonly
 */
const GESTION_MATERIAL_DOCUMENTOS = Object.freeze({
  VERSION: "MAT-DOC-2026-10-26-01",

  CLAVES: Object.freeze({
    DOCUMENTO: "COTIZACION_NUM",
    DOCUMENTO_DETALLE: "COTIZACION_NUM",
    RELACION:
      "MAT_DOCUMENTOS.COTIZACION_NUM=MAT_DOCUMENTODETALLE.COTIZACION_NUM"
  }),

  REGLAS: Object.freeze({
    COTIZACION_UNICA_EN_DOCUMENTOS: true,
    COTIZACION_OBLIGATORIA_EN_DETALLE: true,
    COTIZACION_INMUTABLE: true,
    DETALLE_REQUIERE_CABECERA: true,
    COTIZACION_ALMACENADA_COMO_TEXTO: true
  }),

  ESTADOS_BOOLEANOS: Object.freeze({
    SI: "SI",
    NO: "NO",
    PENDIENTE: "PENDIENTE"
  }),

  PAGO_METODOS: Object.freeze({
    PENDIENTE: "PENDIENTE",
    EFECTIVO: "EFECTIVO",
    TRANSFERENCIA: "TRANSFERENCIA",
    TARJETA: "TARJETA",
    CREDITO: "CREDITO",
    CHEQUE: "CHEQUE",
    MIXTO: "MIXTO",
    NO_APLICA: "NO_APLICA"
  }),

  PAGO_VERIFICACION_ESTADOS: Object.freeze({
    PENDIENTE: "PENDIENTE",
    VERIFICADO: "VERIFICADO",
    PARCIAL: "PARCIAL",
    RECHAZADO: "RECHAZADO",
    NO_APLICA: "NO_APLICA"
  }),

  TIPOS_CONTENEDOR: Object.freeze({
    CAJA: "CAJA",
    BOLSA: "BOLSA",
    CUBETA: "CUBETA",
    COSTAL: "COSTAL",
    TARIMA: "TARIMA",
    ROLLO: "ROLLO",
    CONTENEDOR_GRANEL: "CONTENEDOR_GRANEL",
    SIN_CONTENEDOR: "SIN_CONTENEDOR"
  }),

  VERIFICACION_ERRORES: Object.freeze({
    MATERIAL_REVUELTO: "MATERIAL_REVUELTO",
    PRODUCTO_INCORRECTO: "PRODUCTO_INCORRECTO",
    CANTIDAD_DE_MAS: "CANTIDAD_DE_MAS",
    CANTIDAD_DE_MENOS: "CANTIDAD_DE_MENOS",
    DIMENSION_INCORRECTA: "DIMENSION_INCORRECTA",
    ACABADO_INCORRECTO: "ACABADO_INCORRECTO",
    CARACTERISTICA_INCORRECTA: "CARACTERISTICA_INCORRECTA",
    MATERIAL_DANADO: "MATERIAL_DANADO",
    UBICACION_INCORRECTA: "UBICACION_INCORRECTA",
    MATERIAL_SIN_ETIQUETA: "MATERIAL_SIN_ETIQUETA",
    MOVIMIENTO_NO_REGISTRADO: "MOVIMIENTO_NO_REGISTRADO",
    SALDO_SISTEMA_INCORRECTO: "SALDO_SISTEMA_INCORRECTO"
  }),

  LIMITES: Object.freeze({
    COTIZACION_NUM_MAX_LENGTH: 100,
    CLIENTE_NUM_MAX_LENGTH: 100,
    NOMBRE_MAX_LENGTH: 250,
    OBSERVACIONES_MAX_LENGTH: 1000,
    EMPAQUE_RESUMEN_MAX_LENGTH: 2000,
    CONTENEDOR_IDENTIFICADOR_MAX_LENGTH: 250,
    MAX_DETALLES_POR_COTIZACION: 2000,
    LOCK_TIMEOUT_MS: 30000
  }),

  ERRORES: Object.freeze({
    PAYLOAD_INVALIDO: "MAT_DOC_PAYLOAD_INVALIDO",
    COTIZACION_REQUERIDA: "MAT_DOC_COTIZACION_REQUERIDA",
    COTIZACION_DUPLICADA: "MAT_DOC_COTIZACION_DUPLICADA",
    COTIZACION_NO_EXISTE: "MAT_DOC_COTIZACION_NO_EXISTE",
    COTIZACION_INMUTABLE: "MAT_DOC_COTIZACION_INMUTABLE",
    DETALLE_SIN_CABECERA: "MAT_DOC_DETALLE_SIN_CABECERA",
    LOTE_DETALLE_EXCEDIDO: "MAT_DOC_LOTE_DETALLE_EXCEDIDO",
    ENCABEZADOS_INVALIDOS: "MAT_DOC_ENCABEZADOS_INVALIDOS",
    ANCHO_INVALIDO: "MAT_DOC_ANCHO_INVALIDO"
  })
});

/**
 * Encabezados físicos de las hojas documentales de GESTION3.
 * El orden debe coincidir exactamente con COL.
 *
 * @readonly
 * @type {Object<string, ReadonlyArray<string>>}
 */
const GESTION_MATERIAL_DOCUMENTOS_HEADERS = Object.freeze({
  DOCUMENTOS: Object.freeze([
    "ID_DOCUMENTO_MAT",
    "ID_CONSECUTIVODIARIO",
    "COTIZACION_FECHA",
    "COTIZACION_HORA",
    "COTIZACION_NUM",
    "CLIENTE_NUM",
    "CLIENTE_NOMBRE",
    "VENDEDOR_NOMBRE",
    "SURTIDO_NOMBRE",
    "SURTIDO_DIA",
    "SURTIDO_HORAINICIO",
    "SURTIDO_HORAFIN",
    "VERIFICADOR_NOMBRE",
    "VERIFICACION_DIA",
    "VERIFICACION_HORAINICIO",
    "VERIFICACION_HORAFIN",
    "VERIFICADO_UBICACION",
    "VERIFICADO_UBICADOFECHA",
    "VERIFICADO_UBICADOHORA",
    "EMPAQUE_RESUMEN",
    "PAGO_MONTO",
    "PAGO_METODO",
    "PAGO_VERIFICACION",
    "CFDI_USO",
    "ENTREGA_NOMBRE",
    "ENTREGA_DIA",
    "ENTREGA_HORA"
  ]),

  DOCUMENTODETALLE: Object.freeze([
    "COTIZACION_NUM",
    "SURTIDO_CODIGO",
    "SURTIDO_COMPLETO",
    "SURTIDO_FALTANTE",
    "SURTIDO_PARCIAL",
    "SURTIDO_OBSERVACIONES",
    "VERIFICACION_CORRECTO",
    "VERIFICACION_ERROR",
    "VERIFICACION_ERROR_TIPO1",
    "VERIFICACION_ERROR_TIPO2",
    "VERIFICACION_ERROR_TIPO3",
    "VERIFICACION_ERROR_TIPO4",
    "VERIFICACION_ERROR_TIPO5",
    "VERIFICADO_UBICACION",
    "VERIFICADO_UBICACIONFECHA",
    "VERIFICADO_UBICACIONHORA",
    "EMPAQUE_CONTENEDORTIPO",
    "EMPAQUE_CONTENEDORIDENTIFICADOR"
  ])
});

/** Anchos esperados derivados de los contratos de encabezados. */
const GESTION_MATERIAL_DOCUMENTOS_EXPECTED_WIDTHS = Object.freeze({
  MAT_DOCUMENTOS:
    GESTION_MATERIAL_DOCUMENTOS_HEADERS.DOCUMENTOS.length,
  MAT_DOCUMENTODETALLE:
    GESTION_MATERIAL_DOCUMENTOS_HEADERS.DOCUMENTODETALLE.length
});

/**
 * Reglas, estados, catálogos cerrados, límites y umbrales del dominio de
 * Verificación de entrada.
 *
 * Los valores de estados y eventos se persisten en hojas; por ello no deben
 * renombrarse sin una migración de datos y compatibilidad hacia atrás.
 *
 * @readonly
 */
const VERIFICACION_ENTRADA = Object.freeze({
  VERSION: "VE-2026-09-23-01",
  ESTRATEGIAS_ETIQUETA: Object.freeze({
    SKU_CANTIDAD_SEPARADOS: "SKU_CANTIDAD_SEPARADOS",
    SKU_CANTIDAD_COMPUESTO: "SKU_CANTIDAD_COMPUESTO",
    TIPO_MEDIDA_CONSECUTIVO_CANTIDAD: "TIPO_MEDIDA_CONSECUTIVO_CANTIDAD"
  }),
  ESTADOS_SESION: Object.freeze({
    BORRADOR: "BORRADOR", XML_VALIDADO: "XML_VALIDADO", EN_CAPTURA: "EN_CAPTURA",
    PAUSADA: "PAUSADA", CON_DIFERENCIAS: "CON_DIFERENCIAS", COMPLETA: "COMPLETA",
    CERRADA: "CERRADA", CANCELADA: "CANCELADA"
  }),
  ESTADOS_SKU: Object.freeze({
    PENDIENTE: "PENDIENTE", PARCIAL: "PARCIAL", COMPLETO: "COMPLETO",
    SOBRANTE: "SOBRANTE", NO_DOCUMENTADO: "NO_DOCUMENTADO",
    REQUIERE_REVISION: "REQUIERE_REVISION"
  }),
  ESTADOS_CAJA: Object.freeze({
    CAPTURADA: "CAPTURADA", CONFIRMADA: "CONFIRMADA", DUPLICADA: "DUPLICADA",
    INVALIDA: "INVALIDA", CANCELADA: "CANCELADA"
  }),
  CLASIFICACION_CONCEPTO: Object.freeze({
    PRODUCTO: "PRODUCTO", SERVICIO: "SERVICIO", MANIOBRA: "MANIOBRA",
    FLETE: "FLETE", CARGO: "CARGO", EXCLUIDO: "EXCLUIDO",
    REQUIERE_REVISION: "REQUIERE_REVISION"
  }),
  TIPOS_EVENTO: Object.freeze({
    SESION_CREADA: "SESION_CREADA", XML_VALIDADO: "XML_VALIDADO",
    CAJA_CAPTURADA: "CAJA_CAPTURADA", LECTURA_RECHAZADA: "LECTURA_RECHAZADA",
    CAJA_CANCELADA: "CAJA_CANCELADA", SESION_PAUSADA: "SESION_PAUSADA",
    SESION_REANUDADA: "SESION_REANUDADA", SESION_CERRADA: "SESION_CERRADA",
    SESION_CANCELADA: "SESION_CANCELADA"
  }),
  TIPOS_COMPROBANTE: Object.freeze({
    INGRESO: "I", PAGO: "P", EGRESO: "E", TRASLADO: "T", NOMINA: "N"
  }),
  LIMITES: Object.freeze({
    XML_MAX_BYTES: 2 * 1024 * 1024, XML_MAX_CONCEPTOS: 1000,
    BARCODE_MAX_LENGTH: 250, MAX_CAJAS_POR_SESION: 10000,
    MAX_SKUS_POR_SESION: 2000, OBSERVACION_MAX_LENGTH: 1000,
    METADATA_JSON_MAX_LENGTH: 5000
  }),
  METRICAS: Object.freeze({
    VENTANA_RITMO_MINUTOS: 5, MIN_EVENTOS_ESTIMACION: 3,
    INACTIVIDAD_ADVERTENCIA_SEGUNDOS: 300
  }),
  PERFORMANCE: Object.freeze({
    ENABLED: true, LOG_PREFIX: "[APPALMACEN][VE_PERF]", MAX_MARKS: 80,
    MAX_METADATA_TEXT_LENGTH: 500, WARN_TOTAL_MS: 3000,
    WARN_SHEET_READ_MS: 1500, WARN_SHEET_WRITE_MS: 1500,
    WARN_LOCK_WAIT_MS: 1000, MEASURE_RESPONSE_CHARS: true
  })
});

/**
 * Perfiles de lectura de etiquetas indexados por RFC normalizado.
 *
 * Cada perfil define la estrategia y las validaciones necesarias para interpretar
 * las lecturas del proveedor. Los patrones se almacenan como cadenas para que el
 * componente consumidor pueda construir RegExp de forma controlada.
 *
 * @readonly
 * @type {Object<string, Object>}
 */
const VERIFICACION_ENTRADA_PROVEEDORES = Object.freeze({
  "MAX110907KV1": Object.freeze({
    idProveedor: "10811",
    nombre: "MAXITOR SA DE CV",
    activo: true,
    versionPerfil: "1.0",
    estrategiaEtiqueta: VERIFICACION_ENTRADA.ESTRATEGIAS_ETIQUETA.SKU_CANTIDAD_COMPUESTO,
    configuracionEtiqueta: Object.freeze({
      numeroLecturasPorCaja: 2,
      ordenLecturas: Object.freeze(["SKU_PESO", "IDENTIFICADOR_SECUNDARIO"]),
      primeraLectura: Object.freeze({
        tipo: "SKU_PESO",
        separador: "'",
        patron: "^([0-9]{10})'([0-9]{1,6})$",
        codigoGrupo: 1,
        cantidadGrupo: 2,
        unidadLectura: "KG",
        codigoLongitudMinima: 10,
        codigoLongitudMaxima: 10,
        cantidadLongitudMinima: 1,
        cantidadLongitudMaxima: 6
      }),
      segundaLectura: Object.freeze({
        tipo: "IDENTIFICADOR_SECUNDARIO",
        patron: "^[0-9]{9}$",
        longitudMinima: 9,
        longitudMaxima: 9,
        interpretarComoFecha: false,
        interpretarComoLote: false,
        interpretarComoConsecutivo: false,
        tratarComoValorOpaco: true
      }),
      cantidadEntera: true,
      cantidadMinima: 1,
      cantidadMaxima: 1000000,
      permitirDecimales: false,
      permitirEspacios: false,
      trim: true,
      convertirMayusculas: true,
      timeoutEntreLecturasSegundos: 30,
      longitudesBloqueantes: false,
      requiereSegundaLectura: true,
      registrarTrasPrimeraLectura: false,
      registrarTrasSegundaLectura: true
    })
  })
});

/**
 * Contratos de encabezados para las hojas transaccionales VE_*.
 *
 * El orden es significativo y debe coincidir exactamente con COL. Estas listas se
 * usan como fuente única para validar estructura y calcular anchos esperados.
 *
 * @readonly
 * @type {Object<string, ReadonlyArray<string>>}
 */
const VERIFICACION_ENTRADA_HEADERS = Object.freeze({
  SESIONES: Object.freeze([
    "IDSESION", "HASHXML", "UUIDCFDI", "RFCEMISOR", "NOMBREEMISOR", "SERIE",
    "FOLIO", "FECHACFDI", "VERSIONCFDI", "TIPOCOMPROBANTE", "MONEDA",
    "NOMBREARCHIVO", "ESTRATEGIAETIQUETA", "ESTADOSESION", "TOTALSKUS",
    "TOTALCONCEPTOS", "CONCEPTOSEXCLUIDOS", "CANTIDADESPERADA",
    "CANTIDADCAPTURADA", "CANTIDADFALTANTE", "CANTIDADSOBRANTE", "TOTALCAJAS",
    "INICIADAPOR", "FECHAINICIO", "HORAINICIO", "FECHACIERRE", "HORACIERRE",
    "CERRADAPOR", "SEGUNDOSACTIVOS", "SEGUNDOSPAUSADOS", "OBSERVACIONCIERRE",
    "RESULTADOFINAL", "VERSIONPERFIL", "CREADOEN", "ACTUALIZADOEN"
  ]),
  DETALLE: Object.freeze([
    "IDDETALLE", "IDSESION", "RFCEMISOR", "CODIGOPROVEEDORXML", "CODIGOINTERNO",
    "IDPRODUCTO", "DESCRIPCIONXML", "DESCRIPCIONINTERNA", "CLAVEPRODSERV",
    "CLAVEUNIDADXML", "UNIDADXML", "UNIDADINTERNA", "FACTORCONVERSION",
    "CANTIDADXML", "CANTIDADESPERADA", "CANTIDADCAPTURADA", "CANTIDADFALTANTE",
    "CANTIDADSOBRANTE", "TOTALCAJAS", "ESTADOSKU", "CLASIFICACION",
    "INCLUIRENCONTEO", "CONFIANZACLASIFICACION", "MOTIVOEXCLUSION",
    "RENGLONESORIGINALES", "REQUIEREREVISION", "OBSERVACION", "CREADOEN",
    "ACTUALIZADOEN"
  ]),
  CAJAS: Object.freeze([
    "IDUNICOCAJA", "IDSESION", "IDDETALLE", "RFCEMISOR", "CODIGOPROVEEDORXML",
    "CODIGOETIQUETA", "CODIGOINTERNO", "IDPRODUCTO", "CANTIDADCAJA", "UNIDAD",
    "CONSECUTIVOPROVEEDOR", "ESTRATEGIAETIQUETA", "HUELLALECTURA",
    "LONGITUDLECTURA", "ESTADOCAJA", "RESULTADOVALIDACION", "ADVERTENCIAS",
    "CAPTURADAPOR", "FECHACAPTURA", "HORACAPTURA", "CANCELADAPOR",
    "FECHACANCELACION", "HORACANCELACION", "MOTIVOCANCELACION", "OBSERVACION",
    "CREADOEN"
  ]),
  EVENTOS: Object.freeze([
    "IDEVENTO", "IDSESION", "TIPOEVENTO", "IDUNICOCAJA", "IDDETALLE",
    "CODIGOINTERNO", "CANTIDAD", "ESTADOANTERIOR", "ESTADONUEVO", "RESULTADO",
    "CODIGOMOTIVO", "MENSAJE", "USUARIO", "ROLUSUARIO", "FECHA", "HORA",
    "TIMESTAMPMS", "METADATAJSON", "CREADOEN"
  ]),
  EQUIVALENCIAS: Object.freeze([
    "IDEQUIVALENCIA", "RFCEMISOR", "IDPROVEEDOR", "CODIGOPROVEEDORXML",
    "CODIGOETIQUETA", "CODIGOINTERNO", "IDPRODUCTO", "DESCRIPCIONINTERNA",
    "CLAVEUNIDADXML", "UNIDADXML", "UNIDADINTERNA", "FACTORCONVERSION",
    "TIPOCONCEPTO", "ACTIVO", "NIVELCONFIANZA", "ORIGENREGLA", "FECHAINICIO",
    "FECHAFIN", "CREADOPOR", "FECHACREACION", "MODIFICADOPOR",
    "FECHAMODIFICACION", "OBSERVACION"
  ])
});

/**
 * Encabezados de la fuente no transaccional del catálogo de proveedores.
 * Se mantiene separado para distinguir datos maestros de registros operativos.
 *
 * @readonly
 * @type {ReadonlyArray<string>}
 */
const VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES_HEADERS = Object.freeze([
  "ID_FILA", "ID_PRECIO_COMPRA", "ID_PRODUCTO", "CODIGO_PRODUCTO",
  "NOMBRE_PRODUCTO", "STATUS_PRODUCTO", "ID_PROVEEDOR", "CODIGO_PROVEEDOR",
  "NOMBRE_PROVEEDOR", "RFC_PROVEEDOR", "CODIGO_PRODUCTO_PROVEEDOR",
  "PRECIO_COMPRA", "ID_MONEDA", "MONEDA", "SIMBOLO", "ID_UNIDAD", "UNIDAD",
  "TIMESTAMP"
]);

/** Ancho derivado del contrato del catálogo de proveedores. */
const VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES_WIDTH =
  VERIFICACION_ENTRADA_CATALOGO_PROVEEDORES_HEADERS.length;

/**
 * Anchos esperados de las hojas transaccionales.
 *
 * Se derivan de los contratos de encabezados para evitar números mágicos y reducir
 * el riesgo de inconsistencias al agregar o retirar columnas.
 *
 * @readonly
 * @enum {number}
 */
const VERIFICACION_ENTRADA_EXPECTED_WIDTHS = Object.freeze({
  VERIFICACION_ENTRADA_SESIONES:
    VERIFICACION_ENTRADA_HEADERS.SESIONES.length,
  VERIFICACION_ENTRADA_DETALLE:
    VERIFICACION_ENTRADA_HEADERS.DETALLE.length,
  VERIFICACION_ENTRADA_CAJAS:
    VERIFICACION_ENTRADA_HEADERS.CAJAS.length,
  VERIFICACION_ENTRADA_EVENTOS:
    VERIFICACION_ENTRADA_HEADERS.EVENTOS.length,
  VERIFICACION_ENTRADA_EQUIVALENCIAS:
    VERIFICACION_ENTRADA_HEADERS.EQUIVALENCIAS.length
});

/**
 * Configuración general de identidad, composición, pruebas, carga, temas y rutas
 * de APPALMACEN. Las clases CSS forman parte del contrato con la interfaz cliente.
 */
const APPALMACEN_BRAND = Object.freeze({
  APP_NAME: "Gestión de Almacén",
  APP_SUBTITLE: "Birlos y Tornillos",
  DOCUMENT_TITLE: "Sistema de Gestión - Birlos y Tornillos",
  LOGO_URL: "https://lirp.cdn-website.com/32df9ef3/dms3rep/multi/opt/logo_408868407-1920w.png",
  LOGO_FALLBACK: "GA"
});

const APPALMACEN_TEMPLATE = Object.freeze({
  DEFAULT_PAGE: "APPALMACEN",
  IMPORT_BUNDLE: "full",
  LABEL: Object.freeze({ WIDTH: 12.5, HEIGHT: 8 })
});

const APPALMACEN_SIDEBAR_THEMES = Object.freeze({
  dark: Object.freeze({
    backgroundClass: "bg-[#1c1d1f] text-white",
    dividerClass: "bg-gray-700/50",
    categoryClass: "text-gray-500",
    inactiveToolClass: "text-gray-400 hover:bg-white/5 hover:text-white",
    activeToolClass: "bg-[#d93025] text-white shadow-lg shadow-red-900/20",
    brandTitleClass: "text-white",
    brandSubtitleClass: "text-[#d93025]",
    themeButtonClass: "bg-white/10 text-white hover:bg-white/15 border border-white/10"
  }),
  light: Object.freeze({
    backgroundClass: "bg-[#f8f9fa] text-[#1c1d1f]",
    dividerClass: "bg-[#e8eaed]",
    categoryClass: "text-[#6b7280]",
    inactiveToolClass: "text-[#5f6368] hover:bg-[#eef0f3] hover:text-[#1c1d1f]",
    activeToolClass: "bg-[#d93025] text-white shadow-lg shadow-red-900/20",
    brandTitleClass: "text-[#1c1d1f]",
    brandSubtitleClass: "text-[#d93025]",
    themeButtonClass: "bg-white text-[#5f6368] hover:bg-[#f1f3f4] border border-[#dadce0] shadow-sm"
  })
});

/** Alias de compatibilidad para consumidores del tema oscuro del sidebar. */
const APPALMACEN_SIDEBAR_DARK = APPALMACEN_SIDEBAR_THEMES.dark;

const APPALMACEN_COMPONENTS = Object.freeze({
  SIDEBAR: Object.freeze({
    ACTIVE: "sidebar1",
    THEME: "dark",
    CLIENT_COMPONENTS: Object.freeze({ sidebar1: "Sidebar1", sidebar2: "Sidebar2" })
  }),
  LOADER: Object.freeze({ THEME: "app" })
});

const APPALMACEN_TESTING = Object.freeze({
  ENABLED: true,
  QUERY_PARAM: "view",
  TESTS: Object.freeze({
    sidebars: Object.freeze({ KEY: "pruebas", FILE: "Pruebas", TITLE: "Pruebas Sidebars" })
  })
});

const APPALMACEN_LOADER = Object.freeze({
  ROOT_ID: "fito-preloader",
  MODE: "fullscreen",
  LOADING_TEXT: "Inicializando sistema"
});

const APPALMACEN_THEME = Object.freeze({
  black: Object.freeze({
    key: "black", label: "black", loader: "black",
    colors: Object.freeze({
      primary: "#d93025", background: "#0f1115", surface: "#1c1d1f",
      surfaceSoft: "#26282d", textMain: "#ffffff", textMuted: "#b8bdc7",
      textSoft: "#8b909b", border: "rgba(255,255,255,0.12)",
      borderSoft: "rgba(255,255,255,0.08)", white: "#ffffff"
    }),
    components: Object.freeze({
      appBackgroundClass: "bg-[#0f1115]", mainClass: "bg-[#0f1115]",
      headerClass: "bg-[#1c1d1f] border-b border-white/10 text-white",
      viewCardClass: "bg-[#1c1d1f] border border-white/10 text-white shadow-xl",
      buttonPrimaryClass: "bg-[#d93025] text-white hover:bg-[#b3261e]",
      buttonSecondaryClass: "bg-[#26282d] text-white border border-white/10 hover:bg-white/10",
      inputClass: "bg-[#1c1d1f] border border-white/10 text-white placeholder:text-gray-500"
    }),
    toast: Object.freeze({
      background: "#1c1d1f", color: "#ffffff", iconColor: "#d93025", borderLeft: "#d93025"
    })
  }),
  white: Object.freeze({
    key: "white", label: "white", loader: "white",
    colors: Object.freeze({
      primary: "#d93025", background: "#f8f9fa", surface: "#ffffff",
      surfaceSoft: "#f1f3f4", textMain: "#1c1d1f", textMuted: "#5f6368",
      textSoft: "#9aa0a6", border: "#dadce0", borderSoft: "#e8eaed", white: "#ffffff"
    }),
    components: Object.freeze({
      appBackgroundClass: "bg-[#f8f9fa]", mainClass: "bg-[#f8f9fa]",
      headerClass: "bg-white border-b border-[#dadce0] text-[#1c1d1f]",
      viewCardClass: "bg-white border border-[#dadce0] text-[#1c1d1f] shadow-sm",
      buttonPrimaryClass: "bg-[#d93025] text-white hover:bg-[#b3261e]",
      buttonSecondaryClass: "bg-white text-[#1c1d1f] border border-[#dadce0] hover:bg-slate-50",
      inputClass: "bg-white border border-[#dadce0] text-[#1c1d1f] placeholder:text-gray-400"
    }),
    toast: Object.freeze({
      background: "#1c1d1f", color: "#ffffff", iconColor: "#d93025", borderLeft: "#d93025"
    })
  })
});

/** Clave del tema visual activo por defecto. */
const APPALMACEN_THEME_ACTIVE = "white";

const APPALMACEN_ROUTING = Object.freeze({
  PAGES_ALLOWED: Object.freeze([
    "APPALMACEN", "Pruebas", "FormularioTraspasos", "MonitorTraspasos",
    "HistorialTraspasos", "PrototipoTraspasos", "ConciliacionSaldo",
    "VerificacionEntrada", "FormularioEtiquetas", "FormularioEtiquetasIdentificadoras",
    "FormularioEtiquetasExcedentes", "FormularioEtiquetasExcedentesReimpresion",
    "GestorExcedentes", "ConsultaExcedentes", "NegativosBirlos",
    "MonitorReabastecimiento", "AuditoriaExcedentes", "AuditoriaExcedentesCaptura",
    "AuditoriaExcedentesDetalle", "PrototipoExcedentes", "FormularioDetallesProducto",
    "FormularioUbicacionesMaxMin", "Reabastecimiento",
    "ReabastecimientoSolicitud", "ReabastecimientoDetalles"
  ]),
  PRINT_PAGES: Object.freeze(["imprimir", "EtiquetaExcedentesImpresa"]),
  TEST_PAGE: "Pruebas",
  ERRORS: Object.freeze({
    PAGE_NOT_FOUND_PREFIX: "Error: '",
    PAGE_NOT_FOUND_SUFFIX: "' no existe.",
    PRINT_ERROR_TITLE: "Error en Impresión"
  })
});

/**
 * Mapeo de grupos de bodegas hacia las columnas consolidadas de EXISTENCIAS.
 * `nombres` contiene las variantes físicas aceptadas por la normalización.
 *
 * @readonly
 */
const EXISTENCIAS_BODEGAS = Object.freeze({
  ALMACEN_BIRLOS: Object.freeze({
    key: "ALMACENBIRLOS", column: COL.EXISTENCIAS.ALMACENBIRLOS,
    nombres: Object.freeze(["1 - ALMACEN BIRLOS"])
  }),
  EXCEDENTE_BODEGA: Object.freeze({
    key: "EXCEDENTEBODEGA", column: COL.EXISTENCIAS.EXCEDENTEBODEGA,
    nombres: Object.freeze([
      "BODEGA 1", "BODEGA 2", "BODEGA 3", "BODEGA MOSTRADOR",
      "CUARTO ALTO RIESGO", "MOSTRADOR"
    ])
  }),
  EXCEDENTE_CASABLANCA: Object.freeze({
    key: "EXCEDENTECASABLANCA", column: COL.EXISTENCIAS.EXCEDENTECASABLANCA,
    nombres: Object.freeze(["CASA BLANCA 1", "CASA BLANCA 2"])
  })
});

/**
 * Punto de entrada publicado de la aplicación web.
 * La URL identifica un despliegue, pero no sustituye controles de autorización.
 *
 * @readonly
 */
const APPALMACEN_WEBAPP = Object.freeze({
  URL: "https://script.google.com/macros/s/AKfycbyu75nLi2e1gREn7Atp3qb6UPyIEn4ioXQkawl7slQxtHrz-UNW1tJBFakA6HdpLeY0dw/exec"
});
