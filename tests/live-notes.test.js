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

const migration = "202611220007_live_notes.sql";
for (const subset of [false, true]) {
  test(`live notes isolate class drafts, return changes and preserve student saves (${subset ? "production subset" : "full schema"})`, async () => {
    const db = await database(undefined, {
      omitMigrations: [
        migration,
        ...(subset
          ? [
              "202611220004_submission_folders.sql",
              "202611220005_distribution_cancellation.sql",
            ]
          : []),
      ],
    });
    const cmd = (uid, op, p = {}) =>
      dispatch(op, p, (fn, op, p) => rpc(db, fn, [uid, op, p]));
    try {
      const [book] = await cmd(teacher, "library");
      const first = await cmd(teacher, "distribute", {
        book: book.id,
        class_id: classId,
      });
      const second = await cmd(teacher, "distribute", {
        book: book.id,
        class_id: otherClass,
      });
      const {
        questions: [q],
      } = await cmd(student(1), "detail", { task: first.task });
      const {
        questions: [otherQ],
      } = await cmd(student(26), "detail", { task: second.task });
      const body = {
        schema_version: 1,
        pages: [
          { page_id: "first", strokes: [] },
          { page_id: "second", strokes: [] },
        ],
        description: "교사에게 보이는 미제출 초안",
        attachments: ["data:image/png;base64,AA=="],
      };
      await cmd(student(1), "save", { q: q.id, revision: 0, body });
      const sql = await readFile("supabase/migrations/" + migration, "utf8");
      await db.exec(sql);
      await db.exec(sql); // Upgrade an existing classroom without modifying old drafts.
      const args = { task: first.task, q: q.id };
      let snapshot = await cmd(teacher, "liveNotes", args);
      assert.equal(snapshot.class_id, classId);
      assert.equal(snapshot.students.length, 25);
      assert.ok(!snapshot.students.some((s) => s.uid === student(26)));
      const one = snapshot.students.find((s) => s.uid === student(1));
      assert.equal(one.revision, 1);
      assert.equal(one.updated_at, null);
      assert.equal(one.pages, 2);
      assert.equal(one.attachments, 1);
      assert.deepEqual(one.preview, body.pages[0]);
      assert.equal(one.submission, null);
      assert.ok(!JSON.stringify(snapshot).includes("base64"));
      assert.ok(!JSON.stringify(snapshot).includes('"answer"'));
      assert.deepEqual(
        (await cmd(teacher, "liveNote", { ...args, uid: student(1) })).draft
          .body,
        body,
      );
      assert.equal(
        (await cmd(teacher, "liveNote", { ...args, uid: student(2) })).draft,
        null,
      );

      const known = Object.fromEntries(
        snapshot.students.map((s) => [s.uid, s.revision]),
      );
      snapshot = await cmd(teacher, "liveNotes", { ...args, known });
      assert.ok(
        snapshot.students.every(
          (s) =>
            !Object.hasOwn(s, "preview") && !Object.hasOwn(s, "description"),
        ),
      );
      assert.equal(
        await cmd(student(1), "save", {
          q: q.id,
          revision: 1,
          body: { ...body, description: "새 초안" },
        }),
        2,
      );
      const conflict = await cmd(student(1), "save", {
        q: q.id,
        revision: 1,
        body,
      });
      assert.equal(conflict.conflict.revision, 2);
      snapshot = await cmd(teacher, "liveNotes", { ...args, known });
      const updated = snapshot.students.find((s) => s.uid === student(1));
      assert.equal(updated.description, "새 초안");
      assert.ok(updated.updated_at);
      assert.equal(
        snapshot.students.filter((s) => Object.hasOwn(s, "preview")).length,
        1,
      );
      assert.equal(
        (await cmd(student(1), "draft", { q: q.id })).body.description,
        "새 초안",
      );

      await cmd(student(1), "help", { q: q.id, text: "도움 요청" });
      const sub = crypto.randomUUID();
      await db.query(
        "insert into math_private.slots(id,uid,q,key,state,manifest) values($1,$2,$3,$4,'final','{}')",
        [sub, student(1), q.id, crypto.randomUUID()],
      );
      await db.query(
        "insert into math_private.subs(id,uid,q,attempt) values($1,$2,$3,1)",
        [sub, student(1), q.id],
      );
      snapshot = await cmd(teacher, "liveNotes", { ...args, known });
      assert.equal(
        snapshot.students.find((s) => s.uid === student(1)).submission.id,
        sub,
      );
      assert.equal(
        snapshot.students.find((s) => s.uid === student(1)).help_requested,
        true,
      );

      for (const uid of [student(1), student(26), null]) {
        await assert.rejects(cmd(uid, "liveNotes", args), /denied/);
        await assert.rejects(
          cmd(uid, "liveNote", { ...args, uid: student(1) }),
          /denied/,
        );
      }
      await db.query(
        "insert into math_private.members values($1,$2,'teacher','담당이 아닌 교사',null)",
        [otherClass, student(25)],
      );
      await assert.rejects(cmd(student(25), "liveNotes", args), /denied/);
      await assert.rejects(
        cmd(student(25), "liveNotes", { task: second.task, q: otherQ.id }),
        /denied/,
      );
      await assert.rejects(
        cmd(teacher, "liveNote", { ...args, uid: student(26) }),
        /denied/,
      );
      await assert.rejects(
        cmd(teacher, "liveNotes", { ...args, q: otherQ.id }),
        /denied/,
      );
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.exec("set local role authenticated");
          await rpc(tx, "math_live_notes", [teacher, "liveNotes", args]);
        }),
        /permission denied/,
      );

      // Removed recipients and former class members disappear even with a known cached revision.
      await db.query(
        "delete from math_private.recipients where task=$1 and uid=$2",
        [first.task, student(1)],
      );
      assert.ok(
        !(await cmd(teacher, "liveNotes", { ...args, known })).students.some(
          (s) => s.uid === student(1),
        ),
      );
      await assert.rejects(
        cmd(teacher, "liveNote", { ...args, uid: student(1) }),
        /denied/,
      );
      await db.query(
        "delete from math_private.members where class_id=$1 and uid=$2",
        [classId, student(2)],
      );
      assert.ok(
        !(await cmd(teacher, "liveNotes", args)).students.some(
          (s) => s.uid === student(2),
        ),
      );
      const nextQ = crypto.randomUUID();
      await db.query(
        "insert into math_private.questions(id,task,position,version,body) values($1,$2,$3,2,$4)",
        [nextQ, first.task, q.position, q.body],
      );
      await assert.rejects(cmd(teacher, "liveNotes", args), /denied/);
      assert.ok(
        (await cmd(teacher, "liveNotes", { ...args, q: nextQ })).students.every(
          (s) => s.revision === 0,
        ),
      );
    } finally {
      await db.close();
    }
  });
}
