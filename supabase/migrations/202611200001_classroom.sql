create extension if not exists pgmq;
select pgmq.create('math_analysis');
create schema math_private;
revoke all on schema math_private from public,anon,authenticated;
create table math_private.classes(id uuid primary key default gen_random_uuid(),school text not null,year int not null,name text not null, unique(school,year,name));
create table math_private.members(class_id uuid references math_private.classes, uid uuid references auth.users, role text check(role in ('student','teacher')) not null, label text not null, number text, primary key(class_id,uid),unique(class_id,number));
create index on math_private.members(uid);
create table math_private.accounts(uid uuid primary key references auth.users,school text not null,year int not null,number text not null,alias text not null unique,class_id uuid not null,code_hash text,expires timestamptz,force_change boolean not null default true,unique(school,year,number),foreign key(class_id,uid) references math_private.members);
create table math_private.throttle(key text primary key, hits int not null, since timestamptz not null);
create table math_private.tasks(id uuid primary key default gen_random_uuid(),class_id uuid not null references math_private.classes,owner_id uuid not null references auth.users, kind text not null check(kind in ('간단퀴즈','수행평가')), title text not null, subject text not null,unit text not null,instructions text not null,starts timestamptz not null,ends timestamptz not null check(ends>starts),attempts int not null check(attempts between 1 and 20),late boolean not null,hints boolean not null);
create table math_private.recipients(task uuid references math_private.tasks,uid uuid references auth.users,late boolean default false not null,extra int not null default 0,primary key(task,uid));
create index on math_private.recipients(uid);
create table math_private.questions(id uuid primary key default gen_random_uuid(), task uuid not null references math_private.tasks,position int not null,version int not null default 1,body jsonb not null,unique(task,position,version));
create table math_private.keys(q uuid primary key references math_private.questions,body jsonb not null);
create table math_private.drafts(uid uuid references auth.users,q uuid references math_private.questions,revision int not null,body jsonb not null,primary key(uid,q));
create table math_private.slots(id uuid primary key default gen_random_uuid(),uid uuid not null references auth.users,q uuid not null references math_private.questions,key uuid not null,state text default 'open' check(state in ('open','sealed','final','expired')),created timestamptz default now(),manifest jsonb not null,unique(uid,key));
create table math_private.subs(id uuid primary key references math_private.slots,uid uuid not null references auth.users,q uuid not null references math_private.questions,attempt int not null,parent uuid references math_private.subs,received timestamptz not null default now(),unique(uid,q,attempt));
create table math_private.jobs(id uuid primary key default gen_random_uuid(),sub uuid not null references math_private.subs,version int not null, status text not null default 'queued',tries int default 0,next_at timestamptz default now(),lease timestamptz,token uuid,msg bigint,error text,unique(sub,version));
create index on math_private.jobs(status,next_at);
create table math_private.runs(job uuid primary key references math_private.jobs,data jsonb not null,created timestamptz default now());
create table math_private.reviews(id uuid primary key default gen_random_uuid(),sub uuid not null references math_private.subs,version int not null,author uuid not null references auth.users,created timestamptz default now(),body jsonb not null,unique(sub,version));
create table math_private.releases(id bigint generated always as identity primary key,sub uuid not null references math_private.subs,review uuid not null references math_private.reviews,kind text not null check(kind in ('feedback','score','answer')),body jsonb not null,created timestamptz default now(),author uuid not null references auth.users);
create table math_private.events(id bigint generated always as identity primary key,uid uuid references auth.users,q uuid references math_private.questions,kind text not null,body text not null,created timestamptz default now());
create index on math_private.events(uid,q,kind);
create table public.math_updates(uid uuid primary key references auth.users,updated timestamptz not null default now());
alter table public.math_updates enable row level security;
revoke all on public.math_updates from public,anon,authenticated;
grant select on public.math_updates to authenticated;
create policy math_updates_own on public.math_updates for select to authenticated using(uid=(select auth.uid()));
alter publication supabase_realtime add table public.math_updates;
create function math_private.touch(u uuid) returns void language sql set search_path='' as $$
 insert into public.math_updates(uid) values(u) on conflict(uid) do update set updated=clock_timestamp();
