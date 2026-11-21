-- Match drafts to the saved problem input, not to edits of the teacher's answer.
do $$
declare
  definition text := pg_get_functiondef('public.math_library(uuid,text,jsonb)'::regprocedure);
  old_fragment constant text := '''data'',rr.data->''output'')';
  new_fragment constant text := $fragment$'data',rr.data->'output','matches_working',ed.body=jsonb_build_object('question',b.working->'questions'->(ed.question_no-1)->'public','subject',b.working->'subject','unit',b.working->'unit','difficulty',b.working->'difficulty','points',b.working->'questions'->(ed.question_no-1)->'points'))$fragment$;
begin
  if strpos(definition, old_fragment) > 0 then
    execute replace(definition, old_fragment, new_fragment);
  elsif strpos(definition, new_fragment) = 0 then
    raise exception 'Generated draft response not found';
  end if;
end $$;
