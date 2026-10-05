/**
 * NegativosBirlosController.gs
 */

const CTRL_NEGATIVOS_BIRLOS = "NegativosBirlosController";

function NegativosBirlosController_getVista() {
  return execController_(
    CTRL_NEGATIVOS_BIRLOS,
    "getVista",
    () => NegativosBirlosService.getVista()
  );
}
