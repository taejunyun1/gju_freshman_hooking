begin;

select plan(4);

select has_table('public'::name, 'prospects'::name);
select has_table('public'::name, 'student_sessions'::name);
select policies_are('public', 'prospects', array[]::text[], 'anon has no prospect policy');
select policies_are('public', 'student_sessions', array[]::text[], 'anon has no session policy');

select * from finish();

rollback;
