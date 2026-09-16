#!/usr/bin/env node
/**
 * Unit tests for the pure builders in ui/utils, without adding a test runner.
 *
 * node:test is built in; esbuild is already here through dt-app. Each
 * *.test.ts is bundled to CommonJS in a temp folder (that is what resolves
 * the extensionless relative imports the app uses) and handed to node --test.
 *
 *   npm test
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const utils = join(root, "ui", "utils");
const files = readdirSync(utils).filter((f) => f.endsWith(".test.ts")).map((f) => join(utils, f));
if (files.length === 0) {
  console.error("no *.test.ts under ui/utils");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "ma-tests-"));
try {
  await build({
    entryPoints: files,
    outdir: out,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["node:*"],
    logLevel: "error",
  });
  const bundled = files.map((f) => join(out, basename(f).replace(/\.ts$/, ".js")));
  const res = spawnSync(process.execPath, ["--test", ...bundled], { stdio: "inherit" });
  process.exit(res.status ?? 1);
} finally {
  rmSync(out, { recursive: true, force: true });
}
