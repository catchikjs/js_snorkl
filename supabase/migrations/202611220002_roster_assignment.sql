-- Explicit roster import reuses matching class members without changing Auth.
create or replace function public.math_roster_assignment(u uuid,op text,p jsonb)
returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare
 cl classes;
 target members;
 student_number text := btrim(p->>'number');
 student_label text := btrim(p->>'label');
 assigned_count int;
begin
 select * into strict cl from classes where id=(p->>'class_id')::uuid;
 if u is null or not teacher(cl.id,u)
    or exists(select from accounts where uid=u and force_change) then
   raise exception 'enroll_denied';
 end if;
 if op not in ('check','assign') or student_number is null or student_label is null
    or length(student_number) not between 1 and 100 or length(student_label) not between 1 and 100 then
   raise exception 'enroll_invalid';
 end if;
 select * into target from members where class_id=cl.id and number=student_number;
 if found and (target.role<>'student' or target.label<>student_label) then
   raise exception 'roster_mismatch';
 end if;
 if op='check' then
   return jsonb_build_object('id',target.uid,'school',cl.school,'year',cl.year);
 end if;
 if target.uid is null or target.uid is distinct from (p->>'id')::uuid then
   raise exception 'roster_mismatch';
 end if;
 insert into recipients(task,uid)
 select t.id,target.uid from links l join tasks t on t.id=l.task and t.class_id=l.class_id
 where l.class_id=cl.id and l.active and t.owner_id=u
 on conflict do nothing;
 select count(*) into assigned_count from recipients r
 join tasks t on t.id=r.task join links l on l.task=t.id and l.class_id=t.class_id
 where r.uid=target.uid and t.class_id=cl.id and t.owner_id=u and l.active;
 return jsonb_build_object('assigned_tasks',assigned_count);
end $$;
revoke all on function public.math_roster_assignment(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.math_roster_assignment(uuid,text,jsonb) to service_role;
