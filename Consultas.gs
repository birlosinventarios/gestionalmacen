function obtenerMegaDataInicial() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. USUARIOS
    const hojaUsuarios = ss.getSheetByName('USUARIOS');
    const dataUsuarios = hojaUsuarios.getRange(2, 1, hojaUsuarios.getLastRow() - 1, 3).getValues();
    const usuariosProcesados = dataUsuarios
      .map(f => ({
        nombre: String(f).trim(),
        rol: String(f).trim().toUpperCase()
      }))
      .filter(u => u.nombre !== "")
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
      
    // 2. UBICACIONES
    const datosUbi = ss.getSheetByName('UBICACIONES').getDataRange().getValues().slice(1);
    const bodegas = [...new Set(datosUbi.map(f => f))].filter(Boolean).sort();
    const mapaUbicaciones = datosUbi.map(f => ({
      bodega: String(f).trim().toUpperCase(),
      ubi: String(f).trim()
    })).filter(f => f.bodega && f.ubi);

    // 3. CATALOGO DE PRODUCTOS (Aquí es donde estaba el ajuste)
    const hojaCat = ss.getSheetByName('CATALOGO');
    const dataCat = hojaCat.getRange(2, 1, hojaCat.getLastRow() - 1, 3).getValues();
    
    let catalogoParaFrontend = []; // Este es el que espera el formulario
    let mapaProductos = {};
    let todosLosCodigos = [];
    
    dataCat.forEach(f => {
      const id = String(f).trim();
      const codigo = String(f).trim().toUpperCase();
      const descripcion = String(f).trim();

      if (codigo) {
        // Creamos el objeto que el formulario de excedentes necesita
        catalogoParaFrontend.push({
          codigo: codigo,
          desc: descripcion,
          id: id
        });

        // Mantenemos estos por si otras vistas los usan
        mapaProductos[codigo] = { id: id, descripcion: descripcion };
        todosLosCodigos.push(codigo);
      }
    });

    // 4. CONFIGURACIÓN DE ETIQUETAS
    const hojaConfig = ss.getSheetByName('ETIQUETAS');
    let mapaMedidas = {};
    if (hojaConfig) {
      const dataMedidas = hojaConfig.getDataRange().getValues().slice(1);
      dataMedidas.forEach(f => {
        if(f) mapaMedidas[f] = { alto: f, ancho: f };
      });
    }

    // RETORNO MAESTRO
    return { 
      usuarios: usuariosProcesados, 
      bodegas: bodegas, 
      mapaUbicaciones: mapaUbicaciones,
      codigos: todosLosCodigos.sort(),
      mapaProductos: mapaProductos,
      mapaMedidas: mapaMedidas,
      nombresEtiquetas: Object.keys(mapaMedidas),
      catalogo: catalogoParaFrontend // <--- ¡ESTA ES LA PROPIEDAD QUE FALTABA!
    }; 
    
  } catch (e) {
    Logger.log("Error en MegaData Unificado: " + e.message);
    return { usuarios: [], bodegas: [], catalogo: [], codigos: [] };
  }
}

function buscarCodigosPorFiltro(termino) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('CATALOGO'); // Ajusta al nombre de tu hoja
  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues().flat();
  const filtro = termino.toUpperCase();

  // Filtrado rápido y limitación de resultados
  const resultados = datos
    .filter(codigo => codigo && String(codigo).toUpperCase().includes(filtro))
    .slice(0, 25); // No satures el DOM con más de 25 opciones

  return resultados;
}


function buscarProductoPorCodigo(codigo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('CATALOGO');
  const filtro = codigo.trim().toUpperCase();
  
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return { encontrado: false };

  // Leemos desde la fila 2, columna 2 (B) y traemos 2 columnas (B y C)
  // data[x][0] será la columna B (Código)
  // data[x][1] será la columna C (Descripción)
  const data = hoja.getRange(2, 2, ultimaFila - 1, 2).getValues();
  
  const filaEncontrada = data.find(f => String(f[0]).trim().toUpperCase() === filtro);

  if (filaEncontrada) {
    return { 
      encontrado: true, 
      descripcion: filaEncontrada[1] 
    };
  }
  
  return { encontrado: false };
}

