import test from "node:test";
import assert from "node:assert/strict";
import { database, rpc, teacher, student } from "../dev/database.js";
import { enrollClassRosterStudent } from "../supabase/functions/_shared/enrollment.js";
import { parseRosterText, routeRosterRows } from "../src/roster-import.js";

test("four-column import repairs 137 students across seven classes without recreating accounts or deleting work", async () => {
  const db = await database();
  const school = "명부 검증 학교",
    counts = [18, 20, 20, 20, 19, 20, 20];
  const classes = counts.map((_, i) => ({
    id: crypto.randomUUID(),
    name: `1학년 ${i + 1}반`,
  }));
  const students = [];
  const library = (op, p = {}) => rpc(db, "math_library", [teacher, op, p]);
  let creates = 0;
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
        createUser: async ({ id, email }) => {
          creates++;
          await db.query("insert into auth.users(id,email) values($1,$2)", [
            id,
            email,
          ]);
          return { data: { user: { id } } };
        },
      },
    },
  };
  const enroll = (row) =>
    enrollClassRosterStudent(api, teacher, row, school, 2026);
  try {
    for (const [i, c] of classes.entries()) {
      await db.query(
        "insert into math_private.classes(id,school,year,name) values($1,$2,2026,$3)",
        [c.id, school, c.name],
      );
      await db.query(
        "insert into math_private.members values($1,$2,'teacher','가상 교사',null)",
        [c.id, teacher],
      );
      for (let n = 1; n <= counts[i]; n++) {
        const uid = crypto.randomUUID(),
          number = `10${i + 1}${String(n).padStart(2, "0")}`;
        students.push({
          uid,
          number,
          label: "가상 학생",
          class_name: c.name,
          class_id: c.id,
        });
        await db.query("insert into auth.users values($1,$2)", [
          uid,
          uid + "@classroom.invalid",
        ]);
        await db.query(
          "insert into math_private.members values($1,$2,'student','가상 학생',$3)",
          [classes[0].id, uid, number],
        );
        await db.query(
          "insert into math_private.accounts(uid,school,year,number,alias,class_id,force_change) values($1,$2,2026,$3,$4,$5,false)",
          [uid, school, number, uid + "@classroom.invalid", classes[0].id],
        );
      }
    }
    const [source] = await library("library");
    const { working } = await library("book", { book: source.id });
    const book = await library("new", {
      class_id: classes[0].id,
      title: "학급별 명부 검증",
      working,
    });
    await library("approve", { book, revision: 1, working });
    const first = await library("distribute", {
      book,
      class_id: classes[0].id,
    });
    const second = await library("distribute", {
      book,
      class_id: classes[1].id,
    });
    const q = (
      await db.query(
        "select id from math_private.questions where task=$1 limit 1",
        [first.task],
      )
    ).rows[0].id;
    const misplaced = students[18],
      sub = crypto.randomUUID();
    await db.query("insert into math_private.drafts values($1,$2,1,$3)", [
      misplaced.uid,
      q,
      { strokes: ["keep"] },
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
      'slots',(select jsonb_agg(to_jsonb(s) order by id) from math_private.slots s),
      'subs',(select jsonb_agg(to_jsonb(s) order by id) from math_private.subs s),
      'drafts',(select jsonb_agg(to_jsonb(d) order by uid,q) from math_private.drafts d)) as value`)
      ).rows[0].value;
    const before = await preserved();
    for (const [i, c] of classes.entries())
      await db.query(
        "update math_private.classes set number_prefix=$2 where id=$1",
        [c.id, `10${i + 1}`],
      );
    const rows = routeRosterRows(
      parseRosterText(
        students
          .map((s) => `${s.number},${s.label},${s.class_name},`)
          .join("\n"),
      ),
      classes,
    ).map((row) => ({ ...row, id: crypto.randomUUID() }));

    // Direct requests cannot swap the class ID or skip the name/number check.
    await assert.rejects(
      enroll({ ...rows[18], class_id: classes[0].id }),
      /학년·반/,
    );
    await assert.rejects(
      enroll({ ...rows[18], class_name: classes[0].name }),
      /앞 세 자리/,
    );
    await assert.rejects(
      enroll({ ...rows[18], class_name: undefined }),
      /앞 세 자리/,
    );
    await assert.rejects(
      enroll({ ...rows[18], label: "다른 이름" }),
      /학번·이름/,
    );
    await assert.rejects(
      enrollClassRosterStudent(api, student(1), rows[18], school, 2026),
      /담당 학급/,
    );
    await db.query(
      "delete from math_private.members where class_id=$1 and uid=$2",
      [classes[0].id, teacher],
    );
    await assert.rejects(enroll(rows[18]), /담당 교사/);
    await db.query(
      "insert into math_private.members values($1,$2,'teacher','가상 교사',null)",
      [classes[0].id, teacher],
    );
    let moved = 0;
    for (const row of rows) {
      const result = await enroll(row);
      assert.equal(result.already_registered, true);
      moved += Number(result.moved);
    }
    assert.equal(moved, 119);
    assert.equal(creates, 0);
    assert.deepEqual(await preserved(), before);
    const actual = (
      await db.query(
        "select c.name,count(m.uid) as n from math_private.classes c left join math_private.members m on m.class_id=c.id and m.role='student' where c.school=$1 group by c.id,c.name order by c.name",
        [school],
      )
    ).rows;
    assert.deepEqual(
      actual.map((c) => c.n),
      counts,
    );
    const links = (await library("book", { book })).links;
    assert.equal(links.find((l) => l.task === first.task).people, 18);
    assert.equal(links.find((l) => l.task === second.task).people, 20);
    for (const s of students) {
      const account = (
        await db.query(
          "select class_id from math_private.accounts where uid=$1",
          [s.uid],
        )
      ).rows[0];
      assert.equal(account.class_id, s.class_id);
      const home = await rpc(db, "math_command", [s.uid, "home", {}]);
      assert.equal(
        home.tasks.length,
        s.number.startsWith("101") || s.number.startsWith("102") ? 1 : 0,
      );
      if (s.number.startsWith("102"))
        assert.equal(home.tasks[0].id, second.task);
    }
    for (const row of rows) assert.equal((await enroll(row)).moved, false);
    assert.equal(
      (
        await db.query(
          "select count(*) as n from math_private.changes where detail->>'action'='class_roster_transfer'",
        )
      ).rows[0].n,
      119,
    );
    assert.deepEqual(await preserved(), before);
    assert.equal(creates, 0);
    const fresh = {
      id: crypto.randomUUID(),
      number: "10199",
      label: "새 학생",
      class_name: classes[0].name,
      class_id: classes[0].id,
      password: "abcdef",
    };
    assert.equal((await enroll(fresh)).already_registered, false);
    assert.equal(creates, 1);
    assert.equal((await enroll(fresh)).already_registered, true);
    assert.equal(creates, 1);
    await db.exec("set role authenticated");
    await assert.rejects(
      rpc(db, "math_class_roster", [teacher, "check", rows[0]]),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
