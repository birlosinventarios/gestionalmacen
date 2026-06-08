
/**
 * CONSTANTS.gs
 * Configuración central de archivos fuente, hojas y columnas
 */

/** EJEMPLO PARA IDENTIFICAR EL ID DEL ARCHIVO DESDE EL LINK, SECCION ENTRE COMILLAS.
 * SIEMPRE ES LA LINEA DE CODIGO DESPUES DEL /d/ Y ANTES DEL /edit
 * GESTION: https://docs.google.com/spreadsheets/d/1xPMnPg_-m7yQQoMq6ku1iwyXRlZC-RjypGpC_2gv4xE/edit?gid=0#gid=0
 * PEDIDOS: https://docs.google.com/spreadsheets/d/1PJh2JaMH2FVDNOzZ7vTcKlFSJ48R5rYGjsF_HyjMWO0/edit?gid=177457208#gid=177457208
 */

/**
 * IDs de archivos fuente
 */
const FILES = {
  GESTION: "1xPMnPg_-m7yQQoMq6ku1iwyXRlZC-RjypGpC_2gv4xE",
  PEDIDOS: "1PJh2JaMH2FVDNOzZ7vTcKlFSJ48R5rYGjsF_HyjMWO0"
};

/* Nombres de las hojas por archivo */
const SHEETS = {
  
  CATALOGO: {
      file: "GESTION",
      name: "CATALOGO"
    },

  ETIQUETAS: {
      file: "GESTION",
      name: "ETIQUETAS"
    }, 

  EXCEDENTES: {
      file: "GESTION",
      name: "BD-EXCEDENTES"
    }, 

  TRASPASOS: {
      file: "GESTION",
      name: "Bitacora-TRASPASOS"
    },

  UBICACIONES_EXCEDENTES: {
      file: "GESTION",
      name: "UBICACIONES"
    },  

  UBICACIONES_SURTIDO: {
      file: "GESTION",
      name: "UBICACIONES_SURTIDO"
    },  

  USUARIOS: {
      file: "GESTION",
      name: "USUARIOS"
    },

  EXISTENCIAS: {
      file: "GESTION",
      name: "EXISTENCIAS"
    },

  MAXMIN: {
      file: "GESTION",
      name: "MAXMIN"
    }
};


/** Indices de columnas
 * A = 0
 */
const COL = {

  CATALOGO: {
    IDPRODUCTO: 0,          
    CODIGO: 1,     
    DESCRIPCION: 2,
    STATUS: 3   
  },

  USUARIOS:{
    IDUSUARIOS: 0,
    NOMBRE: 1,
    ROL: 2
  },

  ETIQUETAS:{
    NOMBRE: 0,
    ANCHO: 1,
    ALTO: 2
  },

  UBICACIONES_EXCEDENTES:{
    IDUBICACIONES_EXCEDENTES: 0,
    BODEGA: 1,
    UBICACION: 2
  },

  UBICACIONES_SURTIDO:{
    IDUBICACION: 0,
    CODIGO: 1,
    BODEGA: 2,
    PASILLO: 3,
    ANAQUEL: 4,
    REPISA: 5,
    IDPRODUCTO: 6,
    UBICACION: 7
  },
    
  EXCEDENTES:{
    IDUNICO: 0,
    FECHA: 1,
    HORA: 2,
    IDPRODUCTO: 3,
    CODIGO: 4,
    DESCRIPCION: 5,
    CANTIDAD: 6,
    STATUS: 7
  },

  TRASPASOS:{
    FECHA: 0,
    HORA: 1,
    TIPOMOVIMIENTO: 2,
    SERIE: 3,
    BODEGA_SALIDA: 4,
    UBICACION_SALIDA: 5,
    BODEGA_ENTRADA: 6,
    UBICACION_ENTRADA: 7,
    SOLICITANTE: 8,
    CODIGO: 9,
    DESCRIPCION: 10,
    CANTIDAD: 11,
    FOLIO: 12,
    RESPONSABLE: 13,
    IDUNICO: 14
  },

  EXISTENCIAS:{
    IDPRODUCTO: 0,
    CODIGO: 1,
    DESCRIPCION: 2,
    ALMACENBIRLOS: 3,
    EXCEDENTEBODEGA: 4,
    EXCEDENTECASABLANCA: 5
  },

  MAXMIN:{
    CODIGO: 0,
    MINIMO: 1,
    MAXIMO: 2
  },
}; 
