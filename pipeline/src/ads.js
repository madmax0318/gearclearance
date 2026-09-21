import { normalizeAisle } from "./aisles.js";

const WEAPON_AISLES = new Set(["guns", "ammo", "optics"]);
const SOFT_GOODS = new Set(["household", "food-storage", "accessories"]);

const WEAPON_TEXT =
  /\b(guns?|ammo|ammunition|firearm|firearms|rifle|pistol|handgun|shotgun|carbine|revolver|ar-?15|ak-?47|glock|suppressor|silencer|sbr|nfa|weapon|weapons|9mm|5\.56|\.223|223 rem|magazine|magpul|holster|red[\s-]?dot|scopes?|optics?|ffl)\b/i;

export class PaidAdsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PaidAdsError";
    this.code = code;
  }
}

function blob(input) {
  const tags = Array.isArray(input.tags) ? input.tags.join(" ") : "";
  return [input.aisle, input.category, input.title, input.notes, input.merchant, tags]
    .filter(Boolean)
    .join(" ");
}

export function buildPaidAdDraft(input) {
  const aisle = normalizeAisle(input?.aisle ?? input?.category);
  const category = normalizeAisle(input?.category);
  const text = blob(input ?? {});
  if (WEAPON_AISLES.has(aisle) || WEAPON_AISLES.has(category) || WEAPON_TEXT.test(text)) {
    throw new PaidAdsError(
      "Paid ads refused: Guns, Ammo, and weapons-related products are not eligible for Meta or X paid promotion.",
      "ADS_WEAPONS_REFUSED",
    );
  }
  if (!SOFT_GOODS.has(aisle)) {
    throw new PaidAdsError(
      "Paid ads scaffold is soft-goods only (Household, Food storage, non-weapon accessories). No Meta or X campaign is created.",
      "ADS_NOT_SOFT_GOODS",
    );
  }
  return {
    ok: true,
    status: "scaffold",
    spend: false,
    channels: [],
    network_calls: 0,
    aisle,
    message: "Soft-goods draft only. No Meta or X campaign is created by this scaffold.",
  };
}
