-- Class numbering is explicit configuration, not a guess from a student's ID.
alter table math_private.classes add column if not exists number_prefix text
  check (number_prefix is null or number_prefix ~ '^[0-9]{3}$');

-- Confirmed by the school: 101..107 mean 1학년 1..7반 in 2026.
update math_private.classes
set number_prefix='1'||lpad(substring(name from '^1학년 ([1-7])반$'),2,'0')
where school='경복비즈니스고등학교' and year=2026 and name ~ '^1학년 [1-7]반$';

create or replace function math_private.roster_number_ok(c uuid,n text)
returns boolean language sql stable set search_path='' as $$
 select coalesce((select number_prefix is null or
   (n ~ '^[0-9]{5}$' and left(n,3)=number_prefix)
   from math_private.classes where id=c),false)
$$;

create or replace function math_private.guard_student_class()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role='student' and not math_private.roster_number_ok(new.class_id,new.number) then
   raise exception 'roster_class_mismatch' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function math_private.guard_student_class() from public,anon,authenticated;
create or replace trigger math_student_class_number
before insert or update on math_private.members
for each row execute function math_private.guard_student_class();

create or replace function math_private.guard_recipient_class()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select from math_private.tasks t join math_private.members m
   on m.class_id=t.class_id and m.uid=new.uid and m.role='student'
   where t.id=new.task and math_private.roster_number_ok(m.class_id,m.number)) then
   raise exception 'roster_class_mismatch' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function math_private.guard_recipient_class() from public,anon,authenticated;
create or replace trigger math_recipient_class_number
before insert or update on math_private.recipients
for each row execute function math_private.guard_recipient_class();

-- Invalid legacy membership must not grant access while it awaits repair.
create or replace function math_private.assigned(t uuid,u uuid)
returns boolean language sql stable set search_path='' as $$
 select exists(select from math_private.recipients r
 join math_private.tasks a on a.id=r.task
 join math_private.members m on m.class_id=a.class_id and m.uid=r.uid
 where r.task=t and r.uid=u and m.role='student'
 and math_private.roster_number_ok(m.class_id,m.number))
$$;

-- Reject a wrong class before Auth account creation, including older clients.
do $$
declare
 signature text;
 definition text;
 marker text;
 guard constant text := $guard$if not roster_number_ok(cl.id,student_number) then
   raise exception 'roster_class_mismatch';
 end if;
 $guard$;
begin
 foreach signature in array array['public.math_teacher_enroll(uuid,text,jsonb)', 'public.math_roster_assignment(uuid,text,jsonb)'] loop
   definition:=pg_get_functiondef(signature::regprocedure);
   marker:=case when signature like '%math_teacher_enroll%' then
     '-- Serialize conflicting registrations, including registrations in other classes.'
     else 'select * into target from members where class_id=cl.id and number=student_number;' end;
   if strpos(definition,guard)>0 then continue; end if;
   if strpos(definition,marker)=0 then raise exception 'Roster validation hook not found: %',signature; end if;
   execute replace(definition,marker,guard||marker);
 end loop;
end $$;
