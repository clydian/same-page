import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function admitRelease(previous, candidate) {
  assert.ok(candidate.signed && /^[a-f0-9]{40}$/.test(candidate.sourceSha), "Only a verified signed artifact may publish");
  if (!previous) return "publish";
  const code = Number(previous.versioncode);
  assert.ok(Number.isSafeInteger(code) && code > 0, "Existing release metadata is invalid; inspect manually");
  if (code === candidate.versionCode && previous.sha256 === candidate.sha256) return "already-published";
  assert.ok(candidate.versionCode > code, "versionCode must increase; never overwrite with an old/different build");
  return "publish";
}

export async function deriveR2Credentials(account, token, fetchImpl = fetch) {
  assert.match(account ?? "", /^[a-f0-9]{32}$/);
  assert.ok(token, "Production Cloudflare token is required");
  // Legacy tokens do not identify their owner type. Try the user API first,
  // then the account API only when authentication is rejected. Never log bodies
  // or credentials, and never interpret a service failure as a token mismatch.
  const endpoints = ["user/tokens/verify", `accounts/${account}/tokens/verify`];
  for (const [index, endpoint] of endpoints.entries()) {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    });
    if (index === 0 && [400, 401, 403].includes(response.status)) {
      await response.body?.cancel();
      continue;
    }
    const owner = index === 0 ? "user" : "account";
    assert.ok(response.ok, `Cloudflare ${owner} token verification failed (HTTP ${response.status}); check token ownership, validity and account`);
    const verification = await response.json();
    assert.ok(verification.success && verification.result?.status === "active", `Cloudflare ${owner} token is not active`);
    assert.match(verification.result.id ?? "", /^[a-f0-9]{32}$/, "Cloudflare verification returned an invalid token ID");
    // Official R2 derivation; credentials live only in memory.
    return { accessKeyId: verification.result.id, secretAccessKey: createHash("sha256").update(token).digest("hex") };
  }
}

async function publish() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const release = JSON.parse(await readFile(path.join(root, "out/release.json"), "utf8"));
  const bytes = await readFile(path.join(root, "out/same-page.apk"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), release.sha256);
  assert.equal(bytes.length, release.size);
  assert.equal(release.sourceSha, process.env.GITHUB_SHA, "Artifact must belong to this workflow commit");
  assert.equal(release.packageId, "com.clyapps.samepage");
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const credentials = await deriveR2Credentials(account, token);
  const client = new S3Client({ credentials, region: "auto", endpoint: `https://${account}.r2.cloudflarestorage.com`, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  const object = { Bucket: "same-page-android-releases", Key: "android/latest.apk" };
  let current;
  try { current = await client.send(new HeadObjectCommand(object)); }
  catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; }
  if (admitRelease(current?.Metadata, release) === "publish") {
    await client.send(new PutObjectCommand({ ...object, Body: bytes, ContentMD5: createHash("md5").update(bytes).digest("base64"),
      ...(current ? { IfMatch: current.ETag } : { IfNoneMatch: "*" }),
      ContentType: "application/vnd.android.package-archive", CacheControl: "no-store",
      Metadata: { versionname: release.versionName, versioncode: String(release.versionCode), sha256: release.sha256, sourcesha: release.sourceSha },
    }));
  }
  const stored = await client.send(new GetObjectCommand(object));
  const downloaded = await stored.Body.transformToByteArray();
  assert.equal(createHash("sha256").update(downloaded).digest("hex"), release.sha256, "R2 readback mismatch");
  assert.equal(stored.Metadata.versioncode, String(release.versionCode));
  console.log(`Published and reread ${release.versionName} (${release.versionCode}); R2 holds one latest APK.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await publish();
