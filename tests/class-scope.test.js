import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { database, rpc, teacher } from "../dev/database.js";
import {
  enrollStudent,
  enrollRosterStudent,
} from "../supabase/functions/_shared/enrollment.js";

test("repair splits 137 misclassified students, preserves work and accounts, and restricts distribution to the selected class", async () => {
  const db = await database();
  const command = (uid, op, p = {}) => rpc(db, "math_command", [uid, op, p]);
  const library = (op, p = {}) => rpc(db, "math_library", [teacher, op, p]);
  const school = "경복비즈니스고등학교";
  const counts = [18, 20, 20, 20, 19, 20, 20];
  const classes = counts.map(() => crypto.randomUUID());
  const students = [];
  const repair = await readFile(
    "scripts/repair-goodmath-class-roster.sql",
    "utf8",
  );
  const migration = await readFile(
    "supabase/migrations/202611220003_class_number_scope.sql",
    "utf8",
  );
  try {
    // Model the actual legacy incident: all seven classes imported into class 1.
    for (let i = 0; i < classes.length; i++) {
      await db.query(
        "insert into math_private.classes(id,school,year,name) values($1,$2,2026,$3)",
        [classes[i], school, `1학년 ${i + 1}반`],
      );
      await db.query(
        "insert into math_private.members values($1,$2,'teacher','가상 교사',null)",
        [classes[i], teacher],
      );
      for (let j = 1; j <= counts[i]; j++) {
        const uid = crypto.randomUUID(),
          number = `10${i + 1}${String(j).padStart(2, "0")}`;
        students.push({ uid, number, class_id: classes[i] });
        await db.query("insert into auth.users(id,email) values($1,$2)", [
          uid,
          uid + "@classroom.invalid",
        ]);
        await db.query(
          "insert into math_private.members values($1,$2,'student','가상 학생',$3)",
          [classes[0], uid, number],
        );
        await db.query(
          "insert into math_private.accounts(uid,school,year,number,alias,class_id,force_change) values($1,$2,2026,$3,$4,$5,false)",
          [uid, school, number, uid + "@classroom.invalid", classes[0]],
        );
      }
    }
    // An unconfigured destination cannot silently turn repair into a no-op.
    await assert.rejects(db.exec(repair), /seven configured classes/);
    await db.exec("rollback");

    const [source] = await library("library");
    const { working } = await library("book", { book: source.id });
    const book = await library("new", {
      class_id: classes[0],
      title: "학급 범위 검증",
      working,
    });
    await library("approve", { book, revision: 1, working });
    const link = await library("distribute", { book, class_id: classes[0] });
    const correct = students[0],
      misplaced = students[18];
    assert.equal((await library("book", { book })).links[0].people, 137);
    assert.equal((await command(misplaced.uid, "home")).tasks.length, 1);
    const detail = await command(correct.uid, "detail", { task: link.task });
    const q = detail.questions[0].id,
      sub = crypto.randomUUID();
    await db.query("insert into math_private.drafts values($1,$2,1,$3)", [
      misplaced.uid,
      q,
      { strokes: ["preserve"] },
    ]);
    await db.query(
      "insert into math_private.slots(id,uid,q,key,state,manifest) values($1,$2,$3,$4,'final','{}')",
      [sub, misplaced.uid, q, crypto.randomUUID()],
    );
    await db.query(
      "insert into math_private.subs(id,uid,q,attempt) values($1,$2,$3,1)",
      [sub, misplaced.uid, q],
    );
    const preserved = async () =>
      (
        await db.query(`select jsonb_build_object(
      'auth',(select jsonb_agg(to_jsonb(a) order by id) from auth.users a),
      'accounts',(select jsonb_agg(to_jsonb(a)-'class_id' order by uid) from math_private.accounts a),
      'questions',(select jsonb_agg(to_jsonb(q) order by id) from math_private.questions q),
      'keys',(select jsonb_agg(to_jsonb(k) order by q) from math_private.keys k),
      'subs',(select jsonb_agg(to_jsonb(s) order by id) from math_private.subs s),
      'drafts',(select jsonb_agg(to_jsonb(d) order by uid,q) from math_private.drafts d)) as value`)
      ).rows[0].value;
    const before = await preserved();
    await db.exec(migration);
    await db.exec(migration); // safe to reapply in local development
    assert.equal((await command(misplaced.uid, "home")).tasks.length, 0);
    await assert.rejects(
      command(misplaced.uid, "detail", { task: link.task }),
      /denied/,
    );
    await assert.rejects(
      library("distribute", { book, class_id: classes[0] }),
      /roster_class_mismatch/,
    );

    // Both old single-entry and new file APIs reject before creating an Auth user.
    let created = 0;
    const api = {
      rpc: async (name, { u, op, p }) => {
        try {
          return { data: await rpc(db, name, [u, op, p]) };
        } catch (error) {
          return { error };
        }
      },
      auth: {
        admin: {
          createUser: async () => {
            created++;
            throw Error("Unexpected Auth creation");
          },
        },
      },
    };
    const wrong = {
      id: crypto.randomUUID(),
      class_id: classes[0],
      number: "10299",
      label: "가상 학생",
      password: "abcdef",
    };
    for (const enroll of [enrollStudent, enrollRosterStudent])
      await assert.rejects(
        enroll(api, teacher, wrong, school, 2026),
        /학년·반/,
      );
    assert.equal(created, 0);
    await assert.rejects(
      db.query("update math_private.members set number='10299' where uid=$1", [
        correct.uid,
      ]),
      /roster_class_mismatch/,
    );

    await db.exec(repair);
    const classCounts = (
      await db.query(
        "select c.id,count(m.uid) as n from math_private.classes c left join math_private.members m on m.class_id=c.id and m.role='student' where c.school=$1 group by c.id,c.name order by c.name",
        [school],
      )
    ).rows;
    assert.deepEqual(
      classCounts.map((c) => c.n),
      counts,
    );
    const accounts = (
      await db.query(
        "select uid,class_id from math_private.accounts where school=$1",
        [school],
      )
    ).rows;
    assert.ok(
      students.every((s) =>
        accounts.some((a) => a.uid === s.uid && a.class_id === s.class_id),
      ),
    );
    assert.deepEqual(await preserved(), before);
    assert.equal((await library("book", { book })).links[0].people, 18);
    const auditCount = async () =>
      (
        await db.query(
          "select count(*) as n from math_private.changes where detail->>'action'='repair_class_number_20261122'",
        )
      ).rows[0].n;
    assert.equal(await auditCount(), 119);
    await db.exec(repair);
    assert.equal(await auditCount(), 119);
    assert.deepEqual(await preserved(), before);
    for (const s of students) {
      const home = await command(s.uid, "home");
      assert.equal(home.classes[0].id, s.class_id);
      assert.equal(home.tasks.length, s.number.startsWith("101") ? 1 : 0);
    }
    await assert.rejects(
      db.query("insert into math_private.recipients(task,uid) values($1,$2)", [
        link.task,
        misplaced.uid,
      ]),
      /roster_class_mismatch/,
    );
    await library("distribute", { book, class_id: classes[0] });
    assert.equal((await library("book", { book })).links[0].people, 18);
    assert.deepEqual(
      (await command(correct.uid, "detail", { task: link.task })).questions,
      detail.questions,
    );
    for (let i = 1; i < classes.length; i++) {
      const distributed = await library("distribute", { book, class_id: classes[i] });
      const sameClass = students.filter(s => s.class_id === classes[i]);
      const links = (await library("book", { book })).links;
      assert.equal(links.find(l => l.task === distributed.task).people, counts[i]);
      assert.equal(links.find(l => l.task === link.task).people, 18);
      for (const s of sameClass)
        assert.deepEqual((await command(s.uid, "home")).tasks.map(t => t.id), [distributed.task]);
      await assert.rejects(command(correct.uid, "detail", { task: distributed.task }), /denied/);
      for (const s of students.filter(s => s.class_id !== classes[i]))
        assert.equal((await db.query("select math_private.assigned($1,$2) as allowed", [distributed.task,s.uid])).rows[0].allowed, false);
      assert.equal((await library("distribute", { book, class_id: classes[i] })).task, distributed.task);
    }
  } finally {
    await db.close();
  }
});
