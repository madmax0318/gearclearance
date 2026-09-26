import { execFile } from "node:child_process";
import { codedError } from "./log.js";

const GIT = "/usr/bin/git";
const RCLONE = "/usr/bin/rclone";
const REMOTE = "https://github.com/madmax0318/gearclearance.git";
const GIT_PREFIX = [
  "-c",
  "protocol.allow=never",
  "-c",
  "protocol.https.allow=always",
  "-c",
  "credential.helper=",
  "-c",
  "http.followRedirects=false",
  "-c",
  "core.hooksPath=/dev/null",
];

function sameList(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function reviewSpawn(file, args, options = {}) {
  const list = Array.isArray(args) ? args.map(String) : [];
  if (file === GIT) {
    if (!sameList(list.slice(0, GIT_PREFIX.length), GIT_PREFIX)) return { ok: false, reason: "git-config" };
    const rest = list.slice(GIT_PREFIX.length);
    if (!rest[0] || !rest[0].startsWith("--git-dir=")) return { ok: false, reason: "git-dir" };
    const sub = rest.slice(1);
    const command = sub[0];
    if (command === "fetch") {
      if (sub[1] !== REMOTE && sub[2] !== REMOTE && !sub.includes(REMOTE)) return { ok: false, reason: "git-remote" };
      if (sub.some((arg) => arg === "push")) return { ok: false, reason: "git-push" };
      return { ok: true, args: list };
    }
    if (command === "worktree" && ["add", "remove", "prune"].includes(sub[1])) return { ok: true, args: list };
    if (command === "rev-parse") return { ok: true, args: list };
    if (command === "status" && sub[1] === "--porcelain") return { ok: true, args: list };
    return { ok: false, reason: "git-subcommand" };
  }
  if (file === process.execPath) {
    const script = options.scratch ? `${options.scratch}/scripts/build.mjs` : null;
    if (!script || list.length !== 1 || list[0] !== script) return { ok: false, reason: "build-script" };
    return { ok: true, args: list };
  }
  if (file === RCLONE) {
    if (options.env?.DRIVE_UPLOADER !== "rclone" || !options.env?.G_EGRESS_DECISION) {
      return { ok: false, reason: "rclone" };
    }
    if (list[0] !== "copyto" || list[1] !== "--config" || list.length !== 5) return { ok: false, reason: "rclone-args" };
    return { ok: true, args: list };
  }
  return { ok: false, reason: "denied" };
}

function scrubbedEnv(extra = {}) {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    PATH: "/usr/bin:/bin",
    ...extra,
  };
}

export function spawnAllowed(file, args, options = {}) {
  const review = reviewSpawn(file, args, options);
  if (!review.ok) throw codedError(3, review.reason);
  return new Promise((resolve, reject) => {
    execFile(
      file,
      review.args,
      {
        shell: false,
        env: scrubbedEnv(options.envExtra),
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 30_000,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          const wrapped = codedError(3, error.message);
          wrapped.stdout = stdout;
          wrapped.stderr = stderr;
          reject(wrapped);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
