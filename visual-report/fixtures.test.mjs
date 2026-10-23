import assert from "node:assert/strict";
import test from "node:test";

import { createVisualFixtureSession, resolveFixtureRequest } from "./fixtures.mjs";

test("unknown API requests fail closed instead of reaching the current Worker", () => {
  const response = resolveFixtureRequest({
    pathname: "/api/not-a-visual-fixture",
    identity: "guest",
  });
  assert.equal(response.status, 404);
  assert.equal(JSON.parse(response.body).error, "visual_fixture_not_found");
});

test("practice metadata and file responses describe the exact custom revision bytes", () => {
  const xml = '<score-partwise><work><work-title>独立排版样本</work-title></work></score-partwise>';
  const fixture = createVisualFixtureSession({ id: 'reader-practice-focus', practiceXml: xml });
  const base = '/api/choirs/visual-choir/scores/visual-score/attachments/practice-xml';
  const attachment = JSON.parse(fixture.resolve({ pathname: base, identity: 'member', method: 'GET', cookie: '' }).body).attachment;
  const response = fixture.resolve({ pathname: base + '/file', identity: 'member', method: 'GET', cookie: '' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['X-Attachment-Revision'], String(attachment.revision));
  assert.equal(Buffer.byteLength(response.body), attachment.sizeBytes);
  assert.equal(response.body, xml);
});
