/* Nombres de las hojas, origenes de datos */
const SHEETS = {
  CATALOGO: "CATALOGO",
  UBICACIONES_EXCEDENTES: "UBICACIONES",
  UBICACIONES_SURTIDO: "UBICACIONES_SURTIDO", // si es otra hoja real
  USUARIOS: "USUARIOS",
  ETIQUETAS: "ETIQUETAS",
  EXCEDENTES: "BD-EXCEDENTES",
  TRASPASOS: "Bitacora-TRASPASOS"
};


/* # de la columa a la que pertenece el encabezado, el numero se toma en cuenta como columna A = 0 */
const COL = {

  CATALOGO: {
    ID: 0,          
    CODIGO: 1,     
    DESCRIPCION: 2   
  },

  USUARIOS:{
    ID: 0,
    NOMBRE: 1,
    ROL: 2
  },

  ETIQUETAS:{
    ID: 0,
    NOMBRE: 1,
    ANCHO: 2,
    ALTO: 3
  },

  UBICACIONES_EXCEDENTES:{
    ID: 0,
    BODEGA: 1,
    UBICACION: 2
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
  }
}; 
