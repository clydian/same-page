import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { storageContractFiles } from "./release-contract.mjs";
import { verifyReleaseContract } from "./verify-release-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("./verify-release-contract.mjs", import.meta.url));

test("the current release preserves the reviewed stable storage boundaries", async () => {
  await verifyReleaseContract(root);
});

test("the PR preflight rejects the #577 upgrade before publishing anything", async t => {
  const cwd = await fixture(t);
  const lock = JSON.parse(await readFile(path.join(cwd, "package-lock.json"), "utf8"));
  lock.packages["node_modules/zod"].version = "4.6.6";
  await writeFile(path.join(cwd, "package-lock.json"), JSON.stringify(lock));
  const result = spawnSync(process.execPath, [cli], { cwd, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /storage compatibility changed: zod/);
});

test("the preflight retains the actual deployment boundary checks", async t => {
  const cwd = await fixture(t);
  await writeFile(path.join(cwd, "src/shared/annotations.ts"), "// changed protocol\n");
  await assert.rejects(verifyReleaseContract(cwd), /storage compatibility changed: src\/shared\/annotations.ts/);
});

test("a matching lock cannot conceal a floating storage dependency", async t => {
  const cwd = await fixture(t);
  const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
  manifest.dependencies.dexie = "^4.4.5";
  await writeFile(path.join(cwd, "package.json"), JSON.stringify(manifest));
  await assert.rejects(verifyReleaseContract(cwd), /Pin dexie/);
});

async function fixture(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), "same-page-contract-preflight-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const file of [...storageContractFiles, "package.json", "package-lock.json", "scripts/release-storage-baseline.json"]) {
    const destination = path.join(cwd, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(root, file), destination);
  }
  // Fixtures use the baseline versions even when checking an incompatible PR.
  const { storage } = JSON.parse(await readFile(path.join(cwd, "scripts/release-storage-baseline.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(cwd, "package-lock.json"), "utf8"));
  for (const name of ["dexie", "zod"]) {
    manifest.dependencies[name] = storage[name];
    lock.packages[`node_modules/${name}`].version = storage[name];
  }
  await writeFile(path.join(cwd, "package.json"), JSON.stringify(manifest));
  await writeFile(path.join(cwd, "package-lock.json"), JSON.stringify(lock));
  // The CLI must also work from a clean checkout before installing dependencies.
  execFileSync(process.execPath, [cli], { cwd });
  return cwd;
}
