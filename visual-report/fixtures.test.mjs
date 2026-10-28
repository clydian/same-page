import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveFixtureRequest } from "./fixtures.mjs";

test("unknown API requests fail closed instead of reaching the current Worker", () => {
  const response = resolveFixtureRequest({
    pathname: "/api/not-a-visual-fixture",
    identity: "guest",
  });
  assert.equal(response.status, 404);
  assert.equal(JSON.parse(response.body).error, "visual_fixture_not_found");
});

test("isolated production fixtures work without shared dist and use their own build identity", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "same-page-fixture-no-dist-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixtureDirectory = path.join(directory, "visual-report");
  await mkdir(fixtureDirectory);
  for (const file of ["fixtures.mjs", "practice-fixture.mjs"]) await cp(new URL(file, import.meta.url), path.join(fixtureDirectory, file));
  const standalone = await import(pathToFileURL(path.join(fixtureDirectory, "fixtures.mjs")).href);
  for (const buildId of ["a".repeat(40), "b".repeat(40)]) {
    const request = { pathname: "/api/client-release", identity: "member" };
    const fixture = standalone.createVisualFixtureSession({ id: "reader-practice-build", buildId });
    for (const response of [standalone.resolveFixtureRequest({ ...request, buildId }), fixture.resolve(request)]) {
      const release = JSON.parse(response.body);
      assert.equal(release.target, buildId);
      assert.equal(release.backend, buildId);
    }
  }
});
