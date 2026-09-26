import fs from "node:fs";
import path from "node:path";
import { spawnAllowed } from "../spawn.js";

export function stageScratch(scratch, { checkout, worktree }) {
  fs.cpSync(checkout, scratch, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) && !source.includes(`${path.sep}.git${path.sep}`),
  });
  const dataDest = path.join(scratch, "data");
  const imageDest = path.join(scratch, "public", "images", "deals");
  fs.cpSync(path.join(worktree, "data"), dataDest, { recursive: true });
  if (fs.existsSync(path.join(worktree, "public", "images", "deals"))) {
    fs.mkdirSync(imageDest, { recursive: true });
    fs.cpSync(path.join(worktree, "public", "images", "deals"), imageDest, { recursive: true });
  }
}

export async function runBuildCheck({ scratch, checkout, worktree, spawnImpl = spawnAllowed }) {
  stageScratch(scratch, { checkout, worktree });
  await spawnImpl(process.execPath, [`${scratch}/scripts/build.mjs`], { scratch });
  return { ok: true };
}
