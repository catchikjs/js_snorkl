-- Cancelling a class distribution retains its questions, recipients and submissions.
-- Link disabling alone remains a separate legacy operation.
alter table math_private.links add column if not exists withdrawn_at timestamptz;

create or replace function math_private.assigned(t uuid,u uuid)
returns boolean language sql stable set search_path='' as $$
 select exists(select from math_private.recipients r
 join math_private.tasks a on a.id=r.task
 join math_private.members m on m.class_id=a.class_id and m.uid=r.uid
 where r.task=t and r.uid=u and m.role='student'
 and math_private.roster_number_ok(m.class_id,m.number)
 and not exists(select from math_private.links l where l.task=t and l.withdrawn_at is not null))
$$;

create or replace function public.math_distribution(u uuid,op text,p jsonb)
returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare b books; l links; recipient record;
begin
 if u is null or exists(select from accounts where uid=u and force_change)
   or op not in ('cancelDistribution','resumeDistribution') then raise exception 'denied'; end if;
 select * into strict b from books where id=(p->>'book')::uuid
   and owner_id=u and teacher(class_id,u) for update;
 if not teacher((p->>'class_id')::uuid,u) then raise exception 'denied'; end if;
 -- Serialize against in-flight reads/submissions before changing access.
 perform 1 from tasks where id=(p->>'task')::uuid and owner_id=u
   and class_id=(p->>'class_id')::uuid for update;
 if not found then raise exception 'denied'; end if;
 select * into strict l from links where task=(p->>'task')::uuid and book=b.id
   and class_id=(p->>'class_id')::uuid for update;
 if op='cancelDistribution' then
   if l.withdrawn_at is not null then return to_jsonb(l); end if;
   update links set withdrawn_at=clock_timestamp(),active=false where task=l.task returning * into l;
 else
   if l.withdrawn_at is null then return to_jsonb(l); end if;
   insert into recipients(task,uid) select l.task,uid from members
     where class_id=l.class_id and role='student' on conflict do nothing;
   update links set withdrawn_at=null,active=true where task=l.task returning * into l;
 end if;
 insert into changes(task,actor,detail) values(l.task,u,jsonb_build_object(
   'action',op,'class_id',l.class_id,'book',b.id,'revision',l.revision));
 for recipient in select uid from recipients where task=l.task loop perform touch(recipient.uid); end loop;
 perform touch(u);
 return to_jsonb(l);
end $$;
revoke all on function public.math_distribution(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.math_distribution(uuid,text,jsonb) to service_role;

do $$
declare definition text; marker text; replacement text;
begin
 definition:=pg_get_functiondef('public.math_command(uuid,text,jsonb)'::regprocedure);
 marker:='role_teacher:=teacher(t.class_id,u) and t.owner_id=u; permitted:=assigned(t.id,u);';
 replacement:='perform 1 from tasks where id=t.id for share;'||chr(10)||' '||marker;
 if strpos(definition,replacement)=0 then
   if strpos(definition,marker)=0 then raise exception 'Task permission hook not found'; end if;
   execute replace(definition,marker,replacement);
 end if;

 definition:=pg_get_functiondef('public.math_library(uuid,text,jsonb)'::regprocedure);
 -- An explicit distribution of the same approved version resumes the stored task.
 marker:='insert into recipients(task,uid)'||chr(10)||' select l.task,uid from members where class_id=c and role=''student''';
 replacement:=$resume$if l.withdrawn_at is not null then
   perform public.math_distribution(u,'resumeDistribution',jsonb_build_object('book',b.id,'class_id',c,'task',l.task));
   select * into strict l from links where task=l.task;
 end if;
 $resume$||marker;
 if strpos(definition,replacement)=0 then
   if strpos(definition,marker)=0 then raise exception 'Distribution roster hook not found'; end if;
   definition:=replace(definition,marker,replacement);
 end if;
 marker:='case op when ''rotate'' then';
 replacement:=$guard$if l.withdrawn_at is not null and op in ('rotate','toggle','refreshRoster') then
   raise exception 'distribution_cancelled';
 end if;
 $guard$||marker;
 if strpos(definition,replacement)=0 then
   if strpos(definition,marker)=0 then raise exception 'Link mutation hook not found'; end if;
   definition:=replace(definition,marker,replacement);
 end if;
 execute definition;
end $$;
