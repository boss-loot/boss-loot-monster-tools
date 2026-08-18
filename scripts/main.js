import { MODULE_NAME } from "./constants.js";
import { monsterToolSettings } from "./settings.js";
import { MonsterTools } from "./app/MonsterTools.js";
import { getSelectedNPCs, getUniqueActorIds } from "./utils.js";

Hooks.once("init", monsterToolSettings);

Hooks.on("renderTokenHUD", (app, htmlElement, _data) => {
  if (!game.user.isGM) return;

  const actor = app.object.actor;
  if (!actor || actor.type !== "npc") return;

  const container = htmlElement.querySelector(".col.right");
  if (!container) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "control-icon";
  btn.dataset.action = "monster-tool";
  btn.dataset.tooltip = game.i18n.localize(`${MODULE_NAME}.MonsterTools.HeaderButton`);

  const img = document.createElement("img");
  img.src = `modules/${MODULE_NAME}/artwork/monster-tools-icon-1.webp`;
  img.alt = "";
  btn.appendChild(img);

  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const npcData = getSelectedNPCs();
    if (getUniqueActorIds(npcData.actors).size > 1) {
      ui.notifications.warn(game.i18n.localize(`${MODULE_NAME}.Notifications.SingleActorOnly`));
      return;
    }
    new MonsterTools(npcData).render({ force: true });
  });

  container.appendChild(btn);
});
