// A local Worker/D1/R2 preview with synthetic files; no production credentials.
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { request } from "@playwright/test";
import { startStorageFixture } from "../browser-tests/storage-fixture.mjs";
import { createSampleScorePdf } from "../visual-report/fixtures.mjs";

const fixture = await startStorageFixture({ authenticated: true, script: "dev", previewEntry: false });
const api = await request.newContext({ baseURL: fixture.origin, extraHTTPHeaders: { origin: fixture.origin } });
const result = await api.post("/api/auth/sign-in/email", { data: { email: fixture.accounts[0].email, password: fixture.accounts[0].password } });
if (!result.ok()) { await fixture.stop(); throw new Error(`Local login failed: ${result.status()} ${await result.text()}`); }
const drive = `/api/choirs/${fixture.choirId}`;
async function ok(response) { if (!response.ok()) throw new Error(`${response.status()}: ${await response.text()}`); return response; }
await ok(await api.patch(`${drive}/name`, { data: { name: "小红花云盘", expectedRevision: 0 } }));
await ok(await api.patch(`${drive}/scores/${fixture.scoreId}`, { data: { fileName: "舟中晓望.pdf" } }));
const pdf = createSampleScorePdf();
const scores = [{ id: fixture.scoreId }];
for (const name of ["Cantate Domino - Monteverdi.pdf", "Ola Gjeilo - Ubi Caritas.pdf", "Vita De La Mia Vita - William Hawley.pdf"]) {
  scores.push((await (await ok(await api.post(`${drive}/scores`, { multipart: { file: { name, mimeType: "application/pdf", buffer: pdf } } }))).json()).score);
}
function makeWav() {
  const samples = 44100 * 12;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(44100, 24); bytes.writeUInt32LE(88200, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 261.63 * i / 44100) * 1800 * Math.min(1, i / 4410, (samples - i) / 4410)), 44 + i * 2);
  return bytes;
}
async function attach(scoreId, name, bytes) {
  const id = randomUUID();
  await ok(await api.post(`${drive}/scores/${scoreId}/attachments/${id}/file?${new URLSearchParams({ name, size: String(bytes.length) })}`, { data: bytes, headers: { "content-type": "application/octet-stream" } }));
  return id;
}
const audioId = await attach(fixture.scoreId, "示范音频.wav", makeWav());
const markdownId = await attach(fixture.scoreId, "排练笔记.md", Buffer.from("# 舟中晓望\n\n## 本周排练\n\n- **第 12 小节**：统一换气，轻声进入。\n- 第二段保持连贯，留意声部之间的呼应。\n- 结尾渐弱，最后一个音听指挥收。\n\n## 排练前准备\n\n听一遍示范音频，再标记需要合排的位置。\n\n> 这是一份本地预览用的示例笔记，可直接编辑和保存。\n"));
await ok(await api.post(`${drive}/scores/${fixture.scoreId}/attachments/links`, { data: { id: randomUUID(), name: "参考演唱", url: "https://example.org/choir-reference" } }));
const pdfId = await attach(scores[1].id, "歌词与译文.pdf", pdf);
await attach(scores[2].id, "排练要点.md", Buffer.from("# Ubi Caritas\n\n留意长句中的气息分配，保持元音统一。\n"));

const directory = "artifacts/verification/attachments-331";
await mkdir(directory, { recursive: true });
const state = await api.storageState();
await writeFile(`${directory}/browser-state.json`, JSON.stringify(state));
const url = `${fixture.origin}/choirs/${fixture.choirId}`;
const launcher = createServer((_req, res) => {
  // Cookies belong only to the isolated local fixture. The launcher binds loopback.
  res.writeHead(302, { "Set-Cookie": state.cookies.map(cookie => `${cookie.name}=${cookie.value}; Path=/; HttpOnly; SameSite=Lax`), Location: url, "Cache-Control": "no-store" });
  res.end();
});
await new Promise(resolve => launcher.listen(0, "127.0.0.1", resolve));
const previewUrl = `http://127.0.0.1:${launcher.address().port}`;
await writeFile(`${directory}/preview.json`, JSON.stringify({ previewUrl, url, origin: fixture.origin, choirId: fixture.choirId, scoreId: fixture.scoreId, audioId, markdownId, pdfId, pdfScoreId: scores[1].id }, null, 2));
console.log(`Local attachment preview: ${previewUrl}`);
console.log(`Synthetic Worker/D1/R2 data. Evidence: ${directory}`);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { launcher.close(); void api.dispose(); });