$$;
create function math_private.teacher(c uuid,u uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select from math_private.members where class_id=c and uid=u and role='teacher')
$$;
create function math_private.assigned(t uuid,u uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select from math_private.recipients r join math_private.tasks a on a.id=r.task join math_private.members m on m.class_id=a.class_id and m.uid=r.uid where r.task=t and r.uid=u and m.role='student')
$$;
create function math_private.can_submit(qid uuid,u uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select from math_private.questions q join math_private.tasks a on a.id=q.task join math_private.recipients r on r.task=a.id and r.uid=u where q.id=qid and math_private.assigned(a.id,u) and a.starts<=now() and (a.ends>=now() or a.late or r.late) and (select count(*) from math_private.subs s where s.uid=u and s.q=qid)<a.attempts+r.extra and not exists(select from math_private.questions newer where newer.task=q.task and newer.position=q.position and newer.version>q.version))
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('math-originals','math-originals',false,5242880,array['application/json','image/png','image/jpeg']);
create function public.math_asset_ok(path text,writing boolean) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select from math_private.accounts where uid=auth.uid() and force_change) and exists(select from math_private.slots s join math_private.questions q on q.id=s.q join math_private.tasks a on a.id=q.task where split_part(path,'/',1)=s.id::text and path=s.id::text||'/'||split_part(path,'/',2) and exists(select from jsonb_array_elements(s.manifest->'files') f where f->>'name'=split_part(path,'/',2)) and case when writing then s.uid=auth.uid() and s.state='open' and math_private.can_submit(s.q,s.uid) else (s.uid=auth.uid() and math_private.assigned(a.id,s.uid)) or (s.state='final' and a.owner_id=auth.uid() and math_private.teacher(a.class_id,auth.uid())) end)
$$;
revoke all on function public.math_asset_ok(text,boolean) from public,anon;
grant execute on function public.math_asset_ok(text,boolean) to authenticated;
create policy math_original_insert on storage.objects for insert to authenticated with check(bucket_id='math-originals' and public.math_asset_ok(name,true));
create policy math_original_read on storage.objects for select to authenticated using(bucket_id='math-originals' and public.math_asset_ok(name,false));

