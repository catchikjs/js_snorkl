-- Passwords are managed only by Supabase Auth; roster rows contain no passwords.
create or replace function public.math_teacher_enroll(u uuid,op text,p jsonb)
returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare
 cl classes;
 a accounts;
 target_uid uuid := (p->>'id')::uuid;
 student_number text := btrim(p->>'number');
 student_label text := btrim(p->>'label');
begin
 select * into strict cl from classes where id=(p->>'class_id')::uuid;
 if not teacher(cl.id,u) then raise exception 'enroll_denied'; end if;
 if op not in ('check','commit') or target_uid is null
    or student_number is null or length(student_number) not between 1 and 100
    or student_label is null or length(student_label) not between 1 and 100 then
   raise exception 'enroll_invalid';
 end if;
 -- Serialize conflicting registrations, including registrations in other classes.
 perform pg_advisory_xact_lock(hashtextextended(cl.school || ':' || cl.year || ':' || student_number,0));
 select * into a from accounts where school=cl.school and year=cl.year and number=student_number;
 if found then
   if a.uid=target_uid and a.class_id=cl.id and not a.force_change
      and exists(select from members where class_id=cl.id and uid=target_uid and role='student' and label=student_label) then
     return jsonb_build_object('registered',true,'school',cl.school,'year',cl.year);
   end if;
   raise exception 'enroll_duplicate';
 end if;
 if exists(select from members where class_id=cl.id and number=student_number) then
   raise exception 'enroll_duplicate';
 end if;
 if exists(select from members where uid=target_uid) or exists(select from accounts where uid=target_uid) then
   raise exception 'enroll_identity';
 end if;
 if op='commit' then
   if not exists(select from auth.users where id=target_uid and email=target_uid::text || '@classroom.invalid') then
     raise exception 'enroll_identity';
   end if;
   insert into members(class_id,uid,role,label,number) values(cl.id,target_uid,'student',student_label,student_number);
   insert into accounts(uid,school,year,number,alias,class_id,force_change)
   values(target_uid,cl.school,cl.year,student_number,target_uid::text || '@classroom.invalid',cl.id,false);
 end if;
 return jsonb_build_object('registered',op='commit','school',cl.school,'year',cl.year);
end $$;
revoke all on function public.math_teacher_enroll(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.math_teacher_enroll(uuid,text,jsonb) to service_role;
