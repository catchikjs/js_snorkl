-- Notify assigned students when a distribution or roster refresh adds a task.
-- Existing recipients and the immutable distributed questions stay unchanged.
create or replace function math_private.notify_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform math_private.touch(new.uid);
  return new;
end $$;
revoke all on function math_private.notify_assignment() from public,anon,authenticated;

create or replace trigger math_assignment_update
after insert on math_private.recipients
for each row execute function math_private.notify_assignment();

-- Repeating an explicit class distribution also includes students registered
-- since the first distribution, while reusing the same task and link.
do $$
declare
  definition text := pg_get_functiondef('public.math_library(uuid,text,jsonb)'::regprocedure);
  old_fragment constant text := 'end if;return to_jsonb(l);end if;';
  new_fragment constant text := $fragment$end if;
 insert into recipients(task,uid)
 select l.task,uid from members where class_id=c and role='student'
 on conflict do nothing;
 return to_jsonb(l);end if;$fragment$;
begin
  if strpos(definition, old_fragment) > 0 then
    execute replace(definition, old_fragment, new_fragment);
  elsif strpos(definition, new_fragment) = 0 then
    raise exception 'Distribution response not found';
  end if;
end $$;
