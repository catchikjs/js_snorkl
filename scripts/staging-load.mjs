// Opt-in hosted test. Use an empty assessment and 25 synthetic student accounts.
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { hash } from "../supabase/functions/_shared/contract.js";
const {
  STAGING_URL,
  STAGING_PUBLISHABLE_KEY,
  STAGING_TASK,
  STAGING_FIXTURE_FILE,
  CONFIRM_SYNTHETIC_CLASS,
} = process.env;
if (CONFIRM_SYNTHETIC_CLASS !== "25" || !STAGING_TASK)
  throw Error("전용 가상 학급 25명과 평가를 지정하세요.");
const accounts = JSON.parse(await readFile(STAGING_FIXTURE_FILE, "utf8"));
if (accounts.length !== 25 || new Set(accounts.map((a) => a.email)).size !== 25)
  throw Error("서로 다른 가상 계정 25개가 필요합니다.");
const sessions = await Promise.all(
  accounts.map(async (account) => {
    const db = createClient(STAGING_URL, STAGING_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await db.auth.signInWithPassword(account);
    if (error) throw Error("가상 계정 로그인 실패");
    const cmd = async (op, p) => {
      const r = await db.functions.invoke("assessment", { body: { op, p } });
      if (r.error) throw Error(op);
      return r.data.value;
    };
    const detail = await cmd("detail", { task: STAGING_TASK });
    if (!detail.questions.length || detail.subs.length)
      throw Error("비어 있는 전용 평가를 사용하세요.");
    return { db, cmd, q: detail.questions[0].id };
  }),
);
const pixels = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WL7vM8AAAAASUVORK5CYII=",
  "base64",
);
const start = performance.now();
const receipts = await Promise.allSettled(
  sessions.map(async ({ db, cmd, q }) => {
    const page_id = crypto.randomUUID(),
      files = [
        ["page-0.png", new Blob([pixels], { type: "image/png" })],
        [
          "strokes.json",
          new Blob(
            [
              JSON.stringify({
                schema_version: 1,
                pages: [{ page_id, width: 1200, height: 900, strokes: [] }],
              }),
            ],
            { type: "application/json" },
          ),
        ],
      ];
    const manifest = {
      schema_version: 1,
      pages: [page_id],
      description: "부하 시험용 빈 풀이",
      files: await Promise.all(
        files.map(async ([name, blob]) => ({
          name,
          bytes: blob.size,
          sha256: await hash(await blob.arrayBuffer()),
        })),
      ),
    };
    const s = await cmd("prepare", { q, key: crypto.randomUUID(), manifest });
    for (const [name, blob] of files) {
      const { error } = await db.storage
        .from("math-originals")
        .upload((s.storage_prefix || s.id) + "/" + name, blob);
      if (error) throw Error("upload");
    }
    await cmd("finalize", { sub: s.id });
    return { cmd, id: s.id, receipt_ms: Math.round(performance.now() - start) };
  }),
);
const accepted = receipts
  .filter((r) => r.status === "fulfilled")
  .map((r) => r.value);
console.log(
  JSON.stringify({
    received: accepted.length,
    failed: 25 - accepted.length,
    receipt_ms: accepted.map((a) => a.receipt_ms),
  }),
);
const pending = new Set(accepted);
const end = Date.now() + 15 * 60 * 1000;
while (pending.size && Date.now() < end) {
  await new Promise((ok) => setTimeout(ok, 15000));
  await Promise.all(
    [...pending].map(async (a) => {
      const d = await a.cmd("detail", { task: STAGING_TASK });
      const job = d.subs.find((s) => s.id === a.id)?.job;
      if (["completed", "failed"].includes(job)) {
        console.log(
          JSON.stringify({
            job,
            elapsed_ms: Math.round(performance.now() - start),
          }),
        );
        pending.delete(a);
      }
    }),
  );
}
console.log(JSON.stringify({ still_pending: pending.size }));
if (pending.size || accepted.length !== 25) process.exitCode = 1;
