import test from "node:test";
import assert from "node:assert/strict";
import {
  database,
  rpc,
  teacher,
  student,
  classId,
  otherClass,
} from "../dev/database.js";
import { dispatch } from "../supabase/functions/_shared/gateway.js";
import {
  hash,
  validateAnalysis,
  checkMath,
} from "../supabase/functions/_shared/contract.js";
const db = await database();
const cmd = (u, op, p = {}) =>
  dispatch(
    op,
    p,
    (fn, op, p) => rpc(db, fn, [u, op, p]),
    async (path) => assets.get(path),
  );
const assets = new Map();
const home = await cmd(student(1), "home"),
  task = home.tasks[0].id,
  detail = await cmd(student(1), "detail", { task }),
  q = detail.questions[0].id;
const lib = (await cmd(teacher, "library")).find(
    (b) => b.title === home.tasks[0].title,
  ),
  book = await cmd(teacher, "book", { book: lib.id });
const pId = crypto.randomUUID(),
  files = {
    "strokes.json": new TextEncoder().encode(
      JSON.stringify({
        schema_version: 1,
        pages: [{ page_id: pId, width: 1200, height: 900, strokes: [] }],
      }),
    ),
    "page-0.png": Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WL7vM8AAAAASUVORK5CYII=",
        "base64",
      ),
    ),
  };
