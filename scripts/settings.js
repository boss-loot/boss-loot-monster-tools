import { MODULE_NAME, SETTING_GUIDELINES, BASE_GUIDELINES } from "./constants.js";
import { GuidelinesTable } from "./app/GuidelinesTable.js";

export async function monsterToolSettings() {
  game.settings.register(MODULE_NAME, SETTING_GUIDELINES, {
    name: game.i18n.localize(`${MODULE_NAME}.Settings.GuidelinesSettingName`),
    scope: "world",
    config: false,
    type: Object,
    default: BASE_GUIDELINES,
  });

  game.settings.registerMenu(MODULE_NAME, "guidelinesEditor", {
    name: game.i18n.localize(`${MODULE_NAME}.Settings.GuidelinesMenuName`),
    label: game.i18n.localize(`${MODULE_NAME}.Settings.GuidelinesMenuLabel`),
    hint: game.i18n.localize(`${MODULE_NAME}.Settings.GuidelinesMenuHint`),
    icon: "fa-solid fa-table",
    type: GuidelinesTable,
    restricted: true,
  });
}
