create table math_private.settings(id boolean primary key default true check(id),concurrency int not null check(concurrency between 1 and 20),max_tries int not null,slot_retention interval not null);
insert into math_private.settings values(true,3,4,interval '1 day');
create function public.math_worker(op text,p jsonb) returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare j jobs;m record;cfg settings;token_id uuid;payload jsonb;
begin
 select * into strict cfg from settings;
 if op='claim' then
 perform pg_advisory_xact_lock(hashtext('math queue claim'));
 if (select count(*) from jobs where status='processing' and lease>now())>=cfg.concurrency then return 'null';end if;
 select * into m from pgmq.read('math_analysis',120,1);if not found then return 'null';end if;
 select * into strict j from jobs where id=(m.message->>'job')::uuid for update;
 if j.status in ('completed','failed') then perform pgmq.archive('math_analysis',m.msg_id);return 'null';end if;
 if j.next_at>now() or j.lease>now() then return 'null';end if;
 if j.tries>=cfg.max_tries then update jobs set status='failed',error='retry_limit',lease=null where id=j.id;perform pgmq.archive('math_analysis',m.msg_id);return 'null';end if;
 update jobs set token=gen_random_uuid(),lease=now()+interval '120 seconds',status='processing',tries=tries+1 where id=j.id returning * into j;
 if j.edition is not null then select body into payload from editions where id=j.edition;
 else select jsonb_build_object('question',q.body,'rubric',k.body,'manifest',sl.manifest,'version',q.version) into payload from subs s join questions q on q.id=s.q join keys k on k.q=q.id join slots sl on sl.id=s.id where s.id=j.sub;end if;
 return to_jsonb(j)||jsonb_build_object('payload',payload);
 end if;
 select * into strict j from jobs where id=(p->>'id')::uuid and token=(p->>'token')::uuid and status='processing' and lease>now() for update;
 if op='finish' then insert into runs values(j.id,p->'data',now());update jobs set status='completed',lease=null where id=j.id;
 elsif op='fail' then update jobs set status=case when tries>=cfg.max_tries then 'failed' else 'retry_wait' end,lease=null,next_at=now()+make_interval(secs=>power(2,tries)::int*15),error=left(p->>'error',80) where id=j.id;
 else raise exception 'unknown';end if;
 if op='finish' or j.tries>=cfg.max_tries then perform pgmq.archive('math_analysis',j.msg);end if;
 if j.sub is not null then perform touch((select uid from subs where id=j.sub));perform touch((select a.owner_id from subs ss join questions qq on qq.id=ss.q join tasks a on a.id=qq.task where ss.id=j.sub));else perform touch((select b.owner_id from editions ed join books b on b.id=ed.book where ed.id=j.edition));end if;return 'true';
end $$;
revoke all on function public.math_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.math_worker(text,jsonb) to service_role;
