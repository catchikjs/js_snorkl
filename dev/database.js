import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
export const teacher = "10000000-0000-4000-8000-000000000001";
export const classId = "20000000-0000-4000-8000-000000000001";
export const otherClass = "20000000-0000-4000-8000-000000000002";
export const student = (n) =>
  "30000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const rpc = async (db, fn, args) =>
  (
    await db.query(
      "select public." +
        fn +
        "(" +
        args.map((_, i) => "$" + (i + 1)).join(",") +
        ") as value",
      args,
    )
  ).rows[0].value;
export async function database(dir) {
  const db = new PGlite(dir);
  if ((await db.query("select to_regclass('math_private.books') as b")).rows[0].b) {
    if (
      !(await db.query("select to_regclass('math_private.hidden_books') as b"))
        .rows[0].b
    )
      await db.exec(
        await readFile("supabase/migrations/202611200007_hidden_books.sql", "utf8"),
      );
    await db.exec(
      await readFile("supabase/migrations/202611200008_queue_send.sql", "utf8"),
    );
    await db.exec(
      await readFile("supabase/migrations/202611200009_draft_matching.sql", "utf8"),
    );
    await db.exec(
      await readFile("supabase/migrations/202611210001_teacher_enrollment.sql", "utf8"),
    );
    return db;
  }
  await db.transaction(async (db) => {
    await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));alter table storage.objects enable row level security;
 grant usage on schema auth,storage to authenticated;grant select,insert on storage.objects to authenticated;
 create schema pgmq;create table pgmq.messages(msg_id bigint generated always as identity primary key,message jsonb,vt timestamptz default now());
 create function pgmq.create(text) returns void language sql as $$select$$;
 create function pgmq.send(text,jsonb) returns setof bigint language sql as $$insert into pgmq.messages(message) values($2) returning msg_id$$;
 create function pgmq.read(text,int,int) returns setof pgmq.messages language sql as $$update pgmq.messages set vt=now()+make_interval(secs=>$2) where msg_id in(select msg_id from pgmq.messages where vt<=now() order by msg_id limit $3 for update skip locked) returning *$$;
 create function pgmq.archive(text,bigint) returns boolean language sql as $$delete from pgmq.messages where msg_id=$2 returning true$$;
 `);
    for (const file of (await readdir("supabase/migrations")).sort()) {
      const sql = (await readFile("supabase/migrations/" + file, "utf8"))
        .replace("create extension if not exists pgmq;", "")
        .replace(
          "alter publication supabase_realtime add table public.math_updates;",
          "",
        );
      await db.exec(sql);
    }
    await db.query("insert into auth.users values ($1)", [teacher]);
    for (const [id, name] of [
      [classId, "1학년 1반"],
      [otherClass, "1학년 2반"],
    ]) {
      await db.query(
        "insert into math_private.classes values ($1,'가상학교',2026,$2)",
        [id, name],
      );
      await db.query(
        "insert into math_private.members values ($1,$2,'teacher','가상 교사',null)",
        [id, teacher],
      );
    }
    for (let n = 1; n <= 26; n++) {
      await db.query("insert into auth.users values ($1)", [student(n)]);
      await db.query(
        "insert into math_private.members values ($1,$2,'student',$3,$4)",
        [
          n === 26 ? otherClass : classId,
          student(n),
          "연습 학생 " + n,
          String(n).padStart(4, "0"),
        ],
      );
    }
    const texts = (text) => [{ type: "text", text }];
    for (const [i, title, unit, prompt, latex, answer] of [
      [
        0,
        "역함수의 식 구하기",
        "함수와 그래프",
        "다음 함수의 역함수를 구하고, 식을 정리한 과정을 설명하세요.",
        "f(x)=2x+1",
        "f^{-1}(x)=\\frac{x-1}{2}",
      ],
      [
        1,
        "이차방정식의 두 근",
        "방정식과 부등식",
        "인수분해를 이용해 다음 방정식의 해를 구하세요.",
        "x^2-5x+6=0",
        "x=2,3",
      ],
      [
        2,
        "두 집합의 교집합",
        "집합과 명제",
        "두 집합의 공통 원소를 찾아 교집합을 쓰세요.",
        "A=\\{1,2,3\\},\\ B=\\{2,3,4\\}",
        "A\\cap B=\\{2,3\\}",
      ],
    ]) {
      const key = {
        conditions: [],
        answer: [{ type: "math", latex: answer, block: true }],
        solution: texts(
          [
            "입력과 출력의 역할을 바꾼 뒤 식을 정리한다.",
            "두 일차식의 곱으로 정리한다.",
            "두 집합에 모두 들어 있는 원소를 찾는다.",
          ][i],
        ),
        alternatives: [],
        errors: [],
        check: [],
        criteria: [
          {
            id: "reason",
            label: texts("풀이 과정"),
            standard: texts("타당한 근거와 답을 제시한다."),
            max: 10,
            partial: texts("과정과 결과를 구분하여 평가한다."),
          },
        ],
        hints: [
          {
            id: "first",
            text: [
              "입력과 출력을 바꿔 보세요.",
              "곱해서 6, 더해서 5가 되는 두 수를 찾아보세요.",
              "두 목록에 모두 있는 수를 표시하세요.",
            ][i],
          },
        ],
      };
      const work = {
        kind: i === 1 ? "수행평가" : "간단퀴즈",
        subject: i === 1 ? "공통수학1" : "공통수학2",
        title,
        unit,
        difficulty: "기본",
        instructions: "풀이 과정을 함께 제출하세요.",
        starts: new Date(Date.now() - 86400000).toISOString(),
        ends: new Date(Date.now() + (i + 3) * 86400000).toISOString(),
        attempts: 2,
        hints: i !== 1,
        late: false,
        questions: [
          {
            points: 10,
            public: {
              prompt: [...texts(prompt), { type: "math", latex, block: true }],
              images: [],
              choices: [],
              required: true,
            },
            private: key,
          },
        ],
      };
      const id = await rpc(db, "math_library", [
        teacher,
        "new",
        { class_id: classId, title, working: work },
      ]);
      await rpc(db, "math_library", [
        teacher,
        "approve",
        { book: id, revision: 1, working: work },
      ]);
      await rpc(db, "math_library", [
        teacher,
        "distribute",
        { book: id, class_id: classId },
      ]);
    }
  });
  return db;
}
