import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { database, rpc, student, teacher, classId } from "../dev/database.js";
import { dispatch } from "../supabase/functions/_shared/gateway.js";
import { hash } from "../supabase/functions/_shared/contract.js";
import { originalPath } from "../supabase/functions/_shared/storage-path.js";
import { archiveOriginals } from "../supabase/functions/_shared/archive-originals.js";
import { analysisInput } from "../supabase/functions/_shared/analysis-input.js";

async function fixture(configured = false) {
  const db = await database(),
    assets = new Map(),
    pages = [crypto.randomUUID(), crypto.randomUUID()];
  if (configured) {
    await db.query(
      "update math_private.members set number='101'||right(number,2) where class_id=$1 and role='student'",
      [classId],
    );
    await db.query(
      "update math_private.classes set number_prefix='101' where id=$1",
      [classId],
    );
  }
  const ink = {
    schema_version: 1,
    description: "보존할 풀이 설명",
    pages: pages.map((page_id) => ({
      page_id,
      width: 1200,
      height: 900,
      strokes: [],
    })),
  };
  const png = new Blob(
    [
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WL7vM8AAAAASUVORK5CYII=",
        "base64",
      ),
    ],
    { type: "image/png" },
  );
  const files = new Map([
    [
      "strokes.json",
      new Blob([JSON.stringify(ink)], { type: "application/json" }),
    ],
    ["page-0.png", png],
    ["page-1.png", png],
    ["attachment-0.png", png],
  ]);
  const manifest = {
    schema_version: 1,
    description: ink.description,
    pages,
    files: await Promise.all(
      [...files].map(async ([name, b]) => ({
        name,
        bytes: b.size,
        sha256: await hash(await b.arrayBuffer()),
      })),
    ),
  };
  const cmd = (u, op, p = {}) =>
    dispatch(
      op,
      p,
      (fn, op, p) => rpc(db, fn, [u, op, p]),
      async (path) => {
        const file = assets.get(path);
        if (!file) throw Error("file missing");
        return file.arrayBuffer();
      },
    );
  const task = (await cmd(student(1), "home")).tasks[0].id;
  const q = (await cmd(student(1), "detail", { task })).questions[0].id;
  const as = (uid, fn) =>
    db.transaction(async (tx) => {
      await tx.query("select set_config('request.uid',$1,true)", [uid]);
      await tx.exec("set local role authenticated");
      return fn(tx);
    });
  return { db, assets, files, manifest, cmd, task, q, as };
}

test("server folders isolate class and student, preserve retries, and serve review, analysis and cleanup", async () => {
  const { db, assets, files, manifest, cmd, task, q, as } = await fixture(true);
  try {
    const migration = await readFile(
      "supabase/migrations/202611220004_submission_folders.sql",
      "utf8",
    );
    await db.exec(migration);
    const key = crypto.randomUUID(),
      uid = student(1);
    const slot = await cmd(uid, "prepare", {
      q,
      key,
      manifest,
      storage_prefix: "attacker/chosen",
    });
    const prefix = `2026/class-101-${classId}/student-10101-${uid}/assessment-${task}/question-1-v1/${slot.id}`;
    assert.equal(slot.storage_prefix, prefix);
    for (const [name, blob] of files) {
      const path = originalPath(slot, name);
      for (const other of [student(2), student(26), teacher])
        await assert.rejects(
          as(other, (tx) =>
            tx.query(
              "insert into storage.objects values('math-originals',$1)",
              [path],
            ),
          ),
        );
      await as(uid, (tx) =>
        tx.query("insert into storage.objects values('math-originals',$1)", [
          path,
        ]),
      );
      assets.set(path, blob);
    }
    for (const path of [
      slot.id + "/page-0.png",
      prefix + "/../page-0.png",
      prefix + "/extra.png",
      prefix.replace(uid, student(2)) + "/page-0.png",
    ])
      await assert.rejects(
        as(uid, (tx) =>
          tx.query("insert into storage.objects values('math-originals',$1)", [
            path,
          ]),
        ),
      );
    assert.equal(
      (await cmd(uid, "prepare", { q, key, manifest })).storage_prefix,
      prefix,
    );
    await cmd(uid, "finalize", { sub: slot.id });
    const inspect = await cmd(teacher, "inspect", { sub: slot.id });
    assert.equal(inspect.storage_prefix, prefix);
    assert.equal(inspect.manifest.description, manifest.description);
    for (const who of [uid, teacher])
      assert.equal(
        (
          await as(who, (tx) =>
            tx.query(
              "select * from storage.objects where bucket_id='math-originals'",
            ),
          )
        ).rows.length,
        4,
      );
    for (const who of [student(2), student(26)])
      assert.equal(
        (
          await as(who, (tx) =>
            tx.query(
              "select * from storage.objects where bucket_id='math-originals'",
            ),
          )
        ).rows.length,
        0,
      );
    const job = await rpc(db, "math_worker", ["claim", {}]);
    assert.equal(job.sub, slot.id);
    assert.equal(job.payload.storage_prefix, prefix);
    for (const f of job.payload.manifest.files)
      assert.ok(
        assets.has(
          originalPath(
            { id: job.sub, storage_prefix: job.payload.storage_prefix },
            f.name,
          ),
        ),
      );
    const aiInput = JSON.stringify(analysisInput(job.payload));
    assert.ok(!aiInput.includes(prefix));
    assert.ok(!aiInput.includes(uid));
    assert.ok(aiInput.includes(manifest.description));

    // Roster labels/numbers may change; existing folders and queued retries remain stable.
    await db.query(
      "update math_private.members set number='10199' where uid=$1",
      [uid],
    );
    assert.equal(
      (await cmd(uid, "prepare", { q, key, manifest })).storage_prefix,
      prefix,
    );
    const expired = await cmd(student(2), "prepare", {
      q,
      key: crypto.randomUUID(),
      manifest,
    });
    await db.query(
      "update math_private.slots set created=now()-interval '2 days' where id=$1",
      [expired.id],
    );
    const gc = await rpc(db, "math_gc", []);
    assert.equal(gc.storage_prefix, expired.storage_prefix);
    assert.equal(gc.id, expired.id);
    assert.ok(
      gc.files.every((f) =>
        originalPath(gc, f.name).startsWith(expired.storage_prefix + "/"),
      ),
    );
    await rpc(db, "math_gc", [gc.id]);
    assert.equal(
      (await cmd(teacher, "inspect", { sub: slot.id })).submission.id,
      slot.id,
    );
  } finally {
    await db.close();
  }
});

