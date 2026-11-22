-- Resolve a student only after checking the authenticated teacher's class scope.
-- Passwords never pass through this RPC or the roster tables.
create or replace function public.math_password_reset_target(u uuid,p jsonb)
returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare cl classes; a accounts; m members;
begin
 select * into cl from classes where id=(p->>'class_id')::uuid;
 if not found or u is null or not teacher(cl.id,u)
   or exists(select from accounts where uid=u and force_change) then
   raise exception 'reset_denied';
 end if;
 select * into a from accounts where uid=(p->>'uid')::uuid
   and class_id=cl.id and school=cl.school and year=cl.year;
 if not found or a.uid=u
   or exists(select from members where uid=a.uid and role='teacher') then
   raise exception 'reset_denied';
 end if;
 select * into m from members where uid=a.uid and class_id=cl.id
   and role='student' and number=a.number;
 if not found or not roster_number_ok(cl.id,m.number) then
   raise exception 'reset_denied';
 end if;
 if a.force_change then raise exception 'reset_activation_required'; end if;
 return jsonb_build_object('uid',a.uid,'alias',a.alias,'school',cl.school,'year',cl.year);
end $$;
revoke all on function public.math_password_reset_target(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.math_password_reset_target(uuid,jsonb) to service_role;
