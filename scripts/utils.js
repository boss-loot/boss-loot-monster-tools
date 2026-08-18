import { MODULE_NAME, BASE_GUIDELINES, SETTING_GUIDELINES, CR_ORDER } from "./constants.js";

export function getSelectedNPCs() {
  const allTokens = canvas.tokens.controlled ?? [];
  const tokens = allTokens.filter((t) => t?.actor?.type === "npc");

  const actorMap = new Map();
  const actors = [];

  for (const token of tokens) {
    const actor = token?.actor;
    if (!actor) continue;

    const isLinked = token.actor.prototypeToken.actorLink;
    if (isLinked) {
      if (actorMap.has(actor.id)) continue;
      actorMap.set(actor.id, actor);
      actors.push(actor);
      continue;
    }
    actors.push(actor);
  }

  return { tokens, actors };
}

export function getUniqueActorIds(actors = []) {
  const ids = new Set();
  for (const actor of actors) {
    if (actor?.id) ids.add(actor.id);
  }
  return ids;
}

export function crNumberToString(cr) {
  if (cr == null || Number.isNaN(cr)) return null;

  switch (cr) {
    case 0:
      return "0";
    case 0.125:
      return "1/8";
    case 0.25:
      return "1/4";
    case 0.5:
      return "1/2";
    default:
      return String(cr);
  }
}

export function crStringToNumber(cr) {
  if (typeof cr !== "string") return Number(cr);

  if (!cr.includes("/")) {
    return Number(cr);
  }

  const [num, den] = cr.split("/").map(Number);

  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return NaN;
  }

  return num / den;
}

export function formatSignedNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "n/a";
  }
  return n >= 0 ? `+${n}` : `${n}`;
}

export function prepareItemForBackup(entry) {
  const out = foundry.utils.deepClone(entry ?? {});
  out.item = out.item ?? null;
  out.activities = out.activities ?? {};
  return out;
}

export function cloneDamagePart(part) {
  if (part?.toObject) return part.toObject();
  return foundry.utils.deepClone(part);
}

export function chooseHp(crData, mode) {
  const hpData = crData?.pubHp;
  if (!hpData) return null;

  const { min, max, avg } = hpData;
  switch (mode) {
    case "min":
      return min;
    case "max":
      return max;
    case "random": {
      return Math.floor(min + Math.random() * (max - min + 1));
    }
    case "avg":
    default:
      return avg;
  }
}

export function getGuidelinesTable() {
  const base = foundry.utils.deepClone(BASE_GUIDELINES);
  const stored = game.settings.get(MODULE_NAME, SETTING_GUIDELINES);

  const merged = stored
    ? foundry.utils.mergeObject(base, stored, {
        inplace: false,
        insertKeys: true,
        insertValues: true,
      })
    : base;

  // Add the CR to the table
  for (const [crKey, row] of Object.entries(merged)) {
    if (!row || typeof row !== "object") continue;
    row.cr = crKey;
  }

  return merged;
}

//    **************************
//      J S O N   P A R S E R
//    **************************

function isObject(obj) {
  return obj != null && typeof obj === "object" && !Array.isArray(obj);
}

function isFiniteNumber(no) {
  return typeof no === "number" && Number.isFinite(no);
}

function validateGuidelineEntry(crEntry, crKey, { strictKeys = true } = {}) {
  const errors = [];

  if (!isObject(crEntry)) {
    errors.push(`CR ${crKey}: entry must be an object`);
    return errors;
  }

  const requiredFileds = Array.from(Object.keys(BASE_GUIDELINES[0]));
  const hpFiledKeys = Array.from(Object.keys(BASE_GUIDELINES[0].pubHp));

  for (const val of requiredFileds) {
    if (!(val in crEntry)) errors.push(`CR ${crKey}: missing '${val}'!`);
    else if (val === "pubHp") continue;
    else if (!isFiniteNumber(crEntry[val])) errors.push(`CR ${crKey}: value '${val}' must be a finite number!`);
  }

  // pubHp object { min, max, avg }
  if (!isObject(crEntry.pubHp)) {
    errors.push(`CR ${crKey}: "pubHp" field must be an object {min,max,avg}`);
  } else {
    for (const key of hpFiledKeys) {
      if (!(key in crEntry.pubHp)) errors.push(`CR ${crKey}: missing 'pubHp.${key}'!`);
      else if (!isFiniteNumber(crEntry.pubHp[key])) errors.push(`CR: ${crKey}: value 'pubHp.${key}' must be a finite number!`);
    }
  }

  // Reject unexpected keys
  if (strictKeys) {
    const allowedFields = new Set([...requiredFileds]);
    for (const key of Object.keys(crEntry)) {
      if (!allowedFields.has(key)) errors.push(`CR: ${crKey}: unexpected key '${key}'`);
    }
    if (isObject(crEntry.pubHp)) {
      const allowedHp = new Set(hpFiledKeys);
      for (const key of Object.keys(crEntry.pubHp)) {
        if (!allowedHp.has(key)) errors.push(`CR: ${crKey}: unexpected key 'pubHp.${key}'`);
      }
    }
  }

  return errors;
}

/**
 * Validates the JSON for guidelines import.
 * - Check if the JSON is valid
 * - Check if imported JSON matches BASE_GUIDELINES
 * - Check each CR entry for required fields values
 *
 * Returns: { ok: boolean, data?: object, errors: string[] }
 */
export function parseJSON(jsonText, { strictKeys = true } = {}) {
  const errors = [];

  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${e?.message}`] };
  }

  if (!isObject(data)) {
    return { ok: false, errors: ["Root value must be an object!"] };
  }

  // Require all CR keys
  for (const crKey of CR_ORDER) {
    if (!(crKey in data)) errors.push(`Missing CR key: ${crKey}`);
  }

  // Validate each entry we care about
  for (const crKey of CR_ORDER) {
    if (!(crKey in data)) continue;
    errors.push(...validateGuidelineEntry(data[crKey], crKey, { strictKeys }));
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, data, errors: [] };
}
