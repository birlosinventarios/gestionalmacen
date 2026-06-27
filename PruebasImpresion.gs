/**
 * PruebasImpresion.gs 
 */

function probarImpresionFija() {
  // 1. TU TUNEL PERMANENTE RECIÉN CREADO
  const URL_IMPRESORA = "https://trowel-narrow-collector.ngrok-free.dev/print"; 
  
  // 2. TU TOKEN REAL EXTRAÍDO DE TU SERVER.JS
  const TOKEN_SECRETO = "Birlosytornillos123456"; 
  
  // 3. TEXTO FORMATEADO INDUSTRIALMENTE PARA ANCHO DE 100MM (Aprox 48-50 caracteres por línea)
  const contenidoTicket = 
    "================================================\n" +
    "          BIRLOS Y TORNILLOS INVENTARIOS        \n" +
    "================================================\n\n" +
    "          AUDITORIA DE ENLACE FIJO          \n\n" +
    " ---------------------------------------------- \n" +
    "  FECHA:     " + new Date().toLocaleDateString() + "\n" +
    "  HORA:      " + new Date().toLocaleTimeString() + "\n" +
    "  RED:       ngrok Secure Cloud Edge\n" +
    "  ESTADO:    ONLINE (PUENTE VERIFICADO)\n" +
    "  HARDWARE:  IMPRESORA TERMICA GD-40\n" +
    "  LIENZO:    ETIQUETA INDUSTRIAL 100x150 mm\n" +
    " ---------------------------------------------- \n\n" +
    "             CONEXION EXITOSA AL 100%           \n" +
    "       LISTO PARA PROCESAR LOS 16,000 SKUS      \n\n" +
    "================================================\n" +
    "       CORRIENDO DESDE GOOGLE APPS SCRIPT       \n" +
    "================================================\n" +
    "\n\n\n\n"; // Saltos de línea al final para que la etiquetadora avance hasta el corte

  const payload = {
    content: contenidoTicket
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": "Bearer " + TOKEN_SECRETO
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  Logger.log("Iniciando transmisión dimensionada hacia el almacén...");
  
  try {
    const response = UrlFetchApp.fetch(URL_IMPRESORA, options);
    const codigoRespuesta = response.getResponseCode();
    const cuerpoRespuesta = response.getContentText();
    
    if (codigoRespuesta === 200 && cuerpoRespuesta === "OK") {
      Logger.log("¡ÉXITO! El servidor local procesó y mandó a la cola de la GD-40.");
    } else {
      Logger.log("Respuesta del servidor (Código " + codigoRespuesta + "): " + cuerpoRespuesta);
    }
  } catch(e) {
    Logger.log("Error de conexión: " + e.toString());
  }
}