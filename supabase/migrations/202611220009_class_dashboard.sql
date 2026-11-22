-- Class overview: current question versions, latest submissions and latest teacher reviews.
-- Only metadata is sent on each poll; full drafts are fetched for the selected student.
create or replace function public.math_class_dashboard(u uuid,op text,p jsonb)
returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare t tasks; qs jsonb; students jsonb;
begin
 if u is null or op is distinct from 'classDashboard'
   or exists(select from accounts where uid=u and force_change) then raise exception 'denied'; end if;
 select * into t from tasks where id=(p->>'task')::uuid;
 if not found or t.owner_id<>u or not teacher(t.class_id,u) then raise exception 'denied'; end if;

 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'position',q.position,'version',q.version,
   'required',coalesce((q.body->>'required')::boolean,false),
   'max_score',(select coalesce(sum((c->>'max')::numeric),0) from jsonb_array_elements(k.body->'criteria') c),
   'criteria',(select coalesce(jsonb_agg(jsonb_build_object('id',c->>'id','label',c->'label','max',c->'max')),'[]')
     from jsonb_array_elements(k.body->'criteria') c)) order by q.position),'[]') into qs
 from questions q join keys k on k.q=q.id where q.task=t.id
 and not exists(select from questions n where n.task=t.id and n.position=q.position and n.version>q.version);

 select coalesce(jsonb_agg(jsonb_build_object('uid',m.uid,'number',m.number,'label',m.label,
   'assigned',assigned(t.id,m.uid),
   'cells',case when assigned(t.id,m.uid) then (
     select coalesce(jsonb_agg(jsonb_build_object('q',q.id,'revision',coalesce(d.revision,0),'updated_at',d.updated_at,
       'help_requested',exists(select from events e where e.uid=m.uid and e.q=q.id and e.kind='help'),
       'submission',case when s.id is null then null else jsonb_build_object('id',s.id,'attempt',s.attempt,'received',s.received,
         'review',case when rv.id is null then null else jsonb_build_object('id',rv.id,'scores',rv.body->'scores',
           'score',(select sum(value::numeric) from jsonb_each_text(rv.body->'scores')),
           'misconception',rv.body->>'misconception','created',rv.created) end,
         'released',exists(select from releases r where r.sub=s.id and r.review=rv.id)) end) order by q.position),'[]')
     from questions q
     left join drafts d on d.q=q.id and d.uid=m.uid
     left join lateral (select * from subs where uid=m.uid and q=q.id order by attempt desc limit 1) s on true
     left join lateral (select * from reviews where sub=s.id order by version desc limit 1) rv on true
     where q.task=t.id and not exists(select from questions n where n.task=t.id and n.position=q.position and n.version>q.version)
   ) else '[]'::jsonb end) order by m.number,m.label,m.uid),'[]') into students
 from members m where m.class_id=t.class_id and m.role='student';
 return jsonb_build_object('task',t.id,'class_id',t.class_id,'checked_at',clock_timestamp(),'questions',qs,'students',students);
end $$;
revoke all on function public.math_class_dashboard(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.math_class_dashboard(uuid,text,jsonb) to service_role;
