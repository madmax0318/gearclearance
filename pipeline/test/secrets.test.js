import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

test("pipeline files do not commit publisher ids or network account snippets", () => {
  const files = walk(root).filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`));
  const assignment = /(AVANTLINK_AID|IMPACT_PUBLISHER_ID|CJ_PID|AMAZON_ASSOCIATES_TAG)[ \t]*=[ \t]*\S+/;
  const impactSnippet = ["P-A", "7822267"].join("");
  const avantlinkApp = ["165", "5057"].join("");
  const privateKey = ["BEGIN ", "PRIVATE KEY"].join("");
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal(assignment.test(text), false, `${file} assigns a publisher id`);
    assert.equal(text.includes(impactSnippet), false, `${file} copies the Impact snippet`);
    assert.equal(text.includes(avantlinkApp), false, `${file} copies an AvantLink id`);
    assert.equal(text.includes(privateKey), false, file);
  }
});
