create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('goodmath-worker','* * * * *',$job$
 select net.http_post(url:=(select decrypted_secret from vault.decrypted_secrets where name='math_worker_url'),headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='math_worker_secret')),body:='{}'::jsonb,timeout_milliseconds:=100000) from generate_series(1,(select concurrency from math_private.settings));
$job$);