function obtenerUbicacionesPorBodega(bodegaNombre) {
  if (!bodegaNombre) return [];
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('UBICACIONES'); // Asegúrate que el nombre sea exacto
    const fullData = hoja.getDataRange().getValues();
    
    // Supongamos: Columna B (index 1) es Bodega, Columna C (index 2) es Ubicación
    const ubicaciones = fullData
      .slice(1) // Quitamos encabezados
      .filter(fila => {
        // Limpieza de datos para comparación segura
        const bodegaFila = String(fila[1]).trim().toUpperCase();
        const bodegaBusqueda = String(bodegaNombre).trim().toUpperCase();
        return bodegaFila === bodegaBusqueda;
      })
      .map(fila => String(fila[2]).trim()) // Extraer ubicación
      .filter((valor, indice, self) => valor !== "" && self.indexOf(valor) === indice); // Únicos y no vacíos

    return ubicaciones.sort(); // Ordenar A-Z
  } catch (e) {
    console.error("Error: " + e.message);
    throw new Error("No se pudo acceder a la hoja de Ubicaciones");
  }
}

function procesarLoteEtiquetas(lote) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = _obtenerContextoTemporal(ss); // Reutilizamos tu función de fecha/hora
  
  // Inyectamos el Folio Único a cada etiqueta del lote
  const loteConFolio = lote.map(item => {
    // Generamos el folio usando la lógica: marcatiempobase&idcodigo&#caja
    // Como aquí no hay "caja" de destino, usamos "ALM" o el ID
    const marcaTiempo = config.fecha.split('/').reverse().join('') + config.hora.replace(/:/g, '');
    item.folio = `${marcaTiempo}&${item.codigo}&#ETIQ`; 
    return item;
  });

  const tmpl = HtmlService.createTemplateFromFile('EtiquetaIdentificadoraImpresa');
  tmpl.lote = loteConFolio;
  tmpl.fechaHora = config.fecha + " " + config.hora;
  
  return tmpl.evaluate().getContent();
}

/**
 * Obtiene las filas de la Bitácora que NO tienen Folio (Col M) o Responsable (Col N)
 */
function obtenerTraspasosPendientes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('Bitacora-TRASPASOS');
  if (!hoja) return [];

  const data = hoja.getDataRange().getValues();
  const encabezados = data[0];
  const filas = data.slice(1);

  // Mapeo dinámico basado en tu estructura A-N
  return filas.map((f, index) => {
    return {
      fila: index + 2, // Guardamos el número de fila real para actualizar después
      tipo: f[2],       // Col C
      serie: f[3],      // Col D
      origen: f[4],     // Col E
      uSalida: f[5],    // Col F
      destino: f[6],    // Col G
      uEntrada: f[7],   // Col H
      solicitante: f[8], // Col I
      codigo: f[9],     // Col J
      descripcion: f[10], // Col K
      cantidad: f[11],  // Col L
      folio: f[12],     // Col M
      responsable: f[13], // Col N
      // Propiedad auxiliar para el separador visual en el HTML
      bodegaOriginal: f[2] === "Acomodo" ? f[6] : f[4] 
    };
  }).filter(item => {
    // FILTRO CRÍTICO: Solo lo que no tiene Folio O Responsable
    return (!item.folio || String(item.folio).trim() === "") || 
           (!item.responsable || String(item.responsable).trim() === "");
  });
}

/**
 * Obtiene la lista de usuarios con rol de responsable (Hoja USUARIOS)
 */
function obtenerAgentesResponsables() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('USUARIOS');
  if (!hoja) return ["Admin"];
  
  // Asumiendo que los nombres están en la Col B (index 1)
  return hoja.getDataRange().getValues().slice(1)
    .map(f => f[1])
    .filter(Boolean)
    .sort();
}


/**
 * Esta función es la que llama tu formulario Generador de Etiquetas
 */
function procesarLoteEtiquetasExcedentes(lote) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const config = _obtenerContextoTemporal(ss); 
    
    // --- PASO CRÍTICO: Guardar en Base de Datos primero ---
    // Si esto falla, el catch atrapará el error y no se imprimirá nada
    guardarExcedentesEnBD(lote, config);
    
    // --- PASO 2: Generar la plantilla de impresión ---
    const tmpl = HtmlService.createTemplateFromFile('EtiquetaExcedentesImpresa');
    
    tmpl.lote = lote.map(item => {
      return {
        codigo: item.codigo,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        id: item.id,           // ID del catálogo para QR
        idUnico: item.idUnico, // Folio único generado en el cliente
        cajaNo: item.cajaNo,
        totalCajas: item.totalCajas
      };
    });
    
    tmpl.fechaHora = config.fecha + " " + config.hora;
    
    return tmpl.evaluate().getContent();
    
  } catch (e) {
    console.error("Error en proceso unificado de excedentes: " + e.message);
    throw new Error(e.message); 
  }
}

