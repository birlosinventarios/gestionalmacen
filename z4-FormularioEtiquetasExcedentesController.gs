/**
 * FormularioEtiquetasExcedentesController.gs
 *
 * Puerta de entrada pública entre google.script.run y
 * FormularioEtiquetasExcedentesService.
 *
 * Responsabilidades:
 * - Exponer las operaciones públicas utilizadas por la vista.
 * - Validar la forma básica de los argumentos recibidos.
 * - Registrar información operativa no sensible para diagnóstico.
 * - Delegar las reglas de negocio al Service.
 * - Mantener el manejo uniforme de errores mediante execController_().
 *
 * Decisión funcional vigente:
 * - El responsable de impresión se selecciona en la vista.
 * - No se restringe por rol.
 * - El Service valida que el responsable sea obligatorio y uniforme en el lote.
 * - El Controller no modifica ni reemplaza al responsable recibido.
 *
 * Este archivo no debe:
 * - Leer o escribir directamente en hojas de cálculo.
 * - Construir filas para BD-EXCEDENTES.
 * - Generar HTML de impresión.
 * - Validar productos, cantidades o reglas de negocio completas.
 * - Confiar en el rol del navegador para autorizar la operación.
 *
 * Dependencias:
 * - execController_()
 * - FormularioEtiquetasExcedentesService
 */

"use strict";

/** Nombre lógico utilizado por execController_ para trazabilidad. */
const CTRL_EXCEDENTES = "FormularioEtiquetasExcedentesController";

/**
 * Normaliza un valor textual para validaciones básicas del Controller.
 *
 * No sustituye las funciones de normalización del dominio utilizadas por el
 * Service. Su finalidad es únicamente evitar errores al inspeccionar el
 * contrato recibido.
 *
 * @param {*} value Valor recibido.
 * @return {string}
 */
function FormularioEtiquetasExcedentesController_toText_(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

/**
 * Obtiene metadatos seguros de un lote para diagnóstico.
 *
 * No registra nombres de usuarios, códigos, cantidades, identificadores ni el
 * contenido completo del payload. Únicamente informa la estructura general.
 *
 * @param {*} lote Valor recibido desde la vista.
 * @return {{
 *   esArreglo:boolean,
 *   total:number,
 *   elementosObjeto:number,
 *   elementosConResponsable:number,
 *   responsableUniforme:boolean
 * }}
 */
function FormularioEtiquetasExcedentesController_obtenerMetadataLote_(lote) {
  const esArreglo = Array.isArray(lote);

  if (!esArreglo) {
    return {
      esArreglo: false,
      total: 0,
      elementosObjeto: 0,
      elementosConResponsable: 0,
      responsableUniforme: false
    };
  }

  let elementosObjeto = 0;
  let elementosConResponsable = 0;
  const responsables = {};

  lote.forEach(function(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return;
    }

    elementosObjeto += 1;

    const responsable =
      FormularioEtiquetasExcedentesController_toText_(
        item.responsableImpresion
      ).toUpperCase();

    if (responsable) {
      elementosConResponsable += 1;
      responsables[responsable] = true;
    }
  });

  return {
    esArreglo: true,
    total: lote.length,
    elementosObjeto: elementosObjeto,
    elementosConResponsable: elementosConResponsable,
    responsableUniforme:
      elementosConResponsable === lote.length &&
      Object.keys(responsables).length === 1
  };
}

/**
 * Devuelve la información inicial requerida por la vista.
 *
 * @return {{codigos:Array<string>, mapaCatalogo:Object}}
 */
function FormularioEtiquetasExcedentesController_getBootstrap() {
  return execController_(
    CTRL_EXCEDENTES,
    "getBootstrap",
    function() {
      return FormularioEtiquetasExcedentesService.getBootstrap();
    }
  );
}

/**
 * Busca un producto por código cuando no se encuentra en el índice local de
 * la vista.
 *
 * La validación definitiva del código corresponde al Service.
 *
 * @param {*} codigo Código solicitado por la vista.
 * @return {Object}
 */
function FormularioEtiquetasExcedentesController_buscarProductoPorCodigo(
  codigo
) {
  return execController_(
    CTRL_EXCEDENTES,
    "buscarProductoPorCodigo",
    function() {
      return FormularioEtiquetasExcedentesService.buscarProductoPorCodigo(
        codigo
      );
    }
  );
}

/**
 * Procesa un lote de etiquetas de excedentes.
 *
 * El Controller valida únicamente la forma general del argumento. El Service
 * valida productos, cantidades, identificadores, responsable de impresión,
 * uniformidad del responsable, estructura de BD-EXCEDENTES e impresión.
 *
 * El responsable se recibe desde la selección realizada en la vista. No se
 * aplica validación por rol y el Controller no altera su valor.
 *
 * @param {Array<Object>} lote Etiquetas preparadas por la vista.
 * @return {Object} Resultado del registro y preparación de impresión.
 */
function FormularioEtiquetasExcedentesController_procesarLote(lote) {
  return execController_(
    CTRL_EXCEDENTES,
    "procesarLote",
    function() {
      const metadata =
        FormularioEtiquetasExcedentesController_obtenerMetadataLote_(lote);

      console.log(
        "[APPALMACEN][ETIQUETAS_EXCEDENTES][LOTE_RECIBIDO] " +
        JSON.stringify(metadata)
      );

      if (!metadata.esArreglo) {
        throw new Error(
          "El lote de etiquetas de excedentes debe ser un arreglo."
        );
      }

      if (metadata.total === 0) {
        throw new Error(
          "El lote de etiquetas de excedentes está vacío."
        );
      }

      if (metadata.elementosObjeto !== metadata.total) {
        throw new Error(
          "El lote de etiquetas de excedentes contiene elementos inválidos."
        );
      }

      /*
       * No se rechaza aquí por responsable ausente o inconsistente.
       * El Service es la autoridad de dominio y producirá el mensaje detallado
       * correspondiente a la posición exacta o a la inconsistencia del lote.
       */
      return FormularioEtiquetasExcedentesService.procesarLote(lote);
    }
  );
}
