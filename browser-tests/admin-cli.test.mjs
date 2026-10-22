import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { musicXmlFixture } from "./musicxml-fixture.mjs";
import { startStorageFixture } from "./storage-fixture.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Keep credentials in the child environment, never argv or test diagnostics.
function cli(origin, token, args, expectedExit = 0) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["scripts/samepage.mjs", ...args, "--json"], {
      env: { ...process.env, SAME_PAGE_URL: origin, SAME_PAGE_TOKEN: token },
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      try {
        assert.equal(stdout.includes(token) || stderr.includes(token), false, "CLI output must not contain its credential");
        assert.equal(error?.code ?? 0, expectedExit, stderr);
        resolve(expectedExit === 0 ? JSON.parse(stdout) : { stdout, stderr });
      } catch (failure) { reject(failure); }
    });
  });
}

test("cookie admin creates, uses and revokes a drive-restricted CLI token (chromium)", { timeout: 180_000 }, async (t) => {
  const f = await startStorageFixture({
    authenticated: true,
    nonMember: true,
    previewEntry: false,
    productAdmin: true,
  });
  const directory = await mkdtemp(join(tmpdir(), "same-page-admin-cli-"));
  let browser;
  t.after(async () => {
    try { await browser?.close(); }
    finally {
      try { await f.stop(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const login = await context.request.post(`${f.origin}/api/auth/sign-in/email`, {
    headers: { origin: f.origin },
    data: { email: f.accounts[1].email, password: f.accounts[1].password },
  });
  assert.equal(login.status(), 200);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.stack));
  await page.goto(`${f.origin}/admin`);
  await expect(page.getByRole("link", { name: "打开", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "CLI 令牌", exact: true }).click();
  const panel = page.getByRole("region", { name: "CLI 令牌", exact: true });
  await expect(panel.getByRole("checkbox", { name: "第二个试点云盘", exact: true })).toBeEnabled();

  async function createToken(name, access) {
    await panel.getByRole("textbox", { name: "名称", exact: true }).fill(name);
    await panel.getByRole("combobox", { name: "访问权限", exact: true }).selectOption(access);
    await panel.getByRole("checkbox", { name: "第二个试点云盘", exact: true }).check();
    await panel.getByRole("button", { name: "创建令牌", exact: true }).click();
    const input = panel.getByRole("textbox", { name: "新建 CLI 令牌", exact: true });
    await expect(input).toBeVisible();
    const token = await input.inputValue();
    assert.equal(/^sp_cli_[0-9a-f]{64}$/.test(token), true, "Expected a complete CLI credential");
    await panel.getByRole("button", { name: "关闭令牌显示", exact: true }).click();
    await expect(input).toHaveCount(0);
    return token;
  }

  const token = await createToken("本机转谱测试", "upload");
  const drives = await cli(f.origin, token, ["drives"]);
  assert.deepEqual(drives.drives.map(drive => drive.id), [f.adminDriveId]);
  const scores = await cli(f.origin, token, ["scores"]);
  assert.deepEqual(scores.scores.map(score => score.id), [f.adminScoreId]);
  const denied = await cli(f.origin, token, ["status", f.scoreId], 1);
  assert.match(denied.stderr, /HTTP 404:/);

  const pdfPath = join(directory, "source.pdf");
  const pdf = await cli(f.origin, token, ["download-pdf", f.adminScoreId, "--out", pdfPath]);
  assert.equal(pdf.sourceVersionId, f.adminVersionId);
  assert.equal(pdf.sha256, sha256(f.pdf));
  assert.deepEqual(await readFile(pdfPath), f.pdf);

  const xml = musicXmlFixture();
  const xmlPath = join(directory, "candidate.musicxml");
  await writeFile(xmlPath, xml);
  const candidateId = "2edfb799-48e2-45e4-9ad4-8793c3dd617c";
  const uploadArgs = ["upload", f.adminScoreId, xmlPath, "--source-version", pdf.sourceVersionId, "--id", candidateId];
  const uploaded = await cli(f.origin, token, uploadArgs);
  assert.equal(uploaded.id, candidateId);
  assert.equal(uploaded.sha256, sha256(xml));
  assert.equal((await cli(f.origin, token, uploadArgs)).id, candidateId);
  const status = await cli(f.origin, token, ["status", f.adminScoreId, "--candidate", candidateId]);
  assert.equal(status.selectedCandidate.id, candidateId);
  assert.equal(status.selectedCandidate.state, "ready");
  assert.equal(status.selectedCandidate.review, "pending");
  assert.equal(status.selectedCandidate.technicalPassed, 0);
  assert.equal(status.selectedCandidate.sourceVersionId, f.adminVersionId);
  assert.equal(status.score.attachmentId, null);
  assert.equal(status.candidates.length, 1);
  const downloadedPath = join(directory, "downloaded.musicxml");
  const candidate = await cli(f.origin, token, ["download-xml", f.adminScoreId, "--candidate", candidateId, "--out", downloadedPath]);
  assert.equal(candidate.candidateId, candidateId);
  assert.equal(candidate.sourceVersionId, f.adminVersionId);
  assert.equal(candidate.sha256, sha256(xml));
  assert.deepEqual(await readFile(downloadedPath), xml);

  const readToken = await createToken("只读测试", "read");
  const readOnly = await cli(f.origin, readToken, uploadArgs, 1);
  assert.match(readOnly.stderr, /HTTP 403:/);
  assert.equal((await cli(f.origin, readToken, ["status", f.adminScoreId])).candidates.length, 1);

  // Capture only the closed secret panel, at desktop and phone widths.
  await mkdir("artifacts/verification/admin-cli", { recursive: true });
  await expect(panel.getByRole("textbox", { name: "新建 CLI 令牌", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("table", { name: "现有 CLI 令牌", exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/verification/admin-cli/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole("button", { name: "创建令牌", exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/verification/admin-cli/mobile.png", fullPage: true });

  await panel.getByRole("button", { name: "撤销 本机转谱测试", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("已撤销「本机转谱测试」。");
  const revoked = await cli(f.origin, token, ["scores"], 1);
  assert.match(revoked.stderr, /HTTP 403:/);
  assert.equal(revoked.stdout, "");

  await page.getByRole("link", { name: "乐谱工作台", exact: true }).click();
  await page.getByLabel("云盘", { exact: true }).selectOption(f.choirId);
  await expect(page.getByRole("link", { name: "打开", exact: true })).toHaveCount(1);
  await expect(page.getByRole("cell", { name: /本地链路测试\.pdf/ })).toBeVisible();
  assert.equal((await context.request.get(`${f.origin}/api/admin/scores/${f.scoreId}`)).status(), 200);
  assert.equal((await context.request.get(`${f.origin}/api/choirs/${f.choirId}/scores`)).status(), 403);
  assert.deepEqual(pageErrors, []);
});
