import { DAMAGE_BASELINE_VERSION, MODULE_NAME, NAMESPACE } from './constants.js';
import { cloneDamagePart, prepareItemForBackup } from './utils.js';

export async function addMultiattack(actor, numberOfAttacks, monsterCR, trackRollback = true) {
  const MM_MULTIATTACK = 'Compendium.dnd-monster-manual.features.Item.mmMultiattack000';
  const SRD_MULTIATTACK = 'Compendium.dnd5e.monsterfeatures24.Item.mmMultiattack000';

  const guidelineTable = game.i18n.localize(`${MODULE_NAME}.MonsterTools.GuidelinesTableButton`);
  const attacks = numberOfAttacks === 'one' ? 'attack' : 'attacks';

  const blmtDescription = `<p><strong>Boss Loot Note:</strong> Based on the ${guidelineTable}, the [[lookup @name lowercase]] makes ${numberOfAttacks} ${attacks} on CR ${monsterCR}.</p>`;

  let multiattackItem = getMultiattackItem(actor);
  const backupData = foundry.utils.getProperty(actor, `flags.${MODULE_NAME}.backupData`) ?? {};
  const originalMultiattack = backupData.originalMultiattack;

  // Create item if missing
  if (!multiattackItem) {
    if (numberOfAttacks === 'one') return null; // If CR indicates only one attack, do not create Multiattack

    const sourceItem = (await fromUuid(MM_MULTIATTACK)) ?? (await fromUuid(SRD_MULTIATTACK));

    if (!sourceItem) {
      console.warn(`${NAMESPACE} | Could not find a Multiattack source item in compendiums.`);
      return null;
    }

    const multiattackItemData = sourceItem.toObject();
    foundry.utils.setProperty(multiattackItemData, 'system.description.value', blmtDescription);

    const [newItem] = await actor.createEmbeddedDocuments('Item', [multiattackItemData]);

    if (!originalMultiattack && trackRollback) {
      const newFlag = foundry.utils.mergeObject(backupData, {
        originalMultiattack: {
          status: 'create',
          uuid: newItem.uuid,
          description: blmtDescription,
        },
      });
      await actor.setFlag(MODULE_NAME, 'backupData', newFlag);
    }

    return newItem;
  }

  // Backup existing item once
  if (!originalMultiattack && trackRollback) {
    const newFlag = foundry.utils.mergeObject(backupData, {
      originalMultiattack: {
        status: 'update',
        uuid: multiattackItem.uuid,
        description: multiattackItem.system.description.value ?? '',
      },
    });
    await actor.setFlag(MODULE_NAME, 'backupData', newFlag);
  }

  const baseDescription =
    foundry.utils.getProperty(actor, `flags.${MODULE_NAME}.backupData.originalMultiattack.description`) ??
    multiattackItem.system.description.value;
  const newDescription = `${baseDescription}\n${blmtDescription}`;

  await multiattackItem.update({
    'system.description.value': newDescription,
  });

  return multiattackItem;
}

export function getAbilityScore(actor) {
  const abilities = foundry.utils.getProperty(actor, 'system.abilities');

  const out = {};
  for (const key of Object.keys(CONFIG.DND5E.abilities)) {
    const val = abilities[key].value;
    out[key] = val;
  }
  return out;
}

export function setAbilityScore(actor, bonus, updates) {
  const delta = Number(bonus);
  if (bonus === 0) return;
  const abilities = foundry.utils.getProperty(actor, 'system.abilities');
  for (const key of Object.keys(CONFIG.DND5E.abilities)) {
    const val = abilities[key].value;
    if (val <= 10) continue;
    let newVal = Math.clamp(val + delta, 10, 30);
    updates[`system.abilities.${key}.value`] = newVal;
  }
}

export async function scaleDamageDiceOnItems(actor, damageDelta, trackRollback = true) {
  if (damageDelta === 0) return { changed: 0 };

  const items = actor.items?.contents;
  if (!items.length) return { changed: 0 };

  const stored = foundry.utils.deepClone(actor.getFlag(MODULE_NAME, 'backupData.originalDamageDice') ?? {}); // stored flag
  const originals = stored?._v === DAMAGE_BASELINE_VERSION ? stored : { _v: DAMAGE_BASELINE_VERSION }; // original items data

  const updates = [];
  let changed = 0;

  for (const item of items) {
    if (item?.type === 'spell') continue;

    const update = { _id: item.id };
    let changedItem = false;
    const normalized = prepareItemForBackup(originals[item.id]);
    // {
    // "item": null,
    // "activities": {}
    // }

    const damage = foundry.utils.getProperty(item, 'system.damage');
    const base = damage?.base;
    const versatile = damage?.versatile;

    if (base) {
      normalized.item ??= {};
      if (normalized.item.base == null) normalized.item.base = cloneDamagePart(base);
      const newBase = scaleDamageData(base, damageDelta);

      if (newBase && !foundry.utils.objectsEqual(newBase, base)) {
        update['system.damage.base'] = newBase;
        changedItem = true;
      }
    }

    if (versatile) {
      normalized.item ??= {};
      if (normalized.item.versatile == null) normalized.item.versatile = cloneDamagePart(versatile);
      const newVersatile = scaleDamageData(versatile, damageDelta);

      if (newVersatile && !foundry.utils.objectsEqual(newVersatile, versatile)) {
        update['system.damage.versatile'] = newVersatile;
        changedItem = true;
      }
    }

    const allActivities = item.system.activities?.contents ?? [];
    if (allActivities.length > 0) {
      for (const activity of allActivities) {
        const activityId = activity.id;

        if (!activityId) continue;

        const activityDamage = activity?.damage ?? {};
        const activityParts = activityDamage?.parts?.filter(part => !part?.base);

        if (activityParts) {
          normalized.activities[activityId] ??= {};
          if (normalized.activities[activityId].parts == null) {
            normalized.activities[activityId].parts = cloneDamagePart(activityParts);
          }

          const newParts = scaleDamageData(activityParts, damageDelta);
          if (newParts && !foundry.utils.objectsEqual(newParts, activityParts)) {
            update[`system.activities.${activityId}.damage.parts`] = newParts;
            changedItem = true;
          }
        }
      }
    }

    if (changedItem) {
      originals[item.id] = normalized;
      updates.push(update);
      changed++;
    }
  }

  if (updates.length) {
    await actor.updateEmbeddedDocuments('Item', updates);

    if (trackRollback) {
      await actor.setFlag(MODULE_NAME, 'backupData', { originalDamageDice: originals });
    }
  }

  return { changed };
}

