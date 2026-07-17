-- Kept outside an explicit transaction: dblink sessions must observe the fixture.
select plan(7);
create extension if not exists dblink with schema extensions;

delete from public.prospects where admission_cycle_id='a5000000-0000-4000-8000-000000000010';
delete from public.admission_cycles where id='a5000000-0000-4000-8000-000000000010';
insert into auth.users(id) values ('a5000000-0000-4000-8000-000000000001') on conflict do nothing;
insert into public.admin_users(id,is_active) values ('a5000000-0000-4000-8000-000000000001',true) on conflict (id) do update set is_active=true;
select public.start_admission_cycle_v1('a5000000-0000-4000-8000-000000000010',2031,1,'a5000000-0000-4000-8000-000000000001',
 (select jsonb_agg(jsonb_build_object('nameHmac',lpad(to_hex(n+100),64,'0'),'nameCiphertext',repeat('11',16),'nameIv',repeat('12',12),'phoneHmac',lpad(to_hex(n+110),64,'0'),'phoneCiphertext',repeat('13',16),'phoneIv',repeat('14',12),'schoolName','경합고','applicantStage','high3','passwordDigest',lpad(to_hex(n+120),64,'0'),'passwordGeneration',1)) from generate_series(1,5) n));

select is(extensions.dblink_connect('roster_replay_a','host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'),'OK','first replay connection opens');
select is(extensions.dblink_connect('roster_replay_b','host=supabase_db_photo-next-mvp port=5432 dbname=postgres user=postgres password=postgres'),'OK','second replay connection opens');
select extensions.dblink_exec('roster_replay_a','set role service_role');
select extensions.dblink_exec('roster_replay_b','set role service_role');
create temporary table replay_query as select $$select public.apply_applicant_roster_v1('a5000000-0000-4000-8000-000000000010',0,'a5000000-0000-4000-8000-000000000001',decode(repeat('71',32),'hex'),'a5000000-0000-4000-8000-000000000020',jsonb_build_array(jsonb_build_object('nameHmac',repeat('72',32),'nameCiphertext',repeat('73',16),'nameIv',repeat('74',12),'phoneHmac',repeat('75',32),'phoneCiphertext',repeat('76',16),'phoneIv',repeat('77',12),'schoolName','경합고','applicantStage','high3','passwordDigest',repeat('78',32),'passwordGeneration',1)))$$ query;
select is(extensions.dblink_send_query('roster_replay_a',(select query from replay_query)),1,'first same-key apply is dispatched');
select is(extensions.dblink_send_query('roster_replay_b',(select query from replay_query)),1,'second same-key apply is dispatched concurrently');
create temporary table replay_results(result jsonb);
insert into replay_results select result from extensions.dblink_get_result('roster_replay_a') response(result jsonb);
insert into replay_results select result from extensions.dblink_get_result('roster_replay_b') response(result jsonb);
select is((select count(distinct result) from replay_results),1::bigint,'concurrent replay calls return exactly the same payload');
select is((select roster_version from public.admission_cycles where id='a5000000-0000-4000-8000-000000000010'),1,'concurrent replay mutates the roster exactly once');
select is((select count(*) from public.prospects where admission_cycle_id='a5000000-0000-4000-8000-000000000010' and not is_test),1::bigint,'concurrent replay creates one applicant');
select extensions.dblink_disconnect('roster_replay_a');
select extensions.dblink_disconnect('roster_replay_b');
delete from public.prospects where admission_cycle_id='a5000000-0000-4000-8000-000000000010';
delete from public.admission_cycles where id='a5000000-0000-4000-8000-000000000010';
delete from public.audit_events where admin_user_id='a5000000-0000-4000-8000-000000000001';
delete from public.admin_users where id='a5000000-0000-4000-8000-000000000001';
delete from auth.users where id='a5000000-0000-4000-8000-000000000001';
