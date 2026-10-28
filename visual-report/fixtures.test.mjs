import assert from "node:assert/strict";
import test from "node:test";

import { resolveFixtureRequest } from "./fixtures.mjs";

test("unknown API requests fail closed instead of reaching the current Worker", () => {
  const response = resolveFixtureRequest({
    pathname: "/api/not-a-visual-fixture",
    identity: "guest",
  });
  assert.equal(response.status, 404);
  assert.equal(JSON.parse(response.body).error, "visual_fixture_not_found");
});
