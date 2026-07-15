/**
 * ImpresionPrintJobBuilder.gs
 * Construye paquetes ONLINE compatibles con server.js /print { content }.
 */

const ImpresionPrintJobBuilder = (() => {

  function _line_(char, len) {
    return Array((len || 48) + 1).join(char || "-");
  }

  function _cut_(value, max) {
    const s = String(value || "");
    return s.length > max ? s.slice(0, max) : s;
  }

  function buildExcedentesJob(lote, fechaHora, meta) {
    const lista = Array.isArray(lote) ? lote : [];

    if (!lista.length) {
      throw new Error("No hay etiquetas de excedentes para imprimir ONLINE.");
    }

    let content = "";

    lista.forEach((item, index) => {
      content += _line_("=", 48) + "\n";
      content += "        BIRLOS Y TORNILLOS\n";
      content += "          ETIQUETA EXCEDENTE\n";
      content += _line_("=", 48) + "\n";
      content += "ETQ: " + (index + 1) + " / " + lista.length + "\n";
      content += "FECHA: " + String(fechaHora || "") + "\n";
      content += _line_("-", 48) + "\n";
      content += "SKU:  " + _cut_(item.codigo, 40) + "\n";
      content += "DESC: " + _cut_(item.descripcion, 40) + "\n";
      content += "CANT: " + String(item.cantidad || 0) + " PZAS\n";
      content += "ID:   " + String(item.idUnico || item.id || "") + "\n";

      if (item.ubicacion) {
        content += "UBI:  " + String(item.ubicacion || "") + "\n";
      }

      content += _line_("=", 48) + "\n\n\n\n";
    });

    return {
      tipo: "EXCEDENTES",
      origen: "APPALMACEN",
      content: content,
      meta: meta || {}
    };
  }

  function buildIdentificadorasJob(lote, fechaHora, meta) {
    const lista = Array.isArray(lote) ? lote : [];

    if (!lista.length) {
      throw new Error("No hay etiquetas identificadoras para imprimir ONLINE.");
    }

    let content = "";

    lista.forEach((item, index) => {
      content += _line_("=", 48) + "\n";
      content += "        BIRLOS Y TORNILLOS\n";
      content += "       ETIQUETA IDENTIFICADORA\n";
      content += _line_("=", 48) + "\n";
      content += "ETQ: " + (index + 1) + " / " + lista.length + "\n";
      content += "FECHA: " + String(fechaHora || "") + "\n";
      content += _line_("-", 48) + "\n";
      content += "SKU:  " + _cut_(item.codigo, 40) + "\n";
      content += "DESC: " + _cut_(item.descripcion, 40) + "\n";
      content += "ID:   " + String(item.id || item.idproducto || "") + "\n";
      content += "TIPO: " + String(item.tipo || "") + "\n";
      content += _line_("=", 48) + "\n\n\n\n";
    });

    return {
      tipo: "IDENTIFICADORAS",
      origen: "APPALMACEN",
      content: content,
      meta: meta || {}
    };
  }

  return {
    buildExcedentesJob,
    buildIdentificadorasJob
  };

})();