const manifest = {
  schema_version: 1,
  description: "모의 답안",
  pages: [pId],
  files: await Promise.all(
    Object.entries(files).map(async ([name, b]) => ({
      name,
      bytes: b.length,
      sha256: await hash(b),
    })),
  ),
};
async function submit(n, key = crypto.randomUUID()) {
  const slot = await cmd(student(n), "prepare", { key, q, manifest });
  for (const [name, bytes] of Object.entries(files))
    assets.set(slot.id + "/" + name, bytes.buffer);
  return cmd(student(n), "finalize", { sub: slot.id });
}
let first;
test("class membership, teacher ownership, isolated answer keys and immutable sources", async () => {
  assert.deepEqual((await cmd(student(26), "home")).tasks, []);
  await assert.rejects(cmd(student(26), "detail", { task }));
  await assert.rejects(cmd(student(1), "book", { book: lib.id }));
  const guest = student(26);
  await db.query(
    "insert into math_private.members values ($1,$2,'teacher','별도 교사',null)",
    [otherClass, student(25)],
  );
  await assert.rejects(cmd(student(25), "book", { book: lib.id }));
  assert.equal((await cmd(guest, "library")).length, 0);
  assert.ok(!JSON.stringify(detail).includes('"answer"'));
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select * from math_private.keys");
    }),
    (e) => e.code === "42501",
  );
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await rpc(tx, "math_command", [teacher, "home", {}]);
    }),
    (e) => e.code === "42501",
  );
});
test("distribution links, copy isolation, question revision, stale approval", async () => {
  const link = await cmd(teacher, "distribute", {
    book: lib.id,
    class_id: classId,
  });
  assert.equal(await cmd(student(1), "resolve", { token: link.token }), task);
  await assert.rejects(cmd(student(26), "resolve", { token: link.token }));
  const copy = await cmd(teacher, "copy", {
    book: lib.id,
    class_id: otherClass,
    title: "복사 평가",
  });
  const b = await cmd(teacher, "book", { book: copy });
  assert.equal(b.approved, null);
  assert.equal(b.links.length, 0);
  assert.equal(b.working.ends, "");
  assert.deepEqual(b.working.questions, book.working.questions);
  await assert.rejects(
    cmd(teacher, "distribute", { book: copy, class_id: otherClass }),
  );
  const v = await cmd(teacher, "generate", {
    book: copy,
    revision: b.revision,
    working: b.working,
  });
  assert.equal(v, 1);
  await cmd(teacher, "saveBook", {
    book: copy,
    revision: 1,
    working: { ...b.working, title: "수정본" },
  });
  const work = await cmd(teacher, "book", { book: copy });
  assert.equal(work.generated[0].revision, 1);
  assert.equal(work.revision, 2);
  assert.equal(work.generated[0].matches_working, true);
  await assert.rejects(
    cmd(teacher, "approve", { book: copy, revision: 1, working: book.working }),
  );
});
test("draft revision conflict returns the newer server version", async () => {
  assert.equal(
    await cmd(student(1), "save", {
      q,
      revision: 0,
      body: { description: "first" },
    }),
    1,
  );
  assert.equal(
    (
      await cmd(student(1), "save", {
        q,
        revision: 0,
        body: { description: "stale" },
      })
    ).conflict.body.description,
    "first",
  );
});
test("25 concurrent local submissions including file checks, receipt, job and enqueue", async () => {
  const start = performance.now(),
    latencies = [];
  const results = await Promise.allSettled(
    Array.from({ length: 25 }, async (_, i) => {
      const t = performance.now(),
        s = await submit(i + 1);
      latencies.push(performance.now() - t);
      return s;
    }),
  );
  const failed = results.filter((r) => r.status === "rejected");
  assert.deepEqual(
    failed.map((f) => f.reason.message),
    [],
  );
  first = results[0].value.id;
  console.log(
    "25명 로컬 접수 ms",
    JSON.stringify({
      total: Math.round(performance.now() - start),
      p50: Math.round(latencies.sort((a, b) => a - b)[12]),
      p95: Math.round(latencies[23]),
      failed: failed.length,
    }),
  );
  assert.equal(
    (
      await db.query(
        "select count(*) as n from math_private.jobs where sub is not null",
      )
    ).rows[0].n,
    25,
  );
});
test("idempotency, per-item limit and sealed storage row policies", async () => {
  await cmd(student(1), "finalize", { sub: first });
  const keys = [crypto.randomUUID(), crypto.randomUUID()];
  const res = await Promise.allSettled(keys.map((k) => submit(1, k)));
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
  const second = await submit(
    1,
    keys[res.findIndex((r) => r.status === "fulfilled")],
  );
  assert.ok(second.id !== first);
  const can = async (u, writing) =>
    db.transaction(async (tx) => {
      await tx.query("select set_config('request.uid',$1,true)", [u]);
      return rpc(tx, "math_asset_ok", [first + "/page-0.png", writing]);
    });
  assert.equal(await can(student(1), true), false);
  assert.equal(await can(student(2), false), false);
  assert.equal(await can(teacher, false), true);
  await assert.rejects(cmd(student(2), "inspect", { sub: first }));
  await assert.rejects(cmd(student(2), "finalize", { sub: first }));
});
test("lease fencing and retry preserve submissions; feedback-only release cannot publish score or answer", async () => {
  const job = await rpc(db, "math_worker", ["claim", {}]);
  await assert.rejects(
    rpc(db, "math_worker", [
      "finish",
      { id: job.id, token: crypto.randomUUID(), data: {} },
    ]),
  );
  await rpc(db, "math_worker", [
    "fail",
    { id: job.id, token: job.token, error: "simulated_timeout" },
  ]);
  const inspect = await cmd(teacher, "inspect", { sub: first }),
    scores = Object.fromEntries(inspect.key.criteria.map((c) => [c.id, 1]));
  const review = await cmd(teacher, "review", {
    sub: first,
    scores,
    feedback: { strength: "관찰", focus: "풀이", next_step: "확인" },
    reason: "수동 검토",
  });
  await assert.rejects(
    cmd(student(1), "release", {
      sub: first,
      review: review.id,
      kinds: ["score"],
    }),
  );
  await cmd(teacher, "release", {
    sub: first,
    review: review.id,
    kinds: ["feedback"],
  });
  const studentView = await cmd(student(1), "inspect", { sub: first });
  assert.equal(studentView.key, null);
  assert.equal(studentView.reviews, null);
  assert.equal(studentView.runs, null);
  assert.deepEqual(
    (await cmd(student(1), "history", { q })).map((r) => r.kind),
    ["feedback"],
  );
  assert.equal((await cmd(student(2), "report", { task })).length, 0);
});
test("math survives serialization, unsupported scores and references rejected", () => {
  const parts = [{ type: "math", latex: "\\frac{x-1}{2}", block: true }];
  assert.deepEqual(JSON.parse(JSON.stringify(parts)), parts);
  checkMath(parts);
  assert.throws(() => checkMath([{ type: "math", latex: "\\frac{" }]));
  const a = {
    transcription: [
      {
        evidence_id: "e",
        page_id: pId,
        region: null,
        observed_text: "분수선",
        latex: null,
        legibility: "ambiguous",
        alternatives: [],
      },
    ],
    steps: [],
    rubric_results: [
      {
        criterion_id: "a",
        proposed_score: null,
        max_score: 2,
        evidence_refs: ["e"],
        short_reason: "판독 보류",
        review_required: true,
      },
    ],
    feedback_draft: {
      strength: "",
      focus: "분수선",
      next_step: "다시 확인",
      approved_hint_id: null,
    },
    review: { required: true, reasons: ["확인"] },
  };
  assert.equal(validateAnalysis(a, [{ id: "a", max: 2 }], [pId]).total, null);
  a.rubric_results[0].proposed_score = 0;
  assert.throws(() => validateAnalysis(a, [{ id: "a", max: 2 }], [pId]));
  a.rubric_results[0].evidence_refs = ["not-there"];
  assert.throws(() => validateAnalysis(a, [{ id: "a", max: 2 }], [pId]));
});
test.after(() => db.close());

