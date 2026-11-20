alter table math_private.accounts add column activation_ticket uuid,add column lease_until timestamptz;
create function public.math_account(op text,p jsonb) returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare a accounts;n int;
begin
 if op='limit' then insert into throttle values(p->>'key',1,now()) on conflict(key) do update set hits=case when throttle.since<now()-interval '10 minutes' then 1 else throttle.hits+1 end,since=case when throttle.since<now()-interval '10 minutes' then now() else throttle.since end returning hits into n;return to_jsonb(n<=15);end if;
 select * into strict a from accounts where school=p->>'school' and year=(p->>'year')::int and number=p->>'number' for update;
 if op='activate' then if a.code_hash is null or a.code_hash<>p->>'hash' or a.expires<=now() or a.lease_until>now() then raise exception 'invalid';end if;
 update accounts set activation_ticket=gen_random_uuid(),lease_until=now()+interval '2 minutes' where uid=a.uid returning * into a;
 elsif op='activated' then update accounts set force_change=false,code_hash=null,activation_ticket=null,lease_until=null where uid=a.uid and activation_ticket=(p->>'ticket')::uuid and lease_until>now();if not found then raise exception 'invalid';end if;
 elsif op<>'login' or a.force_change then raise exception 'invalid';end if;
 return jsonb_build_object('uid',a.uid,'alias',a.alias,'ticket',a.activation_ticket);
end $$;
revoke all on function public.math_account(text,jsonb) from public,anon,authenticated;
grant execute on function public.math_account(text,jsonb) to service_role;