export async function rollbackActor(actor) {
  const updates = {};
  const flagData = foundry.utils.getProperty(actor, `flags.${MODULE_NAME}.backupData`);

  if (foundry.utils.isEmpty(flagData)) return;

  const originalAC = foundry.utils.getProperty(flagData, 'originalAC');
  if (!foundry.utils.isEmpty(originalAC)) {
    updates['system.attributes.ac.value'] = originalAC.value;
  }

  const originalName = foundry.utils.getProperty(flagData, 'originalName');
  if (originalName) {
    updates.name = originalName;
  }

  const originalHp = foundry.utils.getProperty(flagData, 'originalHP');
  if (!foundry.utils.isEmpty(originalHp)) {
    updates['system.attributes.hp.max'] = originalHp.max;
    updates['system.attributes.hp.value'] = originalHp.value;
  }

  const originalInitiativeBonus = foundry.utils.getProperty(flagData, 'originalInitiativeBonus');
  if (!foundry.utils.isEmpty(originalInitiativeBonus)) {
    updates['system.attributes.init.bonus'] = originalInitiativeBonus;
  }

  const originalCr = foundry.utils.getProperty(flagData, 'originalCR');
  if (originalCr !== undefined && originalCr !== null) {
    updates['system.details.cr'] = originalCr;
  }

  const originalAbilities = foundry.utils.getProperty(flagData, 'originalAbilities');
  if (!foundry.utils.isEmpty(originalAbilities)) {
    for (const [key, val] of Object.entries(originalAbilities)) {
      if (val != null) updates[`system.abilities.${key}.value`] = val;
    }
  }

  const itemUpdateMap = new Map();
  const origDamageDice = foundry.utils.getProperty(flagData, 'originalDamageDice');
  if (!foundry.utils.isEmpty(origDamageDice)) {
    for (const [itemId, entry] of Object.entries(origDamageDice)) {
      if (itemId === '_v') continue;
      const update = itemUpdateMap.get(itemId) ?? { _id: itemId };
      const itemDamage = entry?.item;
      if (itemDamage?.base != null) update['system.damage.base'] = itemDamage.base;
      if (itemDamage?.versatile != null) update['system.damage.versatile'] = itemDamage.versatile;
      const activities = entry?.activities ?? {};
      for (const [actId, act] of Object.entries(activities)) {
        if (act?.parts != null) update[`system.activities.${actId}.damage.parts`] = act.parts;
      }
      itemUpdateMap.set(itemId, update);
    }
  }

  // Rollback all the items
  if (itemUpdateMap.size) {
    await actor.updateEmbeddedDocuments('Item', Array.from(itemUpdateMap.values()));
  }

  // Rollback the Multiattack
  const origMultiattack = foundry.utils.getProperty(flagData, 'originalMultiattack');
  if (!foundry.utils.isEmpty(origMultiattack)) {
    const multiattackItem = await fromUuid(origMultiattack.uuid);
    if (origMultiattack.status === 'create') {
      await multiattackItem.delete();
    } else {
      await multiattackItem.update({ 'system.description.value': origMultiattack.description });
    }
  }

  // Rollback the actor
  if (Object.keys(updates).length) await actor.update(updates);

  // Remove the entire backup flag
  await actor.unsetFlag(MODULE_NAME, 'backupData');
}

function scaleDamageData(damageData, delta) {
  if (!damageData) return null;

  if (Array.isArray(damageData)) {
    return damageData
      .filter(part => !part?.base) // exclude base === true (redundant)
      .map(part => scaleDamageDataPart(part, delta));
  }

  return scaleDamageDataPart(damageData, delta);
}

function scaleDamageDataPart(part, delta) {
  if (!part) return part;

  const clone = cloneDamagePart(part);
  if (clone.custom?.enabled && clone.custom?.formula) {
    let roll = new Roll(clone.custom.formula);
    roll = roll.alter(1, delta, { multiplyNumeric: false });
    if (delta < 0) roll = clampDice(roll);
    clone.custom.formula = roll.formula;
    return clone;
  }

  const num = Number(clone.number);
  const den = Number(clone.denomination);
  if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0) {
    clone.number = Math.max(1, num + delta);
  }

  return clone;
}

function clampDice(roll) {
  for (const term of roll.terms) {
    if (term instanceof foundry.dice.terms.DiceTerm) {
      term.number = Math.max(1, term.number ?? 1);
    }
  }
  roll.resetFormula();
  return roll;
}

function getMultiattackItem(actor) {
  if (!actor?.items) return null;

  return (
    actor.items.find(
      item => item.type === 'feat' && (item.system?.identifier === 'multiattack' || item.name?.trim().toLowerCase() === 'multiattack')
    ) ?? null
  );
}
