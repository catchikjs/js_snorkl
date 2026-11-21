-- Read-only inventory for checking an existing Supabase project before setup.
select 'schema' as kind, nspname as name, null::text as details
from pg_namespace where nspname = 'math_private'
union all
select 'public_object', c.relname, c.relkind::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'math\_%' escape '\'
union all
select 'public_function', p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'math\_%' escape '\'
union all
select 'bucket', id, 'public=' || public::text
from storage.buckets where id in ('math-originals', 'math-sources')
union all
select 'storage_policy', policyname,
  'roles=' || roles::text || '; command=' || cmd || '; using=' || coalesce(qual, '') || '; check=' || coalesce(with_check, '')
from pg_policies where schemaname = 'storage' and tablename = 'objects'
union all
select 'queue_object', tablename, schemaname
from pg_tables where schemaname = 'pgmq' and tablename in ('q_math_analysis', 'a_math_analysis')
union all
select 'extension', name, 'installed=' || (installed_version is not null)::text || '; available=' || (default_version is not null)::text
from pg_available_extensions where name in ('pgmq', 'pg_cron', 'pg_net', 'supabase_vault')
order by kind, name;
