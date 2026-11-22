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
import { resetStudentPassword } from "../supabase/functions/_shared/password-reset.js";

for (const subset of [false, true]) {
  test(`password reset authorizes only active students of the teacher's class and preserves work (${subset ? "partial" : "full"} schema)`, async () => {
    const db = await database(undefined, {
      omitMigrations: subset
        ? [
            "202611220004_submission_folders.sql",
            "202611220005_distribution_cancellation.sql",
          ]
        : [],
    });
    const updates = [],
      commands = [];
    const api = {
      rpc: async (fn, { u, p }) => {
        commands.push(p);
        try {
          return { data: await rpc(db, fn, [u, p]) };
        } catch (error) {
          return { error };
        }
      },
      auth: {
        admin: {
          getUserById: async (id) => ({
            data: {
              user: (
                await db.query("select id,email from auth.users where id=$1", [
                  id,
                ])
              ).rows[0],
            },
          }),
          updateUserById: async (id, attributes) => {
            updates.push({ id, attributes });
            return { data: { user: { id } } };
          },
        },
      },
    };
    const input = {
      class_id: classId,
      uid: student(1),
      password: " new-password ",
    };
    const reset = (
      actor = teacher,
      p = input,
      school = "가상학교",
      year = 2026,
    ) => resetStudentPassword(api, actor, p, school, year);
    try {
      const migration = await readFile(
        "supabase/migrations/202611220008_student_password_reset.sql",
        "utf8",
      );
      await db.exec(migration); // Safe to reapply to existing classroom data.
      for (const n of [1, 26]) {
        const uid = student(n),
          cl = n === 1 ? classId : otherClass;
        await db.query("update auth.users set email=$2 where id=$1", [
          uid,
          uid + "@classroom.invalid",
        ]);
        await db.query(
          "insert into math_private.accounts(uid,school,year,number,alias,class_id,force_change) values($1,'가상학교',2026,$2,$3,$4,false)",
          [uid, String(n).padStart(4, "0"), uid + "@classroom.invalid", cl],
        );
      }
      const q = (
        await db.query("select id from math_private.questions limit 1")
      ).rows[0].id;
      await db.query(
        "insert into math_private.drafts(uid,q,revision,body) values($1,$2,1,$3)",
        [student(1), q, { description: "보존할 학생 풀이" }],
      );
      const snapshot = async () =>
        (
          await db.query(`select jsonb_build_object(
        'members',(select jsonb_agg(to_jsonb(m) order by class_id,uid) from math_private.members m),
        'accounts',(select jsonb_agg(to_jsonb(a) order by uid) from math_private.accounts a),
        'drafts',(select jsonb_agg(to_jsonb(d) order by uid,q) from math_private.drafts d),
        'subs',(select jsonb_agg(to_jsonb(s) order by id) from math_private.subs s)
      ) as value`)
        ).rows[0].value;
      const before = await snapshot();
      assert.deepEqual(await reset(), { reset: true, uid: student(1) });
      assert.deepEqual(updates, [
        { id: student(1), attributes: { password: input.password } },
      ]);
      assert.deepEqual(await snapshot(), before);
      assert.ok(commands.every((p) => !Object.hasOwn(p, "password")));
      assert.equal(
        (
          await rpc(db, "math_account", [
            "login",
            { school: "가상학교", year: 2026, number: "0001" },
          ])
        ).uid,
        student(1),
      );

      // Remove the actor's second-class membership: its students must now be inaccessible.
      await db.query(
        "delete from math_private.members where uid=$1 and class_id=$2",
        [teacher, otherClass],
      );
      for (const actor of [student(1), student(26), null])
        await assert.rejects(reset(actor), /담당 학급/);
      await assert.rejects(
        reset(teacher, { ...input, uid: teacher }),
        /담당 학급/,
      );
      await assert.rejects(
        reset(teacher, { ...input, uid: student(26) }),
        /담당 학급/,
      );
      await assert.rejects(
        reset(teacher, { ...input, class_id: otherClass, uid: student(26) }),
        /담당 학급/,
      );
      await assert.rejects(reset(teacher, input, "다른 학교"), /로그인 설정/);
      await assert.rejects(
        reset(teacher, input, "가상학교", 2027),
        /로그인 설정/,
      );
      for (const password of ["12345", "      ", null, "a".repeat(201)])
        await assert.rejects(reset(teacher, { ...input, password }), /6~200/);
      await assert.rejects(
        reset(teacher, { ...input, uid: "invalid" }),
        /학급과 학생/,
      );
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.exec("set local role authenticated");
          return rpc(tx, "math_password_reset_target", [
            teacher,
            { class_id: classId, uid: student(1) },
          ]);
        }),
        /permission denied/,
      );

      await db.query(
        "update math_private.accounts set force_change=true where uid=$1",
        [student(1)],
      );
      await assert.rejects(reset(), /활성화/);
      await db.query(
        "update math_private.accounts set force_change=false where uid=$1",
        [student(1)],
      );
      await db.query(
        "insert into math_private.members values($1,$2,'teacher','교사 겸임',null)",
        [otherClass, student(1)],
      );
      await assert.rejects(reset(), /담당 학급/);
      await db.query(
        "delete from math_private.members where class_id=$1 and uid=$2",
        [otherClass, student(1)],
      );
      await db.query(
        "update math_private.members set number='0099' where class_id=$1 and uid=$2",
        [classId, student(1)],
      );
      await assert.rejects(reset(), /담당 학급/);
      assert.equal(
        updates.length,
        1,
        "every rejected request leaves Auth credentials untouched",
      );
    } finally {
      await db.close();
    }
  });
}

test("password reset rejects Auth identity mismatches and never returns passwords or provider errors", async () => {
  const uid = student(1),
    calls = [];
  const db = {
    rpc: async () => ({
      data: {
        uid,
        alias: uid + "@classroom.invalid",
        school: "가상학교",
        year: 2026,
      },
    }),
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { id: uid, email: "unrelated@example.invalid" } },
        }),
        updateUserById: async () => {
          calls.push("updated");
          return { error: { message: "secret password details" } };
        },
      },
    },
  };
  const reset = () =>
    resetStudentPassword(
      db,
      teacher,
      { class_id: classId, uid, password: "new-password" },
      "가상학교",
      2026,
    );
  await assert.rejects(reset(), /계정 정보/);
  assert.equal(calls.length, 0);
  db.auth.admin.getUserById = async () => ({
    data: { user: { id: uid, email: uid + "@classroom.invalid" } },
  });
  await assert.rejects(
    reset(),
    (error) =>
      !error.message.includes("secret") && /결과를 확인/.test(error.message),
  );
  db.auth.admin.updateUserById = async () => ({
    data: { user: { id: student(26) } },
  });
  await assert.rejects(reset(), /결과를 확인/);
});