-- Internal command dispatcher. The Edge gateway supplies the verified Auth UUID.
create function public.math_command(u uuid,op text,p jsonb) returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare t tasks; qu questions; s subs; slot slots; rv reviews; j jobs; d drafts; k jsonb; v jsonb; item jsonb; c uuid; n int; h int; ident uuid; result jsonb; permitted boolean; role_teacher boolean;
begin
 if u is null or exists(select from accounts where uid=u and force_change) then raise exception 'password change required'; end if;
 if op='home' then
 return jsonb_build_object('classes',coalesce((select jsonb_agg(to_jsonb(cl)||jsonb_build_object('role',m.role,'label',m.label)) from members m join classes cl on cl.id=m.class_id where m.uid=u),'[]'),
 'tasks',coalesce((select jsonb_agg(to_jsonb(a) order by a.starts desc) from tasks a where (teacher(a.class_id,u) and a.owner_id=u) or assigned(a.id,u)),'[]'));
 end if;
 if op in ('roster','create') then
 c:=(p->>'class_id')::uuid;
 if not teacher(c,u) then raise exception 'denied'; end if;
 if op='roster' then return coalesce((select jsonb_agg(to_jsonb(m) order by number) from members m where class_id=c and role='student'),'[]'); end if;
 insert into tasks(owner_id,class_id,kind,title,subject,unit,instructions,starts,ends,attempts,late,hints) values(u,c,p->>'kind',p->>'title',p->>'subject',p->>'unit',p->>'instructions',(p->>'starts')::timestamptz,(p->>'ends')::timestamptz,(p->>'attempts')::int,(p->>'late')::boolean,(p->>'hints')::boolean) returning * into t;
 if jsonb_array_length(p->'questions') not between 1 and (case when t.kind='간단퀴즈' then 10 else 30 end) then raise exception 'question count'; end if;
 insert into recipients(task,uid) select t.id,m.uid from members m where m.class_id=c and m.role='student' and (p->'targets' is null or (p->'targets') ? m.uid::text);
 n:=0;
 for item in select value from jsonb_array_elements(p->'questions') loop
 n:=n+1;
 insert into questions(task,position,body) values(t.id,n,item->'public') returning * into qu;
 insert into keys values(qu.id,item->'private');
 end loop;
 return to_jsonb(t.id);
 end if;
 if op in ('summary','insights','bulkPreview','bulkRelease','detail','report','late') then select * into strict t from tasks where id=(p->>'task')::uuid;
 elsif op in ('prepare','draft','save','hint','help','reflect','revise','history') then
 select * into strict qu from questions where id=(p->>'q')::uuid;
 select * into strict t from tasks where id=qu.task;
 else
 select * into strict slot from slots where id=(p->>'sub')::uuid;
 select * into strict qu from questions where id=slot.q;
 select * into strict t from tasks where id=qu.task;
 select * into s from subs where id=slot.id;
 end if;
 role_teacher:=teacher(t.class_id,u) and t.owner_id=u; permitted:=assigned(t.id,u);
 if not role_teacher and not permitted then raise exception 'denied'; end if;
 if op in ('bulkPreview','bulkRelease') and role_teacher then
 select coalesce(jsonb_agg(jsonb_build_object('sub',ss.id,'review',rr.id,'label',m.label,'position',qq.position,'attempt',ss.attempt,'feedback',rr.body->'feedback')),'[]') into result
 from subs ss join questions qq on qq.id=ss.q join members m on m.uid=ss.uid and m.class_id=t.class_id
 join lateral (select * from reviews where sub=ss.id order by version desc limit 1) rr on true
 join lateral (select * from jobs where sub=ss.id order by version desc limit 1) jj on jj.status='completed'
 join runs ar on ar.job=jj.id
 where qq.task=t.id and ar.data->'output'->'review'->>'required'='false'
 and not exists(select from jsonb_array_elements(ar.data->'output'->'transcription') e where e->>'legibility'<>'clear')
 and not exists(select from jsonb_array_elements(ar.data->'output'->'rubric_results') r where r->>'proposed_score' is null or (r->>'review_required')::boolean or jsonb_array_length(r->'evidence_refs')=0)
 and not exists(select from releases where review=rr.id and kind='feedback');
 if op='bulkPreview' then return result;end if;
 for item in select value from jsonb_array_elements(p->'items') loop
 if not exists(select from jsonb_array_elements(result) x where x->>'sub'=item->>'sub' and x->>'review'=item->>'review') then raise exception 'stale preview';end if;
 perform public.math_command(u,'release',item||jsonb_build_object('kinds',jsonb_build_array('feedback')));
 end loop;return 'true';end if;
 if op='insights' and role_teacher then
 return jsonb_build_object('suggested',coalesce((select jsonb_agg(to_jsonb(g)) from
 (select step->>'misconception_code' label,count(distinct ss.uid) as count from runs ar join jobs jj on jj.id=ar.job join subs ss on ss.id=jj.sub join questions qq on qq.id=ss.q cross join lateral jsonb_array_elements(ar.data->'output'->'steps') step where qq.task=t.id and step->>'misconception_code' is not null group by 1) g),'[]'),
 'confirmed',coalesce((select jsonb_agg(to_jsonb(g)) from (select rr.body->>'misconception' label,count(distinct ss.uid) as count from reviews rr join subs ss on ss.id=rr.sub join questions qq on qq.id=ss.q where qq.task=t.id and coalesce(rr.body->>'misconception','')<>'' and not exists(select from reviews later where later.sub=rr.sub and later.version>rr.version) group by 1) g),'[]'));end if;
 if op='summary' then
 return jsonb_build_object('questions',coalesce((select jsonb_agg(jsonb_build_object('position',position,'body',jsonb_build_object('required',body->'required'))) from questions where task=t.id),'[]'),
 'subs',coalesce((select jsonb_agg(jsonb_build_object('uid',ss.uid,'position',qq.position,'released',exists(select from releases rr where rr.sub=ss.id and rr.kind='feedback'))) from subs ss join questions qq on qq.id=ss.q where qq.task=t.id and (role_teacher or ss.uid=u)),'[]'));end if;
 if op='report' then
 return coalesce((select jsonb_agg(jsonb_build_object('uid',m.uid,'number',m.number,'label',m.label,'position',qq.position,'attempt',ss.attempt,'sub',ss.id,'release',to_jsonb(rr)-'author') order by rr.id desc) from releases rr join subs ss on ss.id=rr.sub join questions qq on qq.id=ss.q join members m on m.class_id=t.class_id and m.uid=ss.uid where qq.task=t.id and (role_teacher or ss.uid=u)),'[]');
 end if;
 if op='detail' then
 return jsonb_build_object('questions',coalesce((select jsonb_agg(to_jsonb(x) order by position) from (select distinct on(position) * from questions where task=t.id and (role_teacher or now()>=t.starts) order by position,version desc) x),'[]'),
 'members',coalesce((select jsonb_agg(jsonb_build_object('uid',m.uid,'label',m.label,'number',m.number,'extra',r.extra)) from members m join recipients r on r.uid=m.uid and r.task=t.id where m.class_id=t.class_id and (role_teacher or m.uid=u)),'[]'),
 'subs',coalesce((select jsonb_agg(to_jsonb(ss)||jsonb_build_object('position',qq.position,'version',qq.version,'job',(select status from jobs where sub=ss.id order by version desc limit 1),'reviewed',exists(select from reviews where sub=ss.id),'released',exists(select from releases where sub=ss.id)) order by ss.received desc) from subs ss join questions qq on qq.id=ss.q where qq.task=t.id and (role_teacher or ss.uid=u)),'[]'),
 'events',coalesce((select jsonb_agg(to_jsonb(e)) from events e join questions qq on qq.id=e.q where qq.task=t.id and (role_teacher or e.uid=u)),'[]'));
 end if;
 if op='late' and role_teacher then update recipients set late=true where task=t.id and uid=(p->>'uid')::uuid; return 'true'; end if;
 if op='revise' and role_teacher then
 perform pg_advisory_xact_lock(hashtext(t.id::text)); insert into questions(task,position,version,body) select t.id,qu.position,max(version)+1,p->'public' from questions where task=t.id and position=qu.position returning id into ident;
 insert into keys values(ident,p->'private');return to_jsonb(ident);end if;
 if op in ('draft','save','hint','help','reflect','prepare','history') and (not permitted or now()<t.starts) then raise exception 'denied';end if;
 if op='history' then return coalesce((select jsonb_agg(to_jsonb(rr)-'author' order by rr.id desc) from releases rr join subs ss on ss.id=rr.sub join questions qq on qq.id=ss.q where ss.uid=u and qq.task=t.id and qq.position=qu.position),'[]');end if;
 if op='draft' then select * into d from drafts where uid=u and q=qu.id;if not found then return 'null';end if;return to_jsonb(d);end if;
 if op='save' then
 perform pg_advisory_xact_lock(hashtext(u::text||qu.id::text));select * into d from drafts where uid=u and q=qu.id;
 if coalesce(d.revision,0)<>(p->>'revision')::int then return jsonb_build_object('conflict',to_jsonb(d));end if;
 insert into drafts values(u,qu.id,coalesce(d.revision,0)+1,p->'body') on conflict(uid,q) do update set revision=excluded.revision,body=excluded.body returning * into d;return to_jsonb(d.revision);
 end if;
 if op='hint' then
 if not t.hints or not can_submit(qu.id,u) then raise exception 'hint unavailable';end if;
 perform pg_advisory_xact_lock(hashtext(u::text||qu.id::text));
 select count(*) into n from events where uid=u and q=qu.id and kind='hint';
 select body->'hints'->n into v from keys where q=qu.id;
 if v is null then raise exception 'no more hints'; end if;
 insert into events(uid,q,kind,body) values(u,qu.id,'hint',v->>'id');return coalesce(v->'nodes',v->'text');end if;
 if op in ('help','reflect') then
 if op='reflect' and not exists(select from releases r join subs ss on ss.id=r.sub where ss.q=qu.id and ss.uid=u and r.kind='feedback' and ss.id=(p->>'sub')::uuid) then raise exception 'denied'; end if;
 insert into events(uid,q,kind,body) values(u,qu.id,op,left(p->>'text',2000));return 'true';end if;
 if op='prepare' then
 perform pg_advisory_xact_lock(hashtext(u::text||qu.id::text));
 select * into slot from slots where uid=u and key=(p->>'key')::uuid;
 if found then if slot.q<>qu.id or slot.manifest<>p->'manifest' or slot.state='expired' then raise exception 'invalid retry';end if;return to_jsonb(slot);end if;
 if not can_submit(qu.id,u) then raise exception 'closed';end if;
 insert into slots(uid,q,key,manifest) values(u,qu.id,(p->>'key')::uuid,p->'manifest') returning * into slot;return to_jsonb(slot);end if;
 if op in ('seal','commit') and slot.uid=u then
 perform pg_advisory_xact_lock(hashtext(u::text||qu.id::text)); select * into strict slot from slots where id=slot.id for update;
 if slot.state='final' then return jsonb_build_object('id',slot.id,'state','final');end if;
 if slot.state='expired' or not can_submit(qu.id,u) then raise exception 'closed';end if;
 if op='seal' then update slots set state='sealed' where id=slot.id;return to_jsonb(slot);end if;
 if slot.state<>'sealed' then raise exception 'unsealed';end if;
 select count(*)+1 into n from subs where uid=u and q=qu.id;
 insert into subs(id,uid,q,attempt,parent) values(slot.id,u,qu.id,n,(select id from subs where uid=u and q=qu.id order by attempt desc limit 1));
 update slots set state='final' where id=slot.id;
 elsif op='inspect' and s.id is not null and (role_teacher or s.uid=u) then
 return jsonb_build_object('submission',to_jsonb(s),'manifest',slot.manifest,'question',qu.body,'key',case when role_teacher then (select body from keys where q=qu.id) end,'runs',case when role_teacher then (select jsonb_agg(to_jsonb(r) order by r.created desc) from runs r join jobs jj on jj.id=r.job where jj.sub=s.id) end,'reviews',case when role_teacher then (select jsonb_agg(to_jsonb(r) order by version desc) from reviews r where sub=s.id) end);
 elsif op='reanalyze' and role_teacher and s.id is not null then perform pg_advisory_xact_lock(hashtext(s.id::text));
 elsif op='review' and role_teacher and s.id is not null then
 perform pg_advisory_xact_lock(hashtext(s.id::text));
 select body into k from keys where q=qu.id;
 if jsonb_typeof(p->'scores') is distinct from 'object' or (select count(*) from jsonb_object_keys(p->'scores'))<>jsonb_array_length(k->'criteria') or exists(select from jsonb_array_elements(k->'criteria') a where jsonb_typeof(p->'scores'->(a->>'id')) is distinct from 'number' or (p->'scores'->>(a->>'id'))::numeric not between 0 and (a->>'max')::numeric) then raise exception 'invalid scores';end if;
 insert into reviews(sub,version,author,body) select s.id,coalesce(max(version),0)+1,u,p-'sub' from reviews where sub=s.id returning * into rv;return to_jsonb(rv);
 elsif op='release' and role_teacher and s.id is not null then
 select * into strict rv from reviews where id=(p->>'review')::uuid and sub=s.id;
 for v in select value from jsonb_array_elements(p->'kinds') loop
 case v#>>'{}' when 'feedback' then result:=rv.body->'feedback';when 'score' then select to_jsonb(sum(value::numeric)) into result from jsonb_each_text(rv.body->'scores');when 'answer' then select body->'answer' into result from keys where q=qu.id;else raise exception 'invalid release';end case;
 insert into releases(sub,review,kind,body,author) values(s.id,rv.id,v#>>'{}',result,u);
 end loop;perform touch(s.uid);return 'true';
 else raise exception 'denied';end if;
 insert into jobs(sub,version) select slot.id,coalesce(max(version),0)+1 from jobs where sub=slot.id returning * into j;
 update jobs set msg=pgmq.send('math_analysis',jsonb_build_object('job',j.id)) where id=j.id;perform touch(slot.uid);perform touch(t.owner_id);
 return jsonb_build_object('id',slot.id,'state','final');
end $$;
revoke all on function public.math_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.math_command(uuid,text,jsonb) to service_role;
