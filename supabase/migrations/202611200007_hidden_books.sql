create table math_private.hidden_books(
  book uuid primary key references math_private.books,
  owner_id uuid not null references auth.users,
  hidden_at timestamptz not null default now()
);

create function public.math_hidden_books(u uuid, op text, p jsonb)
returns jsonb language plpgsql security definer
set search_path=math_private,pg_catalog as $$
declare b books;
begin
  if op='list' then
    return coalesce(
      (select jsonb_agg(book) from hidden_books where owner_id=u),
      '[]'::jsonb
    );
  end if;
  if op='hide' then
    select * into strict b
      from books
      where id=(p->>'book')::uuid
        and owner_id=u
        and teacher(class_id,u)
      for update;
    insert into hidden_books(book,owner_id)
      values(b.id,u)
      on conflict(book) do update set owner_id=excluded.owner_id;
    return 'true'::jsonb;
  end if;
  raise exception 'unknown';
end $$;

revoke all on function public.math_hidden_books(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.math_hidden_books(uuid,text,jsonb)
  to service_role;
