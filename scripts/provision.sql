-- Run in the Supabase SQL Editor as an administrator.
-- Set the UUID of an existing, approved Auth account and the school roster before execution.
-- Change only this values block for the teacher. Re-running preserves existing students.
with config as (select '학교 이름'::text school,2026 yr,'1학년 1반'::text class_name,
                        null::uuid approved_teacher),
c as (insert into math_private.classes(school,year,name)
      select school,yr,class_name from config where approved_teacher is not null
      on conflict(school,year,name) do update set name=excluded.name returning id)
insert into math_private.members(class_id,uid,role,label)
select c.id,config.approved_teacher,'teacher','담당 교사' from c,config
on conflict(class_id,uid) do nothing;
