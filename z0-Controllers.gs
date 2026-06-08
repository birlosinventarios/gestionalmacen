/**
 * Carga de datos inicial para formularios
 */
function getDataInicial() {
  return BootstrapServices.getInfoInicial();
}


/**
 * Controller público para NegativosBirlos.html
 */
function obtenerNegativosBirlosCompleto() {
  try {
    const data = NegativosBirlosService.getVista();

    console.log("=====================================");
    console.log("📥 [Controller] obtenerNegativosBirlosCompleto()");
    console.log("📦 Tipo:", typeof data);
    console.log("📊 Negativos:", (data.negativos || []).length);
    console.log("📍 Ubicaciones surtido:", (data.ubicacionesSurtido || []).length);
    console.log("📄 Muestra negativos:", JSON.stringify((data.negativos || []).slice(0, 3), null, 2));
    console.log("📄 Muestra ubicaciones:", JSON.stringify((data.ubicacionesSurtido || []).slice(0, 3), null, 2));
    console.log("=====================================");

    return data;

  } catch (error) {
    console.error("🚨 ERROR EN CONTROLLER obtenerNegativosBirlosCompleto():", error);
    return {
      negativos: [],
      ubicacionesSurtido: []
    };
  }
}


/**
 * Carga de datos para TRASPASOS PENDIENTES - MonitorTraspasos.html
 */
function obtenerTraspasosPendientes() {
  try {
    // ✅ Resolver el archivo correcto desde CONSTANTS
    const ssTraspasos = getSpreadsheetByFileKey_(SHEETS.TRASPASOS.file);
    const zonaHoraria = ssTraspasos.getSpreadsheetTimeZone();

    const data = TraspasosService.getPendientes();

    const salida = data.map(x => ({
      fila: Number(x.fila || 0),

      // ✅ Convertimos fechas/horas a STRING plano usando la TZ del archivo configurado
      fechatraspaso: x.fechatraspaso
        ? Utilities.formatDate(new Date(x.fechatraspaso), zonaHoraria, "dd/MM/yyyy")
        : "",

      horatraspaso: x.horatraspaso
        ? Utilities.formatDate(new Date(x.horatraspaso), zonaHoraria, "HH:mm:ss")
        : "",

      tipomovimiento: String(x.tipomovimiento || ""),
      serie: String(x.serie || ""),
      bodegasalida: String(x.bodegasalida || ""),
      ubicacionsalida: String(x.ubicacionsalida || ""),
      bodegaentrada: String(x.bodegaentrada || ""),
      ubicacionentrada: String(x.ubicacionentrada || ""),
      solicitante: String(x.solicitante || ""),
      codigo: String(x.codigo || ""),
      descripcion: String(x.descripcion || ""),
      cantidad: Number(x.cantidad || 0),
      folio: String(x.folio || ""),
      responsable: String(x.responsable || ""),
      idunico: String(x.idunico || "")
    }));

    console.log("=====================================");
    console.log("📥 [Controller] obtenerTraspasosPendientes()");
    console.log("📦 Tipo:", typeof salida);
    console.log("🧪 ¿Es Array?:", Array.isArray(salida));
    console.log("📊 Total registros:", salida.length);
    console.log("📄 Muestra:", JSON.stringify(salida.slice(0, 3), null, 2));
    console.log("=====================================");

    return salida;

  } catch (error) {
    console.error("🚨 ERROR EN CONTROLLER obtenerTraspasosPendientes():", error);
    return [];
  }
}


/**
 * Debug completo de traspasos pendientes
 * Ordena por fila ascendente antes de mostrar
 */
function debugTraspasosPendientes() {
  try {
    const data = TraspasosService.getPendientes();

    console.log("=====================================");
    console.log("📥 [Controller] RESPUESTA COMPLETA:");

    // 🔍 Tipo de objeto
    console.log("📦 Tipo:", typeof data);
    console.log("🧪 ¿Es Array?:", Array.isArray(data));

    // 🔢 Tamaño
    if (Array.isArray(data)) {
      console.log("📊 Total registros:", data.length);
    } else {
      console.log("⚠️ No es un array válido");
    }

    // 📄 Ordenar por fila ascendente y mostrar los últimos 20
    if (Array.isArray(data) && data.length > 0) {
      const ordenadosPorFila = [...data].sort((a, b) => {
        return Number(a.fila || 0) - Number(b.fila || 0);
      });

      const ultimos20 = ordenadosPorFila.slice(-20);

      console.log("📄 Últimos 20 registros ordenados por fila ascendente:");
      console.log(JSON.stringify(ultimos20, null, 2));

    } else {
      console.log("🛑 No hay registros para mostrar");
    }

    console.log("=====================================");

    return data;

  } catch (error) {
    console.error("🚨 ERROR EN CONTROLLER:", error);
    return [];
  }
}
``