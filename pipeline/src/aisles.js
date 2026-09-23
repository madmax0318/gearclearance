const ALIASES = {
  gun: "guns",
  guns: "guns",
  ammo: "ammo",
  ammunition: "ammo",
  optic: "optics",
  optics: "optics",
  accessory: "accessories",
  accessories: "accessories",
  apparel: "apparel",
  clothing: "apparel",
  nylon: "nylon",
  "plate carrier": "nylon",
  "chest rig": "nylon",
  "food storage": "food-storage",
  "food-storage": "food-storage",
  survival: "survival",
  household: "household",
  "household goods": "household",
  gaming: "gaming",
  drone: "drones",
  drones: "drones",
};

export const AISLES = [
  "guns",
  "ammo",
  "optics",
  "accessories",
  "apparel",
  "nylon",
  "food-storage",
  "survival",
  "household",
  "gaming",
  "drones",
];

export function normalizeAisle(value) {
  if (value == null) return null;
  const key = String(value).trim().toLowerCase().replace(/[_/]+/g, "-").replace(/\s+/g, " ");
  if (ALIASES[key]) return ALIASES[key];
  const dashed = key.replace(/\s+/g, "-");
  return ALIASES[dashed] ?? null;
}
