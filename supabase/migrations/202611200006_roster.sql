create function public.math_provision(p jsonb) returns void language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare cl classes;u uuid:=(p->>'uid')::uuid;
begin
 select * into strict cl from classes where id=(p->>'class_id')::uuid;
 if not exists(select from auth.users where id=u and email=p->>'alias') then raise exception 'Auth identity mismatch';end if;
 insert into members(class_id,uid,role,label,number) values(cl.id,u,'student',p->>'label',p->>'number') on conflict(class_id,uid) do nothing;
 if not exists(select from members where class_id=cl.id and uid=u and number=p->>'number' and role='student') then raise exception 'roster mismatch';end if;
 insert into accounts(uid,school,year,number,alias,class_id,code_hash,expires) values(u,cl.school,cl.year,p->>'number',p->>'alias',cl.id,p->>'hash',now()+interval '24 hours')
 on conflict(uid) do update set code_hash=excluded.code_hash,expires=excluded.expires,force_change=true,lease_until=null,activation_ticket=null;
end $$;
revoke all on function public.math_provision(jsonb) from public,anon,authenticated;
grant execute on function public.math_provision(jsonb) to service_role;
