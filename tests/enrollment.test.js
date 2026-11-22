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
import { enrollStudent } from "../supabase/functions/_shared/enrollment.js";
import { parseRosterPaste } from "../src/roster-import.js";

test("teacher registration is scoped, immediately usable, idempotent, and cannot overwrite a student", async () => {
  const db = await database();
  try {
    const id = crypto.randomUUID();
    const p = { id, class_id: classId, number: "00101", label: "등록 연습" };
    const command = (u, op, input = p) =>
      rpc(db, "math_teacher_enroll", [u, op, input]);
    await assert.rejects(command(student(1), "check"), /enroll_denied/);
    const stranger = crypto.randomUUID();
    await db.query("insert into auth.users(id) values ($1)", [stranger]);
    await db.query(
      "insert into math_private.members(class_id,uid,role,label) values ($1,$2,'teacher','다른 교사')",
      [otherClass, stranger],
    );
    await assert.rejects(command(stranger, "check"), /enroll_denied/);
    assert.equal((await command(teacher, "check")).registered, false);
    await assert.rejects(command(teacher, "commit"), /enroll_identity/);
    await db.query("insert into auth.users(id,email) values ($1,$2)", [
      id,
      id + "@classroom.invalid",
    ]);
    assert.equal((await command(teacher, "commit")).registered, true);
    assert.equal((await command(teacher, "commit")).registered, true);
    const account = (
      await db.query("select * from math_private.accounts where uid=$1", [id])
    ).rows[0];
    assert.equal(account.force_change, false);
    assert.equal(account.code_hash, null);
    assert.equal(account.number, "00101");
    assert.equal(
      (
        await rpc(db, "math_account", [
          "login",
          { school: "가상학교", year: 2026, number: "00101" },
        ])
      ).uid,
      id,
    );
    await assert.rejects(
      command(teacher, "commit", { ...p, id: crypto.randomUUID() }),
      /enroll_duplicate/,
    );
    await assert.rejects(
      command(stranger, "check", {
        ...p,
        class_id: otherClass,
        id: crypto.randomUUID(),
      }),
      /enroll_duplicate/,
    );
    await assert.rejects(
      command(teacher, "commit", { ...p, label: "덮어쓰기" }),
      /enroll_duplicate/,
    );
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await rpc(tx, "math_teacher_enroll", [teacher, "commit", p]);
      }),
      (error) => error.code === "42501",
    );
    assert.equal(
      (
        await db.query("select label from math_private.members where uid=$1", [
          id,
        ])
      ).rows[0].label,
      "등록 연습",
    );
  } finally {
    await db.close();
  }
});

const input = {
  id: "40000000-0000-4000-8000-000000000001",
  class_id: classId,
  number: "00101",
  label: "연습",
  password: "abcdef",
};
function mock() {
  const calls = [];
  const db = {
    rpc: async (_, args) => {
      calls.push([args.op, args.p]);
      return {
        data: {
          registered: args.op === "commit",
          school: "가상학교",
          year: 2026,
        },
      };
    },
    auth: {
      admin: {
        createUser: async (p) => {
          calls.push(["create", p]);
          return { data: { user: { id: p.id } } };
        },
        deleteUser: async (id) => {
          calls.push(["delete", id]);
          return {};
        },
        getUserById: async () => ({ data: { user: null }, error: {} }),
      },
    },
  };
  return { db, calls };
}
const enroll = (db, p = input) =>
  enrollStudent(db, teacher, p, "가상학교", 2026);

test("registration validates before Auth, keeps passwords out of roster RPC, and stops duplicates", async () => {
  const { db, calls } = mock();
  await assert.rejects(enroll(db, { ...input, password: "12345" }));
  assert.equal(calls.length, 0);
  assert.equal((await enroll(db)).registered, true);
  assert.equal(calls.find(([op]) => op === "create")[1].password, "abcdef");
  assert.equal(
    calls
      .filter(([op]) => ["check", "commit"].includes(op))
      .some(([, p]) => "password" in p),
    false,
  );
  const duplicate = mock();
  duplicate.db.rpc = async () => ({ error: { message: "enroll_duplicate" } });
  await assert.rejects(enroll(duplicate.db), /이미 등록/);
  assert.equal(duplicate.calls.length, 0);
});

test("lost commit response preserves a completed account; definite failure cleans up only new Auth user", async () => {
  for (const committed of [true, false]) {
    const { db, calls } = mock();
    let checks = 0;
    db.rpc = async (_, { op }) =>
      op === "commit"
        ? { error: { message: "connection lost" } }
        : {
            data: {
              registered: ++checks > 1 && committed,
              school: "가상학교",
              year: 2026,
            },
          };
    if (committed) assert.equal((await enroll(db)).registered, true);
    else await assert.rejects(enroll(db));
    assert.equal(
      calls.some(([op]) => op === "delete"),
      !committed,
    );
  }
});

test("retry cannot reuse an unrelated existing Auth identity", async () => {
  const { db, calls } = mock();
  db.auth.admin.createUser = async () => ({ error: {} });
  db.auth.admin.getUserById = async () => ({
    data: {
      user: {
        app_metadata: { goodmath_enrollment: { teacher: "another-teacher" } },
      },
    },
  });
  await assert.rejects(enroll(db));
  assert.equal(
    calls.some(([op]) => op === "commit"),
    false,
  );
  assert.equal(
    calls.some(([op]) => op === "delete"),
    false,
  );
});

test("Excel paste validates four columns and preserves password whitespace", () => {
  assert.deepEqual(
    parseRosterPaste(
      "학번\t이름\t학급\t초기비밀번호\r\n10101\t연습\t101\t abcdef \r\n",
    ),
    [
      {
        number: "10101",
        label: "연습",
        class_name: "1학년 1반",
        password: " abcdef ",
      },
    ],
  );
  assert.throws(() => parseRosterPaste("10101\t연습\t101\tabcde"), /6~200/);
  assert.throws(
    () =>
      parseRosterPaste("10101\t연습\t101\tabcdef\n10101\t중복\t101\tabcdef"),
    /중복/,
  );
  assert.throws(() => parseRosterPaste("10101,연습,101,abcdef"), /네 열/);
});
