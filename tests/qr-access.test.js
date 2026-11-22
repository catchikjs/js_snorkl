import test from "node:test";
import assert from "node:assert/strict";
import { database, rpc, teacher } from "../dev/database.js";
import { dispatch } from "../supabase/functions/_shared/gateway.js";

const denied = (error) =>
  error.code === "distribution_access_denied" &&
  error.status === 403 &&
  /본인 학급/.test(error.message);
const unavailable = (error) =>
  error.code === "distribution_link_unavailable" && error.status === 404;

for (const deployedSubset of [false, true]) {
  test(`QR access checks all seven classes, assignment and current membership (${deployedSubset ? "deployed migrations" : "all migrations"})`, async () => {
    const db = await database(undefined, {
      omitMigrations: deployedSubset
        ? [
            "202611220004_submission_folders.sql",
            "202611220005_distribution_cancellation.sql",
          ]
        : [],
    });
    const cmd = (uid, op, p = {}) =>
      dispatch(op, p, (fn, op, p) => rpc(db, fn, [uid, op, p]));
    try {
      const classes = [],
        students = [],
        links = [];
      for (let n = 1; n <= 7; n++) {
        const id = crypto.randomUUID(),
          uid = crypto.randomUUID();
        classes.push(id);
        students.push(uid);
        await db.query(
          "insert into math_private.classes(id,school,year,name,number_prefix) values($1,'QR 검증 가상학교',2026,$2,$3)",
          [id, `1학년 ${n}반`, `10${n}`],
        );
        await db.query("insert into auth.users(id) values($1)", [uid]);
        await db.query(
          "insert into math_private.members values($1,$2,'teacher','가상 교사',null),($1,$3,'student','가상 학생',$4)",
          [id, teacher, uid, `10${n}01`],
        );
      }
      const [source] = await cmd(teacher, "library");
      const { working } = await cmd(teacher, "book", { book: source.id });
      const book = await cmd(teacher, "new", {
        class_id: classes[0],
        title: "QR 학급 제한 검증",
        working,
      });
      await cmd(teacher, "approve", { book, revision: 1, working });
      for (const class_id of classes)
        links.push(await cmd(teacher, "distribute", { book, class_id }));

      for (const [i, uid] of students.entries()) {
        assert.deepEqual(
          (await cmd(uid, "home")).tasks.map((t) => t.id),
          [links[i].task],
        );
        for (const [j, link] of links.entries()) {
          // Request fields cannot impersonate another student or select a different class.
          const p = {
            token: link.token,
            uid: students[j],
            class_id: classes[j],
          };
          if (i === j) {
            assert.equal(await cmd(uid, "resolve", p), link.task);
            assert.ok(
              (await cmd(uid, "detail", { task: link.task })).questions.length,
            );
          } else {
            await assert.rejects(cmd(uid, "resolve", p), denied);
            await assert.rejects(
              rpc(db, "math_library", [uid, "resolve", p]),
              /denied/,
            );
            await assert.rejects(
              cmd(uid, "detail", { task: link.task }),
              /denied/,
            );
          }
        }
      }
      for (const link of links)
        assert.equal(
          await cmd(teacher, "resolve", { token: link.token }),
          link.task,
        );

      const newcomer = crypto.randomUUID();
      await db.query("insert into auth.users(id) values($1)", [newcomer]);
      await db.query(
        "insert into math_private.members values($1,$2,'student','아직 미배정','10102')",
        [classes[0], newcomer],
      );
      await assert.rejects(
        cmd(newcomer, "resolve", { token: links[0].token }),
        denied,
      );

      await cmd(teacher, "toggle", {
        book,
        class_id: classes[0],
        task: links[0].task,
      });
      await assert.rejects(
        cmd(students[0], "resolve", { token: links[0].token }),
        unavailable,
      );
      await cmd(teacher, "toggle", {
        book,
        class_id: classes[0],
        task: links[0].task,
      });
      await cmd(teacher, "rotate", {
        book,
        class_id: classes[1],
        task: links[1].task,
      });
      await assert.rejects(
        cmd(students[1], "resolve", { token: links[1].token }),
        unavailable,
      );
      const rotated = (await cmd(teacher, "book", { book })).links.find(
        (l) => l.class_id === classes[1],
      );
      assert.equal(
        await cmd(students[1], "resolve", { token: rotated.token }),
        rotated.task,
      );
      for (const token of [crypto.randomUUID(), "not-a-token"])
        await assert.rejects(
          cmd(students[0], "resolve", { token }),
          unavailable,
        );

      // A retained recipient row must not let a former class member open the QR.
      await db.query(
        "delete from math_private.members where class_id=$1 and uid=$2",
        [classes[0], students[0]],
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from math_private.recipients where task=$1 and uid=$2",
            [links[0].task, students[0]],
          )
        ).rows[0].n,
        1,
      );
      await assert.rejects(
        cmd(students[0], "resolve", { token: links[0].token }),
        denied,
      );
      await assert.rejects(
        cmd(students[0], "detail", { task: links[0].task }),
        /denied/,
      );
    } finally {
      await db.close();
    }
  });
}

test("QR infrastructure errors are not misreported as class permission failures", async () => {
  const failure = Object.assign(Error("database unavailable"), {
    code: "08006",
  });
  await assert.rejects(
    dispatch("resolve", { token: crypto.randomUUID() }, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
});