function procesarReimpresionExcedentes(lote) {
  const template = HtmlService.createTemplateFromFile('EtiquetaExcedentesImpresa');
  template.lote = lote;
  return template.evaluate().getContent();
}

function obtenerTodosLosCodigos() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('CATALOGO');
    if (!hoja) return [];
    
    // Suponiendo que los códigos están en la Columna B (2)
    const ultimaFila = hoja.getLastRow();
    if (ultimaFila < 2) return [];
    
    const codigos = hoja.getRange(2, 2, ultimaFila - 1, 1).getValues()
      .flat() // Convierte [[cod1], [cod2]] en [cod1, cod2]
      .filter(Boolean) // Quita vacíos
      .map(c => String(c).trim().toUpperCase()); // Normaliza
      
    return [...new Set(codigos)].sort(); // Devuelve únicos ordenados
  } catch (e) {
    console.error("Error al cargar códigos: " + e.message);
    return [];
  }
}

/**
 * Sanitización de Grado Industrial para IDs
 * Elimina cualquier metadato de fecha inyectado por el motor de GAS.
 */
function limpiarID(valor) {
  if (valor === undefined || valor === null || valor === "") return "";
  // Forzamos String y cortamos en el primer espacio o coma
  return String(valor).split(/[ ,]+/)[0].trim();
}

function buscarPorCodigo() {
  const cod = document.getElementById('codigoInput').value.trim().toUpperCase();
  if (!cod) return;

  google.script.run.withSuccessHandler(res => {
    if (res.encontrado) {
      document.getElementById('descripcionInput').value = res.descripcion;
      // IMPORTANTE: Asegúrate de que res.id sea el nombre correcto de la propiedad que viene del mapaProductos en consultas.gs
      document.getElementById('idInput').value = res.id || "Error-Sin-ID"; 
    } else {
      lanzarNotificacion("❌ Producto no encontrado", "error");
      limpiarCampos();
    }
  }).buscarProductoPorCodigo(cod);
}

function buscarProductoPorCodigo(codigo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('CATALOGO');
  const filtro = codigo.trim().toUpperCase();
  
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return { encontrado: false };

  // Cambiamos el rango para incluir la Columna A (ID), B (Código) y C (Descripción)
  // getRange(fila, columna, numFilas, numColumnas)
  const data = hoja.getRange(2, 1, ultimaFila - 1, 3).getValues();
  
  // f[0] es ID (Col A), f[1] es Código (Col B), f[2] es Descripción (Col C)
  const filaEncontrada = data.find(f => String(f[1]).trim().toUpperCase() === filtro);

  if (filaEncontrada) {
    return { 
      encontrado: true, 
      id: filaEncontrada[0], // <--- AHORA SÍ ENVIAMOS EL ID
      descripcion: filaEncontrada[2] 
    };
  }
  
  return { encontrado: false };
}

function obtenerTodaLaBaseExcedentes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombreHoja = 'BD-EXCEDENTES';
  
  try {
    const hoja = ss.getSheetByName(nombreHoja);
    if (!hoja) return [];

    const valores = hoja.getDataRange().getValues(); 
    if (valores.length <= 1) return [];

    // Saltamos la cabecera con slice(1)
    return valores.slice(1)
      .filter(fila => fila && String(fila).trim() !== "") // Filtramos si la Columna A (IDUNICO) está vacía
      .map((fila, index) => {
        
        // --- Procesamiento de Fecha (Columna B -> índice 1) ---
        let fechaProcesada = "";
        try {
          if (fila instanceof Date) {
            fechaProcesada = Utilities.formatDate(fila, "GMT-6", "yyyy-MM-dd");
          } else {
            fechaProcesada = String(fila || "");
          }
        } catch(e) { fechaProcesada = ""; }

        // --- Retorno del objeto con índices de columna correctos ---
        return {
          eidFila:      index + 2,
          idUnico:      String(fila || "").trim(),      // Col A (Índice 0)
          efecha:       fechaProcesada,                    // Col B (Índice 1)
          ehora:        String(fila || "").trim(),      // Col C (Índice 2)
          eidProducto:  String(fila || "").trim(),      // Col D (Índice 3)
          ecodigo:      String(fila || "").trim(),      // Col E (Índice 4)
          edescripcion: String(fila || "").trim(),      // Col F (Índice 5)
          ecantidad:    Number(fila || 0),              // Col G (Índice 6)
          estatus:      String(fila || "").trim()       // Col H (Índice 7)
        };
      });
  } catch (err) {
    console.error("Error en obtenerTodaLaBaseExcedentes: " + err.message);
    return [];
  }
}

