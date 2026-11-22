-- The database chooses and freezes each submission's private Storage directory.
-- NULL preserves the location of older uploads until their files are copied.
alter table math_private.slots add column if not exists storage_prefix text;
create unique index if not exists math_slot_storage_prefix
on math_private.slots ((coalesce(storage_prefix,id::text)));

create or replace function math_private.submission_prefix(qid uuid,student_id uuid,slot_id uuid)
returns text language sql stable set search_path='' as $$
 select c.year::text||'/class-'||coalesce(c.number_prefix||'-','')||c.id::text||
 '/student-'||case when coalesce(m.number,a.number) ~ '^[A-Za-z0-9_-]{1,100}$'
   then coalesce(m.number,a.number)||'-' else '' end||student_id::text||
 '/assessment-'||t.id::text||'/question-'||q.position::text||'-v'||q.version::text||'/'||slot_id::text
 from math_private.questions q join math_private.tasks t on t.id=q.task
 join math_private.classes c on c.id=t.class_id
 left join math_private.members m on m.class_id=c.id and m.uid=student_id and m.role='student'
 left join math_private.accounts a on a.uid=student_id
 where q.id=qid
$$;

create or replace function math_private.set_submission_prefix()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.storage_prefix:=math_private.submission_prefix(new.q,new.uid,new.id);
 if new.storage_prefix is null then raise exception 'submission_location_missing'; end if;
 return new;
end $$;
revoke all on function math_private.set_submission_prefix() from public,anon,authenticated;
create or replace trigger math_submission_folder before insert on math_private.slots
for each row execute function math_private.set_submission_prefix();

create or replace function public.math_asset_ok(path text,writing boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select from math_private.accounts where uid=auth.uid() and force_change)
 and exists(select from math_private.slots s
 join math_private.questions q on q.id=s.q join math_private.tasks a on a.id=q.task
 where coalesce(s.storage_prefix,s.id::text)=regexp_replace(path,'/[^/]+$','')
 and exists(select from jsonb_array_elements(s.manifest->'files') f
   where path=coalesce(s.storage_prefix,s.id::text)||'/'||(f->>'name'))
 and case when writing then s.uid=auth.uid() and s.state='open' and math_private.can_submit(s.q,s.uid)
 else (s.uid=auth.uid() and math_private.assigned(a.id,s.uid))
   or (s.state='final' and a.owner_id=auth.uid() and math_private.teacher(a.class_id,auth.uid())) end)
$$;

-- Every consumer uses the frozen prefix, including analysis and abandoned-upload cleanup.
do $$
declare item record; definition text;
begin
 for item in select * from (values
   ('public.math_command(uuid,text,jsonb)', '''manifest'',slot.manifest', '''storage_prefix'',slot.storage_prefix,''manifest'',slot.manifest'),
   ('public.math_worker(text,jsonb)', '''manifest'',sl.manifest', '''storage_prefix'',sl.storage_prefix,''manifest'',sl.manifest'),
   ('public.math_gc(uuid)', '''files'',s.manifest->''files''', '''storage_prefix'',s.storage_prefix,''files'',s.manifest->''files''')
 ) patches(signature,old_text,new_text) loop
   definition:=pg_get_functiondef(item.signature::regprocedure);
   if strpos(definition,item.new_text)>0 then continue; end if;
   if strpos(definition,item.old_text)=0 then raise exception 'Storage location hook not found: %',item.signature; end if;
   execute replace(definition,item.old_text,item.new_text);
 end loop;
end $$;

-- Administrator-only backfill. Copy and verify through Storage API before commit.
-- Neither this RPC nor its client deletes the old files.
create or replace function public.math_archive_originals(op text,p jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare s slots; destination text; owner_uid uuid; task_id uuid;
begin
 if op='list' then
   return coalesce((select jsonb_agg(to_jsonb(candidate) order by candidate.id) from (
     select sl.id,sl.manifest,submission_prefix(sl.q,sl.uid,sl.id) as target_prefix
     from slots sl where sl.storage_prefix is null and sl.state='final'
       and exists(select from subs where id=sl.id)
       and (p->>'after' is null or sl.id>(p->>'after')::uuid)
     order by sl.id limit 100
   ) candidate),'[]');
 end if;
 if op<>'commit' then raise exception 'unknown'; end if;
 select * into strict s from slots where id=(p->>'id')::uuid for update;
 if s.state<>'final' or not exists(select from subs where id=s.id) then raise exception 'not_final'; end if;
 destination:=submission_prefix(s.q,s.uid,s.id);
 if p->>'target_prefix' is distinct from destination then raise exception 'location_changed'; end if;
 if s.storage_prefix=destination then return 'true'; end if;
 if s.storage_prefix is not null then raise exception 'already_archived'; end if;
 if exists(select from jsonb_array_elements(s.manifest->'files') f where not exists(
   select from storage.objects o where o.bucket_id='math-originals' and o.name=destination||'/'||(f->>'name')
 )) then raise exception 'archive_incomplete'; end if;
 select t.id,t.owner_id into task_id,owner_uid from questions q join tasks t on t.id=q.task where q.id=s.q;
 insert into changes(task,actor,detail) values(task_id,owner_uid,jsonb_build_object(
   'action','archive_submission_folders','submission',s.id,'old_prefix',s.id,'new_prefix',destination));
 update slots set storage_prefix=destination where id=s.id;
 perform touch(s.uid); perform touch(owner_uid);
 return 'true';
end $$;
revoke all on function public.math_archive_originals(text,jsonb) from public,anon,authenticated;
grant execute on function public.math_archive_originals(text,jsonb) to service_role;
