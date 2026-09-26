import net from "node:net";
import { mock } from "node:test";

const events = [];
mock.module("node:child_process", {
  namedExports: {
    execFile() {
      events.push("execFile");
    },
    execFileSync() {
      events.push("execFileSync");
    },
    spawn() {
      events.push("spawn");
    },
    spawnSync() {
      events.push("spawnSync");
      return { status: 0, stdout: "", stderr: "" };
    },
    exec() {
      events.push("exec");
    },
    fork() {
      events.push("fork");
    },
  },
});

net.Server.prototype.listen = function listen() {
  events.push("listen");
  return this;
};

const { runWatch } = await import("../jobs/watch.js");
const { runPreppingDeals } = await import("../jobs/preppingdeals.js");
const { runAim } = await import("../jobs/aim.js");
const { runExpiry } = await import("../jobs/expiry.js");
const { runWatchPromote } = await import("../jobs/watch-promote.js");

await runWatch({ messages: [] });
await runPreppingDeals({ rss: "<rss></rss>" });
await runAim({ pages: [] });
await runExpiry({ deals: [], pages: [] });
await runWatchPromote({
  records: [],
  drive: {
    async get() {
      throw new Error("get");
    },
    async export() {
      throw new Error("export");
    },
  },
  reviewIds: new Set(),
  dryRun: true,
  date: "2026-09-25",
  liveCount: 0,
  cards: [],
});

if (events.length) {
  console.error(events.join(" "));
  process.exit(1);
}
console.log("ok");
