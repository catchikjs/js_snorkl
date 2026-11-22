-- Teacher-only, read-only access to the current class's saved working notes.
-- Old drafts retain a NULL timestamp; do not invent a last-saved time.
alter table math_private.drafts add column if not exists updated_at timestamptz;

create or replace function math_private.stamp_draft_save()
returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at:=clock_timestamp();
 return new;
end $$;
revoke all on function math_private.stamp_draft_save() from public,anon,authenticated;
create or replace trigger math_draft_saved
before insert or update on math_private.drafts
for each row execute function math_private.stamp_draft_save();

create or replace function public.math_live_notes(u uuid,op text,p jsonb)
returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare t tasks; qu questions; result jsonb;
begin
 if u is null or op not in ('liveNotes','liveNote')
   or exists(select from accounts where uid=u and force_change) then raise exception 'denied'; end if;
 select * into t from tasks where id=(p->>'task')::uuid;
 if not found or t.owner_id<>u or not teacher(t.class_id,u) then raise exception 'denied'; end if;
 select * into qu from questions where id=(p->>'q')::uuid and task=t.id;
 if not found or exists(select from questions newer where newer.task=t.id
   and newer.position=qu.position and newer.version>qu.version) then raise exception 'denied'; end if;

 if op='liveNote' then
   if not assigned(t.id,(p->>'uid')::uuid) then raise exception 'denied'; end if;
   return jsonb_build_object('task',t.id,'q',qu.id,'uid',p->>'uid',
     'draft',(select jsonb_build_object('revision',d.revision,'updated_at',d.updated_at,'body',d.body)
       from drafts d where d.q=qu.id and d.uid=(p->>'uid')::uuid));
 end if;

 select coalesce(jsonb_agg(row_data order by student_number,student_label),'[]') into result from (
   select m.number as student_number,m.label as student_label,
     jsonb_build_object('uid',m.uid,'number',m.number,'label',m.label,
       'revision',coalesce(d.revision,0),'updated_at',d.updated_at,
       'pages',case when jsonb_typeof(d.body->'pages')='array' then jsonb_array_length(d.body->'pages') else 0 end,
       'attachments',case when jsonb_typeof(d.body->'attachments')='array' then jsonb_array_length(d.body->'attachments') else 0 end,
       'submission',(select jsonb_build_object('id',s.id,'received',s.received,'attempt',s.attempt)
         from subs s where s.q=qu.id and s.uid=m.uid order by s.attempt desc limit 1),
       'help_requested',exists(select from events e where e.q=qu.id and e.uid=m.uid and e.kind='help'))
       || case when coalesce(p->'known'->>m.uid::text,'')=coalesce(d.revision,0)::text then '{}'::jsonb
          else jsonb_build_object('preview',d.body->'pages'->0,'description',left(d.body->>'description',4000)) end as row_data
   from members m join recipients r on r.uid=m.uid and r.task=t.id
   left join drafts d on d.uid=m.uid and d.q=qu.id
   where m.class_id=t.class_id and m.role='student' and assigned(t.id,m.uid)
 ) visible;
 return jsonb_build_object('task',t.id,'class_id',t.class_id,'q',qu.id,'checked_at',clock_timestamp(),'students',result);
end $$;
revoke all on function public.math_live_notes(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.math_live_notes(uuid,text,jsonb) to service_role;