test("legacy originals stay readable; verified resumable archive keeps original files and forbids student administration", async () => {
  const { db, assets, files, manifest, cmd, q, as } = await fixture();
  try {
    const slot = await cmd(student(1), "prepare", {
      q,
      key: crypto.randomUUID(),
      manifest,
    });
    // Reproduce an upload slot created before the folder migration.
    await db.query(
      "update math_private.slots set storage_prefix=null where id=$1",
      [slot.id],
    );
    for (const [name, blob] of files) {
      assets.set(slot.id + "/" + name, blob);
      await db.query(
        "insert into storage.objects values('math-originals',$1)",
        [slot.id + "/" + name],
      );
    }
    await cmd(student(1), "finalize", { sub: slot.id });
    const before = await cmd(teacher, "inspect", { sub: slot.id });
    assert.equal(before.storage_prefix, null);
    assert.equal(
      originalPath({ id: slot.id, storage_prefix: null }, "strokes.json"),
      slot.id + "/strokes.json",
    );
    const archive = (op, p = {}) => rpc(db, "math_archive_originals", [op, p]);
    await assert.rejects(
      as(student(1), (tx) => rpc(tx, "math_archive_originals", ["list", {}])),
      (e) => e.code === "42501",
    );
    const [candidate] = await archive("list");
    await assert.rejects(archive("commit", candidate), /archive_incomplete/);
    let fail = true;
    const storage = {
      download: async (path) =>
        assets.has(path)
          ? { data: assets.get(path) }
          : { error: Error("missing") },
      upload: async (path, blob, { upsert }) => {
        assert.equal(upsert, false);
        if (fail && path.endsWith("attachment-0.png"))
          return { error: Error("interrupted") };
        if (assets.has(path)) return { error: { statusCode: "409" } };
        assets.set(path, blob);
        await db.query(
          "insert into storage.objects values('math-originals',$1)",
          [path],
        );
        return {};
      },
    };
    const commit = (p) => archive("commit", p);
    await assert.rejects(
      archiveOriginals(candidate, storage, commit),
      /interrupted/,
    );
    assert.equal(
      (await cmd(teacher, "inspect", { sub: slot.id })).storage_prefix,
      null,
    );
    assert.equal((await archive("list")).length, 1);
    fail = false;
    const corrupt = candidate.target_prefix + "/page-0.png";
    assets.set(corrupt, new Blob(["corrupt"]));
    await assert.rejects(
      archiveOriginals(candidate, storage, commit),
      /asset mismatch/,
    );
    assert.equal(
      (await cmd(teacher, "inspect", { sub: slot.id })).storage_prefix,
      null,
    );
    assets.set(corrupt, files.get("page-0.png"));
    await archiveOriginals(candidate, storage, commit);
    const after = await cmd(teacher, "inspect", { sub: slot.id });
    assert.equal(after.storage_prefix, candidate.target_prefix);
    assert.deepEqual(after.submission, before.submission);
    assert.deepEqual(after.manifest, before.manifest);
    assert.deepEqual(await archive("list"), []);
    await archiveOriginals(candidate, storage, commit);
    assert.equal(
      (
        await db.query(
          "select count(*) as n from math_private.changes where detail->>'action'='archive_submission_folders'",
        )
      ).rows[0].n,
      1,
    );
    for (const [name, blob] of files) {
      assert.equal(assets.get(slot.id + "/" + name), blob);
      assert.deepEqual(
        await assets.get(candidate.target_prefix + "/" + name).arrayBuffer(),
        await blob.arrayBuffer(),
      );
    }
    const visible = await as(student(1), (tx) =>
      tx.query(
        "select name from storage.objects where bucket_id='math-originals'",
      ),
    );
    assert.equal(visible.rows.length, files.size);
    assert.ok(
      visible.rows.every((f) => f.name.startsWith(candidate.target_prefix)),
    );
    assert.equal(
      (await as(student(2), (tx) => tx.query("select * from storage.objects")))
        .rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
