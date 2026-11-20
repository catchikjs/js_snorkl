-- Fence stale slots before Storage API deletion. Interrupted deletes can be retried.
create function public.math_gc(done uuid default null) returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare s slots;
begin
 if done is not null then delete from slots where id=done and state='expired' and not exists(select from subs where id=done);return 'true';end if;
 select * into s from slots where state<>'final' and created<now()-(select slot_retention from settings) and not exists(select from subs where id=slots.id) order by created for update skip locked limit 1;
 if not found then return 'null';end if;
 update slots set state='expired' where id=s.id;return jsonb_build_object('id',s.id,'files',s.manifest->'files');
end $$;
revoke all on function public.math_gc(uuid) from public,anon,authenticated;
grant execute on function public.math_gc(uuid) to service_role;