function obtenerContenidoVista(nombreArchivo) {
  try {
    // 1. Creamos un template desde el archivo
    const template = HtmlService.createTemplateFromFile(nombreArchivo);
    
    // 2. .evaluate() procesa los scriptlets <?!= ... ?> y devuelve un HtmlOutput
    // 3. .getContent() extrae el HTML ya procesado (con estilos y sub-vistas incluidos)
    return template.evaluate().getContent();
  } catch (e) {
    return "<p>Error al cargar la vista: " + e.toString() + "</p>";
  }
}

function navegarA(nombreVista) {
    console.log("Navegando a:", nombreVista);
    lanzarNotificacion("Cargando...", "info");

    google.script.run
        .withSuccessHandler(function(html) {
            const contenedor = document.getElementById('contenedor-principal');
            
            // 1. Limpiamos el contenedor
            contenedor.innerHTML = html;

            // 2. RE-EJECUCIÓN MANUAL DE SCRIPTS
            const scripts = contenedor.querySelectorAll("script");
            scripts.forEach(oldScript => {
                const newScript = document.createElement("script");
                // Copiamos el contenido del script
                newScript.text = oldScript.innerHTML;
                // Lo pegamos en el body para que el navegador lo ejecute y lo borramos de inmediato
                document.body.appendChild(newScript).parentNode.removeChild(newScript);
            });

            // 3. DISPARADOR DE CARGA
            setTimeout(() => {
                const nombreFuncion = "cargar_" + nombreVista;
                if (typeof window[nombreFuncion] === "function") {
                    console.log("🚀 Disparando función: " + nombreFuncion);
                    window[nombreFuncion]();
                } else {
                    console.error("❌ No se encontró la función: " + nombreFuncion);
                }
            }, 600); // Aumentamos un poco el tiempo para asegurar estabilidad
        })
        .obtenerContenidoVista(nombreVista);
}

/**
 * Función de respaldo: Si la vista no tiene una función "cargar_", 
 * esto obliga a los scripts <script> dentro del HTML a ejecutarse.
 */
function forzarEjecucionScripts(contenedor) {
    const scripts = contenedor.querySelectorAll("script");
    scripts.forEach(oldScript => {
        const newScript = document.createElement("script");
        Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
        newScript.appendChild(document.createTextNode(oldScript.innerHTML));
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
}

function obtenerEstadoFolios() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('BD-EXCEDENTES');
  
  if (!hoja) {
    Logger.log("Error: No se encontró la hoja BD-EXCEDENTES");
    return [];
  }

  try {
    const data = hoja.getDataRange().getValues();
    if (data.length <= 1) return []; // Solo encabezados o vacía

    // Quitamos los encabezados y mapeamos los datos
    // Usamos la estructura definida en COL_BDEXCED de Operaciones.gs
    return data.slice(1).map(fila => {
      return {
        idUnico: String(fila).trim(),       // Columna A (IDUNICO)
        fecha: fila,                        // Columna B
        sku: String(fila).trim(),           // Columna E (CODIGO)
        descripcion: String(fila).trim(),   // Columna F (DESCRIPCION)
        balance: Number(fila) || 0,         // Columna G (CANTIDAD)
        ubicacionActual: "EXCEDENTE"           // Valor fijo o mapear si tienes columna de ubi
      };
    }).filter(item => item.idUnico !== "" && item.balance > 0); // Solo IDs válidos con stock

  } catch (e) {
    Logger.log("Error en obtenerEstadoFolios: " + e.message);
    return [];
  }
}