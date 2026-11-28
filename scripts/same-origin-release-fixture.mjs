import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { frontendManifest, uploadFrontend } from "./frontend-release.mjs";
import { sealRelease } from "./release-artifact.mjs";

const run = promisify(execFile);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// Like the playback-upgrade regression, own dist for this run and restore the
// caller's exact output. The backup lives on the same filesystem as dist.
export async function prepareSameOriginReleasePair() {
  const original = JSON.parse(await readFile("dist/client/build.json", "utf8"));
  const stable = original.buildId;
  assert.match(stable, /^[a-f0-9]{40}$/);
  assert.equal(original.assetBase, "/_releases/" + stable + "/", "first build with SAME_PAGE_RELEASE_CHANNELS=1");
  const candidate = randomBytes(20).toString("hex");
  await mkdir("artifacts/verification", { recursive: true });
  const directory = await mkdtemp(resolve("artifacts/verification/") + "/same-origin-releases-");
  const stableRoot = join(directory, "stable");
  const candidateRoot = join(directory, "candidate");
  let ownsDist = false;
  const restore = async () => {
    if (ownsDist) {
      await rm("dist", { recursive: true, force: true });
      await rename(join(stableRoot, "dist"), "dist");
      ownsDist = false;
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await mkdir(stableRoot);
    await mkdir(candidateRoot);
    await rename("dist", join(stableRoot, "dist"));
    ownsDist = true;
    await run("npm", ["run", "build"], {
      env: { ...process.env, SAME_PAGE_BUILD_ID: candidate, SAME_PAGE_RELEASE_CHANNELS: "1", VITE_CONNECTIONS_ENABLED: "false" },
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    }).catch(error => {
      throw new Error("Candidate build failed\n" + (error.stderr || error.stdout || error.message), { cause: error });
    });
    await cp("dist", join(candidateRoot, "dist"), { recursive: true });
    const prepare = async (cwd, sha) => {
      await Promise.all(["wrangler.jsonc", "package-lock.json", "migrations"].map(name =>
        cp(name, join(cwd, name), { recursive: true })));
      await sealRelease({ cwd, sha });
      return { cwd, manifest: await frontendManifest(cwd, sha),
        contract: JSON.parse(await readFile(join(cwd, "dist/release-storage.json"), "utf8")) };
    };
    const [a, b] = await Promise.all([prepare(stableRoot, stable), prepare(candidateRoot, candidate)]);
    assert.equal(a.manifest.storageDigest, b.manifest.storageDigest, "entry test needs the same storage contract in both builds");
    assert.notEqual(a.manifest.files["sw.js"].sha256, b.manifest.files["sw.js"].sha256);
    return {
      stable, candidate, restore,
      async seed({ DB, FRONTEND_RELEASES: bucket }, signal) {
        for (const artifact of [a, b]) {
          signal.throwIfAborted();
          const digest = await uploadFrontend({ bucket, ...artifact });
          await DB.prepare("INSERT INTO frontend_releases VALUES(?,?,?,?,1)")
            .bind(artifact.manifest.buildId, digest, artifact.manifest.contract, Date.now()).run();
        }
        // Seed the promotion prerequisite for these two compatible fixture
        // builds. This stands in for the separate Chromium/WebKit release gate.
        const stableProbe = a.manifest.probeDigest, candidateProbe = b.manifest.probeDigest;
        const proof = JSON.stringify({ version: 1, passed: true, stable, candidate, stableProbe, candidateProbe,
          engines: ["chromium", "webkit"] });
        await bucket.put("compatibility/" + candidate + "/" + stable + ".json", proof);
        await DB.batch([
          DB.prepare("INSERT INTO release_channels VALUES(1,?,?,1)").bind(stable, candidate),
          DB.prepare("INSERT INTO release_compatibility VALUES(?,?,?,?,?)")
            .bind(candidate, stable, candidateProbe, stableProbe, sha256(proof)),
        ]);
      },
    };
  } catch (error) {
    await restore();
    throw error;
  }
}
