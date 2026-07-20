/**
 * PruebasImpresion.gs
 */

function probarImpresionFija() {
  const URL_IMPRESORA = "https://trowel-narrow-collector.ngrok-free.dev/print";
  const TOKEN_SECRETO = PropertiesService
    .getScriptProperties()
    .getProperty("PRINT_BRIDGE_TOKEN");

  if (!TOKEN_SECRETO) {
    throw new Error("No está configurado PRINT_BRIDGE_TOKEN en Script Properties.");
  }


  const contenidoTicket =
    "================================================\n" +
    "          BIRLOS Y TORNILLOS INVENTARIOS        \n" +
    "================================================\n\n" +
    "          AUDITORIA DE ENLACE FIJO              \n\n" +
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
    "\n\n\n\n";

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
  } catch (e) {
    Logger.log("Error de conexión: " + e.toString());
  }
}

function probarHealthGD40() {
  const url = "https://trowel-narrow-collector.ngrok-free.dev/health";

  const options = {
    method: "get",
    headers: {
      "ngrok-skip-browser-warning": "69420"
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);

  Logger.log("Código: " + response.getResponseCode());
  Logger.log("Respuesta: " + response.getContentText());
}

/**
 * Ejecutar una sola vez.
 * Guarda configuración en Script Properties.
 */
function configurarPuenteImpresionOnline() {
  PropertiesService.getScriptProperties().setProperties({
    PRINT_BRIDGE_URL: "https://trowel-narrow-collector.ngrok-free.dev/print",
    PRINT_BRIDGE_HEALTH_URL: "https://trowel-narrow-collector.ngrok-free.dev/health",
    PRINT_BRIDGE_TOKEN: "Birlosytornillos123456"
  });

  Logger.log("Propiedades de impresión ONLINE configuradas.");
}

/**
 * Verifica qué configuración está leyendo el nuevo service.
 */
function probarConfigImpresionPuente() {
  const res = ImpresionPuenteService.debugConfig();
  Logger.log(JSON.stringify(res, null, 2));
}

/**
 * Prueba health usando el nuevo ImpresionPuenteService.
 */
function probarHealthImpresionPuente() {
  const res = ImpresionPuenteService.health();
  Logger.log(JSON.stringify(res, null, 2));
}

/**
 * Prueba impresión usando el nuevo ImpresionPuenteService.
 */
function probarImpresionPuenteOnline() {
  const printJob = {
    tipo: "TEST",
    origen: "APPALMACEN",
    content:
      "================================================\n" +
      "        BIRLOS Y TORNILLOS INVENTARIOS\n" +
      "================================================\n\n" +
      "          PRUEBA IMPRESION ONLINE\n\n" +
      "FECHA/HORA: " + new Date().toLocaleString() + "\n" +
      "MODO: ONLINE\n" +
      "PUENTE: NGROK / SERVER LOCAL\n\n" +
      "Si esta etiqueta sale, el puente ONLINE funciona.\n\n" +
      "================================================\n" +
      "\n\n\n\n",
    meta: {
      modulo: "TEST",
      origen: "Apps Script"
    }
  };

  const res = ImpresionPuenteService.imprimir(printJob);
  Logger.log(JSON.stringify(res, null, 2));
}