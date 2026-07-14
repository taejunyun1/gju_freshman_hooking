begin;

select plan(4);

select has_table('public', 'prospects');
select has_table('public', 'student_sessions');
select policies_are('public', 'prospects', array[]::text[], 'anon has no prospect policy');
select policies_are('public', 'student_sessions', array[]::text[], 'anon has no session policy');

select * from finish();

rollback;
