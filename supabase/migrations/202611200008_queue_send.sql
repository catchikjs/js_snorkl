-- Current pgmq.send returns SETOF bigint. A scalar subquery supports both
-- that signature and older scalar-returning versions in UPDATE assignments.
do $$
declare
  signature regprocedure;
  definition text;
  old_assignment constant text := 'msg=pgmq.send(''math_analysis'',jsonb_build_object(''job'',j.id))';
  new_assignment constant text := 'msg=(select pgmq.send(''math_analysis'',jsonb_build_object(''job'',j.id)))';
begin
  foreach signature in array array[
    'public.math_library(uuid,text,jsonb)'::regprocedure,
    'public.math_command(uuid,text,jsonb)'::regprocedure
  ] loop
    definition := pg_get_functiondef(signature);
    if strpos(definition, old_assignment) > 0 then
      execute replace(definition, old_assignment, new_assignment);
    elsif strpos(definition, new_assignment) = 0 then
      raise exception 'Queue assignment not found in %', signature;
    end if;
  end loop;
end $$;
