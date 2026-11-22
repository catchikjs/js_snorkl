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
import { enrollRosterStudent } from "../supabase/functions/_shared/enrollment.js";

function server(db) {
  const created = [],
    deleted = [];
  return {
    created,
    deleted,
    rpc: async (name, { u, op, p }) => {
      try {
        return { data: await rpc(db, name, [u, op, p]) };
      } catch (error) {
        return { error };
      }
    },
    auth: {
      admin: {
        createUser: async ({ id, email }) => {
          created.push(id);
          await db.query("insert into auth.users(id,email) values($1,$2)", [
            id,
            email,
          ]);
          return { data: { user: { id } } };
        },
        deleteUser: async (id) => {
          deleted.push(id);
          return {};
        },
      },
    },
  };
}
const input = (number = "00101") => ({
  id: crypto.randomUUID(),
  class_id: classId,
  number,
  label: "파일 학생",
  password: "abcdef",
});
const enroll = (db, p, user = teacher) =>
  enrollRosterStudent(db, user, p, "가상학교", 2026);

test("file registration assigns only the teacher's active class distributions and preserves existing accounts", async () => {
  const db = await database(),
    api = server(db);
  try {
    const library = await rpc(db, "math_library", [teacher, "library", {}]);
    const book = await rpc(db, "math_library", [
      teacher,
      "book",
      { book: library[0].id },
    ]);
    await rpc(db, "math_library", [
      teacher,
      "toggle",
      { book: book.id, class_id: classId, task: book.links[0].task },
    ]);
    const targeted = await rpc(db, "math_command", [
      teacher,
      "create",
      { ...book.working, class_id: classId, targets: [] },
    ]);
    const otherTeacher = crypto.randomUUID();
    await db.query("insert into auth.users(id) values($1)", [otherTeacher]);
    await db.query(
      "insert into math_private.members values($1,$2,'teacher','다른 교사',null)",
      [classId, otherTeacher],
    );
    const otherBook = await rpc(db, "math_library", [
      otherTeacher,
      "new",
      { class_id: classId, title: "다른 교사", working: book.working },
    ]);
    await rpc(db, "math_library", [
      otherTeacher,
      "approve",
      { book: otherBook, revision: 1, working: book.working },
    ]);
    const otherLink = await rpc(db, "math_library", [
      otherTeacher,
      "distribute",
      { book: otherBook, class_id: classId },
    ]);

    const p = input();
    const result = await enroll(api, p);
    assert.equal(result.registered, true);
    assert.equal(result.assigned_tasks, 2);
    const home = await rpc(db, "math_command", [p.id, "home", {}]);
    assert.equal(home.tasks.length, 2);
    assert.ok(
      home.tasks.every(
        (t) => ![targeted, otherLink.task, book.links[0].task].includes(t.id),
      ),
    );
    assert.equal(
      (
        await db.query(
          "select count(*) as n from public.math_updates where uid=$1",
          [p.id],
        )
      ).rows[0].n,
      1,
    );

    const retry = await enroll(api, {
      ...p,
      id: crypto.randomUUID(),
      password: "",
    });
    assert.equal(retry.already_registered, true);
    assert.equal(retry.assigned_tasks, 2);
    assert.equal(api.created.length, 1);
    assert.equal(api.deleted.length, 0);
    assert.equal(
      (
        await db.query(
          "select count(*) as n from math_private.recipients where uid=$1",
          [p.id],
        )
      ).rows[0].n,
      2,
    );
    await assert.rejects(enroll(api, { ...p, label: "다른 이름" }), /일치하지/);
    await assert.rejects(
      enroll(api, { ...p, class_id: otherClass }),
      /이미 등록/,
    );
    await assert.rejects(enroll(api, input("00102"), student(1)), /담당 학급/);
    assert.equal(api.created.length, 1);
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await rpc(tx, "math_roster_assignment", [teacher, "assign", p]);
      }),
      (e) => e.code === "42501",
    );
    await assert.rejects(
      rpc(db, "math_roster_assignment", [
        teacher,
        "assign",
        { ...p, id: student(26) },
      ]),
      /roster_mismatch/,
    );

    // A previously registered class member with no recipients is repaired by import.
    await db.query("delete from math_private.recipients where uid=$1", [
      student(1),
    ]);
    const existing = await enroll(api, {
      ...input("0001"),
      label: "연습 학생 1",
      password: "",
    });
    assert.equal(existing.already_registered, true);
    assert.equal(existing.assigned_tasks, 2);
    assert.equal(api.created.length, 1);
  } finally {
    await db.close();
  }
});

test("retry after assignment failure keeps the new account and completes assignment once", async () => {
  const db = await database(),
    api = server(db),
    p = input();
  try {
    const command = api.rpc;
    let fail = true;
    api.rpc = async (fn, args) => {
      if (fn === "math_roster_assignment" && args.op === "assign" && fail) {
        fail = false;
        return { error: { message: "network unavailable" } };
      }
      return command(fn, args);
    };
    await assert.rejects(enroll(api, p), /다시 등록·배정/);
    assert.equal(api.deleted.length, 0);
    assert.equal(
      (await rpc(db, "math_command", [p.id, "home", {}])).tasks.length,
      0,
    );
    const result = await enroll(api, { ...p, password: "" });
    assert.equal(result.already_registered, true);
    assert.equal(result.assigned_tasks, 3);
    assert.equal(api.created.length, 1);
    await assert.rejects(
      enroll(api, { ...input("00103"), password: "" }),
      /비밀번호/,
    );
    assert.equal(api.created.length, 1);
  } finally {
    await db.close();
  }
});