test("authenticated Storage insert/select use slot and ownership; no overwrite policy", async () => {
  const key = crypto.randomUUID(),
    user = student(2),
    slot = await cmd(user, "prepare", { key, q, manifest }),
    path = slot.id + "/page-0.png";
  async function as(actor, sql, params) {
    return db.transaction(async (tx) => {
      await tx.query("select set_config('request.uid',$1,true)", [actor]);
      await tx.exec("set local role authenticated");
      return tx.query(sql, params);
    });
  }
  await assert.rejects(
    as(student(3), "insert into storage.objects values('math-originals',$1)", [
      path,
    ]),
  );
  await as(user, "insert into storage.objects values('math-originals',$1)", [
    path,
  ]);
  assert.equal(
    (
      await as(student(3), "select * from storage.objects where name=$1", [
        path,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (await as(user, "select * from storage.objects where name=$1", [path])).rows
      .length,
    1,
  );
  await assert.rejects(
    as(user, "update storage.objects set name=$1 where name=$1", [path]),
  );
  await assert.rejects(
    as(user, "delete from storage.objects where name=$1", [path]),
  );
  const src = lib.id + "/file.pdf";
  await as(teacher, "insert into storage.objects values('math-sources',$1)", [
    src,
  ]);
  assert.equal(
    (await as(user, "select * from storage.objects where name=$1", [src])).rows
      .length,
    0,
  );
  await assert.rejects(
    as(user, "insert into storage.objects values('math-sources',$1)", [
      lib.id + "/other.pdf",
    ]),
  );
});
test("corrupt upload never consumes attempt; interrupted processing is reclaimable", async () => {
  const slot = await cmd(student(3), "prepare", {
    q,
    manifest,
    key: crypto.randomUUID(),
  });
  await assert.rejects(cmd(student(3), "finalize", { sub: slot.id }));
  const got = (await cmd(student(3), "detail", { task })).subs;
  assert.equal(got.length, 1);
  assert.ok(!got.some((s) => s.id === slot.id));
  const j = await rpc(db, "math_worker", ["claim", {}]);
  await db.query(
    "update math_private.jobs set lease=now()-interval '1 second' where id=$1",
    [j.id],
  );
  await db.query(
    "update pgmq.messages set vt=now()-interval '1 second' where msg_id=$1",
    [j.msg],
  );
  const next = await rpc(db, "math_worker", ["claim", {}]);
  assert.equal(next.id, j.id);
  assert.notEqual(next.token, j.token);
  await assert.rejects(
    rpc(db, "math_worker", ["finish", { id: j.id, token: j.token, data: {} }]),
  );
  await rpc(db, "math_worker", [
    "finish",
    { id: j.id, token: next.token, data: { provider: "test" } },
  ]);
  assert.equal(
    (
      await db.query("select count(*) n from math_private.runs where job=$1", [
        j.id,
      ])
    ).rows[0].n,
    1,
  );
});

test("student-specific activation is leased, single-use, and bound to protected roster", async () => {
  const u = student(26),
    alias = "synthetic@classroom.invalid";
  await db.query("update auth.users set email=$1 where id=$2", [alias, u]);
  await rpc(db, "math_provision", [
    {
      uid: u,
      class_id: otherClass,
      number: "0026",
      label: "가상 26",
      alias,
      hash: "synthetic-digest",
    },
  ]);
  const p = { school: "가상학교", year: 2026, number: "0026" };
  await assert.rejects(cmd(u, "home"));
  await assert.rejects(
    rpc(db, "math_account", ["activate", { ...p, hash: "wrong" }]),
  );
  const a = await rpc(db, "math_account", [
    "activate",
    { ...p, hash: "synthetic-digest" },
  ]);
  await assert.rejects(
    rpc(db, "math_account", ["activate", { ...p, hash: "synthetic-digest" }]),
  );
  await rpc(db, "math_account", ["activated", { ...p, ticket: a.ticket }]);
  await assert.rejects(
    rpc(db, "math_account", ["activate", { ...p, hash: "synthetic-digest" }]),
  );
  assert.equal((await rpc(db, "math_account", ["login", p])).uid, u);
  assert.equal((await cmd(u, "home")).classes[0].role, "student");
});
