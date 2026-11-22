import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  database,
  rpc,
  teacher,
  student,
  classId,
  otherClass,
} from "../dev/database.js";
import { dispatch } from "../supabase/functions/_shared/gateway.js";
import { hash } from "../supabase/functions/_shared/contract.js";
import { originalPath } from "../supabase/functions/_shared/storage-path.js";

test("class cancellation revokes student access and submission, retains originals, notifies only recipients and resumes idempotently", async () => {
  const db = await database(),
    files = new Map();
  const cmd = (uid, op, p = {}) =>
    dispatch(
      op,
      p,
      (fn, op, p) => rpc(db, fn, [uid, op, p]),
      async (path) => files.get(path),
    );
  try {
    await db.exec(
      await readFile(
        "supabase/migrations/202611220005_distribution_cancellation.sql",
        "utf8",
      ),
    );
    const [source] = await cmd(teacher, "library");
    const { working } = await cmd(teacher, "book", { book: source.id });
    const book = await cmd(teacher, "new", {
      class_id: classId,
      title: "배포 취소 검증",
      working,
    });
    await cmd(teacher, "approve", { book, revision: 1, working });
    const link = await cmd(teacher, "distribute", { book, class_id: classId });
    const other = await cmd(teacher, "distribute", {
      book,
      class_id: otherClass,
    });
    const p = { book, class_id: classId, task: link.task };
    const detail = await cmd(student(1), "detail", { task: link.task }),
      q = detail.questions[0].id;
    const page = crypto.randomUUID(),
      bytes = new TextEncoder().encode(
        JSON.stringify({
          schema_version: 1,
          pages: [{ page_id: page, width: 1200, height: 900, strokes: [] }],
        }),
      );
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WL7vM8AAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const content = { "strokes.json": bytes, "page-0.png": png };
    const manifest = {
      schema_version: 1,
      description: "보관할 답안",
      pages: [page],
      files: await Promise.all(
        Object.entries(content).map(async ([name, b]) => ({
          name,
          bytes: b.length,
          sha256: await hash(b),
        })),
      ),
    };
    const slot = await cmd(student(1), "prepare", {
      q,
      key: crypto.randomUUID(),
      manifest,
    });
    for (const [name, b] of Object.entries(content))
      files.set(originalPath(slot, name), b.buffer);
    await cmd(student(1), "finalize", { sub: slot.id });
    await cmd(student(2), "save", {
      q,
      revision: 0,
      body: { description: "작성 중인 풀이" },
    });
    const pending = await cmd(student(2), "prepare", {
      q,
      key: crypto.randomUUID(),
      manifest,
    });
    await rpc(db, "math_command", [student(2), "seal", { sub: pending.id }]);
    const snapshot = async () =>
      (
        await db.query(`select jsonb_build_object(
      'questions',(select jsonb_agg(to_jsonb(q) order by id) from math_private.questions q),
      'slots',(select jsonb_agg(to_jsonb(s) order by id) from math_private.slots s),
      'subs',(select jsonb_agg(to_jsonb(s) order by id) from math_private.subs s),
      'drafts',(select jsonb_agg(to_jsonb(d) order by uid,q) from math_private.drafts d),
      'recipients',(select jsonb_agg(to_jsonb(r) order by task,uid) from math_private.recipients r)) as value`)
      ).rows[0].value;
    const before = await snapshot();
    const stranger = crypto.randomUUID();
    await db.query("insert into auth.users(id) values($1)", [stranger]);
    await db.query(
      "insert into math_private.members values($1,$2,'teacher','다른 교사',null)",
      [classId, stranger],
    );
    await assert.rejects(cmd(stranger, "cancelDistribution", p));
    await assert.rejects(cmd(student(1), "cancelDistribution", p));
    await assert.rejects(
      cmd(teacher, "cancelDistribution", { ...p, class_id: otherClass }),
    );
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await rpc(tx, "math_distribution", [teacher, "cancelDistribution", p]);
      }),
      (e) => e.code === "42501",
    );
    await db.exec("delete from public.math_updates");
    const cancelled = await cmd(teacher, "cancelDistribution", p);
    assert.ok(cancelled.withdrawn_at);
    assert.equal(cancelled.active, false);
    assert.deepEqual(await cmd(teacher, "cancelDistribution", p), cancelled);
    assert.equal(
      (
        await db.query(
          "select count(*) as n from math_private.changes where detail->>'action'='cancelDistribution'",
        )
      ).rows[0].n,
      1,
    );
    const notified = (
      await db.query("select uid from public.math_updates")
    ).rows.map((r) => r.uid);
    assert.equal(notified.length, 26);
    assert.ok(notified.includes(student(1)) && notified.includes(teacher));
    assert.ok(!notified.includes(student(26)) && !notified.includes(stranger));
    assert.ok(
      !(await cmd(student(1), "home")).tasks.some((t) => t.id === link.task),
    );
    assert.ok(
      (await cmd(student(26), "home")).tasks.some((t) => t.id === other.task),
    );
    assert.equal(
      await cmd(student(26), "resolve", { token: other.token }),
      other.task,
    );
    for (const [op, args] of [
      ["detail", { task: link.task }],
      ["summary", { task: link.task }],
      ["resolve", { token: link.token }],
      ["inspect", { sub: slot.id }],
      ["draft", { q }],
      ["history", { q }],
      ["save", { q, revision: 1, body: { description: "거절" } }],
      ["prepare", { q, key: crypto.randomUUID(), manifest }],
      ["finalize", { sub: pending.id }],
    ])
      await assert.rejects(cmd(student(2), op, args));
    await assert.rejects(cmd(student(1), "inspect", { sub: slot.id }));
    await assert.rejects(
      rpc(db, "math_command", [student(2), "commit", { sub: pending.id }]),
    );
    const allowed = (uid, path, writing) =>
      db.transaction(async (tx) => {
        await tx.query("select set_config('request.uid',$1,true)", [uid]);
        return rpc(tx, "math_asset_ok", [path, writing]);
      });
    assert.equal(
      await allowed(student(1), originalPath(slot, "page-0.png"), false),
      false,
    );
    assert.equal(
      await allowed(teacher, originalPath(slot, "page-0.png"), false),
      true,
    );
    assert.equal(
      await allowed(student(2), originalPath(pending, "page-0.png"), true),
      false,
    );
    assert.equal(
      (await cmd(teacher, "inspect", { sub: slot.id })).manifest.description,
      manifest.description,
    );
    for (const op of ["toggle", "rotate", "refreshRoster"])
      await assert.rejects(cmd(teacher, op, p), /distribution_cancelled/);
    assert.deepEqual(await snapshot(), before);
    const resumed = await cmd(teacher, "resumeDistribution", p);
    assert.equal(resumed.withdrawn_at, null);
    assert.equal(resumed.active, true);
    assert.deepEqual(await cmd(teacher, "resumeDistribution", p), resumed);
    assert.equal(
      await cmd(student(1), "resolve", { token: link.token }),
      link.task,
    );
    assert.equal(
      (await cmd(student(2), "draft", { q })).body.description,
      "작성 중인 풀이",
    );
    assert.equal(
      (await cmd(student(1), "inspect", { sub: slot.id })).storage_prefix,
      slot.storage_prefix,
    );
    assert.deepEqual(await snapshot(), before);
    await cmd(teacher, "cancelDistribution", p);
    const redistributed = await cmd(teacher, "distribute", {
      book,
      class_id: classId,
    });
    assert.equal(redistributed.task, link.task);
    assert.equal(redistributed.withdrawn_at, null);
    assert.ok(
      (await cmd(student(1), "home")).tasks.some((t) => t.id === link.task),
    );
    assert.deepEqual(await snapshot(), before);
  } finally {
    await db.close();
  }
});
