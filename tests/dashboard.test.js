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
  analyzeDashboard,
  progressOf,
  resultOf,
} from "../src/dashboard-analysis.js";

test("dashboard scopes the whole class, counts only current latest work and separates ungraded, missing and wrong answers", async () => {
  const db = await database();
  const cmd = (u, op, p = {}) =>
    dispatch(op, p, (fn, op, p) => rpc(db, fn, [u, op, p]));
  try {
    const [book] = await cmd(teacher, "library");
    const { working } = await cmd(teacher, "book", { book: book.id });
    const q = structuredClone(working.questions[0]);
    q.points = 10;
    q.private.criteria = [
      {
        id: "reason",
        label: [{ type: "text", text: "풀이 과정" }],
        max: 10,
        standard: [],
        partial: [],
      },
    ];
    working.questions = [
      q,
      { ...structuredClone(q), public: { ...q.public, required: false } },
    ];
    const id = await cmd(teacher, "new", {
      class_id: classId,
      title: "대시보드 검증",
      working,
    });
    await cmd(teacher, "approve", { book: id, revision: 1, working });
    const link = await cmd(teacher, "distribute", {
      book: id,
      class_id: classId,
    });
    const {
      questions: [one, two],
    } = await cmd(student(1), "detail", { task: link.task });
    async function submit(
      n,
      attempt,
      score,
      misconception = "",
      question = one,
    ) {
      const sub = crypto.randomUUID();
      await db.query(
        "insert into math_private.slots(id,uid,q,key,state,manifest) values($1,$2,$3,$4,'final','{}')",
        [sub, student(n), question.id, crypto.randomUUID()],
      );
      await db.query(
        "insert into math_private.subs(id,uid,q,attempt) values($1,$2,$3,$4)",
        [sub, student(n), question.id, attempt],
      );
      if (score !== null)
        await cmd(teacher, "review", {
          sub,
          scores: { reason: score },
          feedback: {},
          reason: "원본 확인",
          misconception,
        });
      return sub;
    }
    await submit(1, 1, 10, "이전 회차만의 오개념");
    const latest = await submit(1, 2, null);
    const revised = await submit(2, 1, 0, "수정 전 오개념");
    await cmd(teacher, "review", {
      sub: revised,
      scores: { reason: 5 },
      feedback: {},
      reason: "재검토",
      misconception: "부호 오류",
    });
    await submit(3, 1, 0, "부호 오류");
    await submit(4, 1, 10);
    await submit(25, 1, 0, "미배정 학생 데이터");
    await db.query(
      "delete from math_private.recipients where task=$1 and uid=$2",
      [link.task, student(25)],
    );
    await cmd(student(5), "save", {
      q: one.id,
      revision: 0,
      body: { pages: [], description: "전송하면 안 되는 전체 초안" },
    });
    await cmd(student(5), "help", { q: one.id, text: "도와주세요" });
    let snapshot = await cmd(teacher, "classDashboard", { task: link.task });
    assert.equal(snapshot.students.length, 25);
    assert.ok(!snapshot.students.some((s) => s.uid === student(26)));
    assert.deepEqual(
      snapshot.students.find((s) => s.uid === student(25)).cells,
      [],
    );
    assert.equal(
      snapshot.students.find((s) => s.uid === student(1)).cells[0].submission
        .id,
      latest,
    );
    assert.equal(
      snapshot.students.find((s) => s.uid === student(5)).cells[0]
        .help_requested,
      true,
    );
    assert.ok(!JSON.stringify(snapshot).includes('"answer"'));
    assert.ok(!JSON.stringify(snapshot).includes("전송하면 안 되는"));
    let analysis = analyzeDashboard(snapshot);
    assert.equal(analysis.assigned, 24);
    assert.equal(analysis.unassigned, 1);
    assert.equal(analysis.complete, 4);
    assert.equal(analysis.working, 1);
    assert.equal(analysis.notStarted, 19);
    assert.equal(analysis.submitted, 4);
    assert.equal(analysis.graded, 3);
    assert.equal(analysis.pending, 1);
    assert.deepEqual(analysis.questions[0].counts, {
      correct: 1,
      partial: 1,
      incorrect: 1,
      pending: 1,
      missing: 20,
    });
    assert.equal(analysis.questions[0].correctRate, 33);
    assert.equal(analysis.questions[0].average, 5);
    assert.equal(analysis.questions[0].criteria[0].percent, 50);
    assert.deepEqual(analysis.questions[0].misconceptions, [
      { label: "부호 오류", count: 2 },
    ]);
    assert.equal(analysis.questions[1].correctRate, null);
    assert.equal(analysis.questions[1].counts.missing, 24);
    assert.equal(
      progressOf(snapshot.students[0], snapshot.questions).percent,
      100,
      "optional questions do not block required completion",
    );

    for (const u of [null, student(1), student(26)])
      await assert.rejects(
        cmd(u, "classDashboard", { task: link.task }),
        /denied/,
      );
    await db.query(
      "insert into math_private.members values($1,$2,'teacher','같은 반의 다른 교사',null)",
      [classId, student(26)],
    );
    await assert.rejects(
      cmd(student(26), "classDashboard", { task: link.task }),
      /denied/,
    );
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await rpc(tx, "math_class_dashboard", [
          teacher,
          "classDashboard",
          { task: link.task },
        ]);
      }),
      /permission denied/,
    );

    // A new version must not count any submissions or reviews from the old question.
    const newQ = crypto.randomUUID();
    await db.query(
      "insert into math_private.questions(id,task,position,version,body) values($1,$2,1,2,$3)",
      [newQ, link.task, one.body],
    );
    await db.query(
      "insert into math_private.keys select $1,body from math_private.keys where q=$2",
      [newQ, one.id],
    );
    snapshot = await cmd(teacher, "classDashboard", { task: link.task });
    assert.equal(snapshot.questions[0].id, newQ);
    analysis = analyzeDashboard(snapshot);
    assert.equal(analysis.graded, 0);
    assert.equal(analysis.complete, 0);
    assert.equal(analysis.questions[0].correctRate, null);
    assert.deepEqual(analysis.questions[0].misconceptions, []);
    // A class move removes the student's row even if old recipients and submissions remain.
    await db.query(
      "delete from math_private.members where class_id=$1 and uid=$2",
      [classId, student(2)],
    );
    await db.query(
      "insert into math_private.members values($1,$2,'student','이동 학생','0027')",
      [otherClass, student(2)],
    );
    assert.ok(
      !(
        await cmd(teacher, "classDashboard", { task: link.task })
      ).students.some((s) => s.uid === student(2)),
    );
    assert.equal(snapshot.questions[1].id, two.id);
  } finally {
    await db.close();
  }
});

test("empty or incomplete scoring is never classified as a wrong answer", () => {
  const q = { id: "q", max_score: 0, required: true, criteria: [] };
  assert.equal(
    resultOf({ submission: { review: { score: 0 } } }, q),
    "pending",
  );
  for (const score of [null, undefined, NaN])
    assert.equal(
      resultOf({ submission: { review: { score } } }, { ...q, max_score: 10 }),
      "pending",
    );
  const snapshot = { questions: [{ ...q, max_score: 10 }], students: [] };
  assert.equal(analyzeDashboard(snapshot).questions[0].correctRate, null);
  assert.equal(progressOf({ assigned: true, cells: [] }, []).complete, false);
  assert.equal(
    resultOf(
      { submission: { review: { score: 0.1 + 0.2 } } },
      { max_score: 0.3 },
    ),
    "correct",
  );
});
