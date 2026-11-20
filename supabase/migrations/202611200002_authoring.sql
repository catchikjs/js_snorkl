create table math_private.books(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users, class_id uuid not null references math_private.classes,origin uuid references math_private.books, title text not null, working jsonb not null,revision int default 1 not null,approved int);
create table math_private.approvals(book uuid references math_private.books,revision int not null,body jsonb not null,author uuid not null references auth.users,approved_at timestamptz not null default now(),primary key(book,revision));
create table math_private.editions(id uuid primary key default gen_random_uuid(),book uuid references math_private.books,revision int not null,question_no int not null,body jsonb not null,unique(book,revision,question_no));
alter table math_private.jobs alter column sub drop not null, add column edition uuid references math_private.editions,add check(num_nonnulls(sub,edition)=1),add unique(edition,version);
create table math_private.links(task uuid primary key references math_private.tasks,book uuid references math_private.books,revision int not null,class_id uuid references math_private.classes,token uuid not null unique default gen_random_uuid(),active boolean default true,unique(book,revision,class_id));
create table math_private.changes(id bigint generated always as identity primary key, task uuid references math_private.tasks,actor uuid references auth.users,detail jsonb not null,created timestamptz default now());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('math-sources','math-sources',false,20971520,array['application/pdf','image/png','image/jpeg']);
create function public.math_source_ok(path text) returns boolean language sql stable security definer set search_path='' as $$
select exists(select from math_private.books b where b.id::text=split_part(path,'/',1) and b.owner_id=auth.uid() and math_private.teacher(b.class_id,auth.uid()))
$$;
revoke all on function public.math_source_ok(text) from public,anon;
grant execute on function public.math_source_ok(text) to authenticated;
create policy math_source_add on storage.objects for insert to authenticated with check(bucket_id='math-sources' and public.math_source_ok(name));
create policy math_source_view on storage.objects for select to authenticated using(bucket_id='math-sources' and public.math_source_ok(name));

create function public.math_library(u uuid,op text,p jsonb) returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare b books;l links;t tasks;e editions;j jobs;entry jsonb;tid uuid;c uuid;n int:=0; newbook uuid;
begin
 if exists(select from accounts where uid=u and force_change) then raise exception 'denied';end if;
 if op='resolve' then select * into strict l from links where token=(p->>'token')::uuid and active;
 if not assigned(l.task,u) and not exists(select from tasks a where a.id=l.task and a.owner_id=u and teacher(a.class_id,u)) then raise exception 'denied';end if;return to_jsonb(l.task);end if;
 if op='library' then return coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'approved',approved,'revision',revision,'class_id',class_id) order by title) from books where owner_id=u and teacher(class_id,u)),'[]');end if;
 if op='new' then c:=(p->>'class_id')::uuid;if not teacher(c,u) then raise exception 'denied';end if;
 insert into books(owner_id,class_id,title,working) values(u,c,p->>'title',p->'working') returning id into newbook;return to_jsonb(newbook);end if;
 select * into strict b from books where id=(p->>'book')::uuid and owner_id=u and teacher(class_id,u) for update;
 if op='book' then return to_jsonb(b)||jsonb_build_object('links',coalesce((select jsonb_agg(to_jsonb(ln)||jsonb_build_object('people',(select count(*) from recipients where task=ln.task),'starts',(select starts from tasks where id=ln.task),'ends',(select ends from tasks where id=ln.task))) from links ln where ln.book=b.id and teacher(ln.class_id,u)),'[]'),'generated',coalesce((select jsonb_agg(jsonb_build_object('revision',ed.revision,'position',ed.question_no,'status',jj.status,'data',rr.data->'output') order by ed.revision desc,jj.version desc) from editions ed join jobs jj on jj.edition=ed.id left join runs rr on rr.job=jj.id where ed.book=b.id),'[]'));end if;
 if op='copy' then c:=(p->>'class_id')::uuid;if not teacher(c,u) then raise exception 'denied';end if;
 insert into books(owner_id,class_id,title,origin,working) values(u,c,p->>'title',b.id,b.working||jsonb_build_object('title',p->>'title','starts','','ends','')) returning id into newbook;return to_jsonb(newbook);end if;
 if op in ('saveBook','generate','approve') then
 if b.revision<>(p->>'revision')::int then raise exception 'revision conflict';end if;
 if b.working is distinct from p->'working' then update books set working=p->'working', title=p->'working'->>'title',revision=revision+1,approved=null where id=b.id returning * into b;end if;
 if op='approve' then insert into approvals(book,revision,body,author) values(b.id,b.revision,b.working,u) on conflict do nothing;update books set approved=b.revision where id=b.id;end if;
 if op='generate' then for entry in select value from jsonb_array_elements(b.working->'questions') loop n:=n+1;
 insert into editions(book,revision,question_no,body) values(b.id,b.revision,n,jsonb_build_object('question',entry->'public','subject',b.working->'subject','unit',b.working->'unit','difficulty',b.working->'difficulty','points',entry->'points')) on conflict(book,revision,question_no) do update set body=excluded.body returning * into e;
 insert into jobs(edition,version) select e.id,coalesce(max(version),0)+1 from jobs where edition=e.id returning * into j;
 update jobs set msg=pgmq.send('math_analysis',jsonb_build_object('job',j.id)) where id=j.id;end loop;end if;return to_jsonb(b.revision);end if;
 c:=(p->>'class_id')::uuid;if not teacher(c,u) then raise exception 'denied';end if;
 if op='distribute' then if b.approved is distinct from b.revision then raise exception 'approval required';end if;
 select * into l from links where book=b.id and revision=b.revision and class_id=c;
 if not found then tid:=(public.math_command(u,'create',b.working||jsonb_build_object('class_id',c))#>>'{}')::uuid;
 insert into links(task,book,revision,class_id) values(tid,b.id,b.revision,c) returning * into l;end if;return to_jsonb(l);end if;
 select * into strict l from links where book=b.id and class_id=c and task=(p->>'task')::uuid;
 case op when 'rotate' then update links set token=gen_random_uuid(),active=true where task=l.task;
 when 'toggle' then update links set active=not active where task=l.task;
 when 'refreshRoster' then insert into recipients(task,uid) select l.task,uid from members where class_id=c and role='student' on conflict do nothing;
 when 'limit' then update tasks set attempts=(p->>'attempts')::int where id=l.task;
 when 'extra' then update recipients set extra=extra+1 where task=l.task and uid=(p->>'uid')::uuid;
 else raise exception 'unknown';end case;
 insert into changes(task,actor,detail) values(l.task,u,p);return 'true';end $$;
revoke all on function public.math_library(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.math_library(uuid,text,jsonb) to service_role;
