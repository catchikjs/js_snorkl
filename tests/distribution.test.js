import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { database, rpc, teacher, student, classId } from "../dev/database.js";
import { dispatch } from "../supabase/functions/_shared/gateway.js";

test("class distribution preserves file content, notifies recipients and includes new students on redistribution", async () => {
  const db = await database();
  const cmd = (uid, op, p = {}) => dispatch(op, p,
    (fn, op, p) => rpc(db, fn, [uid, op, p]));
  try {
    // Existing local databases reapply this migration at startup.
    await db.exec(await readFile("supabase/migrations/202611220001_distribution_updates.sql", "utf8"));
    const [original] = await cmd(teacher, "library");
    const { working } = await cmd(teacher, "book", { book: original.id });
    const image = {
      png: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WL7vM8AAAAASUVORK5CYII=",
      source_asset_id: original.id + "/problem.pdf", source_version: 1,
      page: 1, rect: [0, 0, 100, 100], rotation: 0, width: 1, height: 1,
    };
    working.title = "파일 배포 검증";
    working.questions[0].public.prompt = [];
    working.questions[0].public.images = [image];
    const book = await cmd(teacher, "new", { class_id: classId, title: working.title, working });
    await cmd(teacher, "approve", { book, revision: 1, working });
    await db.exec("delete from public.math_updates");
    const link = await cmd(teacher, "distribute", { book, class_id: classId });
    const updates = (await db.query("select uid from public.math_updates")).rows;
    assert.equal(updates.length, 25);
    assert.ok(updates.some((r) => r.uid === student(1)));
    assert.ok(!updates.some((r) => r.uid === student(26)));
    assert.ok((await cmd(student(1), "home")).tasks.some((t) => t.id === link.task));
    const detail = await cmd(student(1), "detail", { task: link.task });
    assert.deepEqual(detail.questions[0].body, working.questions[0].public);
    assert.ok(!JSON.stringify(detail).includes('"answer"'));
    await assert.rejects(cmd(student(26), "detail", { task: link.task }));

    const newcomer = crypto.randomUUID();
    await db.query("insert into auth.users(id,email) values($1,$2)", [newcomer, newcomer + "@classroom.invalid"]);
    await rpc(db, "math_teacher_enroll", [teacher, "commit", {
      id: newcomer, class_id: classId, number: "0099", label: "새 학생",
    }]);
    assert.deepEqual((await cmd(newcomer, "home")).tasks, []);
    await db.exec("delete from public.math_updates");
    assert.deepEqual(await cmd(teacher, "distribute", { book, class_id: classId }), link);
    assert.deepEqual((await db.query("select uid from public.math_updates")).rows, [{ uid: newcomer }]);
    assert.equal((await cmd(newcomer, "home")).tasks[0].id, link.task);
    assert.deepEqual((await cmd(newcomer, "detail", { task: link.task })).questions, detail.questions);
    assert.equal((await cmd(teacher, "book", { book })).links[0].people, 26);

    // Roster refresh uses the same recipient notification without duplicates.
    const refreshed = crypto.randomUUID();
    await db.query("insert into auth.users(id) values($1)", [refreshed]);
    await db.query("insert into math_private.members values($1,$2,'student','명부 갱신 학생','0100')", [classId, refreshed]);
    await db.exec("delete from public.math_updates");
    await cmd(teacher, "refreshRoster", { book, class_id: classId, task: link.task });
    assert.deepEqual((await db.query("select uid from public.math_updates")).rows, [{ uid: refreshed }]);
    assert.equal(await cmd(refreshed, "resolve", { token: link.token }), link.task);
    await cmd(teacher, "distribute", { book, class_id: classId });
    const saved = await cmd(teacher, "book", { book });
    assert.equal(saved.links.length, 1);
    assert.equal(saved.links[0].people, 27);
  } finally {
    await db.close();
  }
});
