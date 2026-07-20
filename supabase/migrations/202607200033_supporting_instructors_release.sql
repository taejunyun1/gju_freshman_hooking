create function public.upsert_verified_2026_supporting_instructors()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_count integer;
  v_is_current boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('photo_next.supporting_instructors_2026.v1', 0)
  );

  select pg_catalog.count(*)::integer into v_existing_count from public.faculty;
  if v_existing_count = 0 then
    return '{"status":"skipped_empty"}'::jsonb;
  end if;

  if (select pg_catalog.count(*) from public.faculty
      where name = any (array[
        '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'
      ]::text[])) <> 6
    or exists (
      select 1 from public.faculty
      where name = any (array['조대연', '윤태준', '김사라']::text[])
        and (employment_type <> 'full_time' or consultation_role <> 'primary')
    )
    or exists (
      select 1 from public.faculty
      where name = any (array['박재웅', '정철호', '곽동욱']::text[])
        and (employment_type <> 'adjunct' or consultation_role <> 'specialist')
    )
    or exists (
      select name from public.faculty
      where name = any (array['정한결', '유별남', '김태현', '김명우']::text[])
      group by name having pg_catalog.count(*) > 1
    )
    or exists (
      select name from public.faculty
      where name = any (array[
        '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱'
      ]::text[])
      group by name having pg_catalog.count(*) > 1
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'SUPPORTING_INSTRUCTOR_BASE_INVALID';
  end if;

  lock table public.faculty, public.faculty_tags, public.faculty_specialist_links
    in share row exclusive mode;

  select
    (select pg_catalog.count(*) from public.faculty
      where name = any (array['정한결', '유별남', '김태현', '김명우']::text[])
        and status = 'active' and employment_type = 'practitioner'
        and consultation_role = 'specialist' and weekly_capacity = 0) = 4
    and (select pg_catalog.count(*)
      from public.faculty_tags tag
      join public.faculty faculty on faculty.id = tag.faculty_id
      where faculty.name = any (array['정한결', '유별남', '김태현', '김명우']::text[])) = 50
    and (select pg_catalog.count(*)
      from public.faculty_specialist_links link
      join public.faculty specialist on specialist.id = link.specialist_faculty_id
      where specialist.name = any (array['정한결', '유별남', '김태현', '김명우']::text[])) = 16
    and (select pg_catalog.count(*) from public.faculty
      where name = any (array['유별남', '김태현']::text[])
        and contact_visibility = '{"office":"hidden","phone":"hidden","email":"hidden","website":"public"}'::jsonb
        and website like 'https://%' and last_verified_at is not null) = 2
    and (select pg_catalog.count(*) from public.faculty
      where (name, priority) in (
        ('정한결', 60), ('유별남', 50), ('김태현', 40), ('김명우', 30)
      )) = 4
    and not exists (
      select 1
      from public.faculty_tags tag
      join public.faculty faculty on faculty.id = tag.faculty_id
      where faculty.name = any (array['정한결', '유별남', '김태현', '김명우']::text[])
      group by tag.faculty_id, tag.category
      having pg_catalog.count(*) filter (where tag.is_primary) > 1
    )
  into v_is_current;

  if v_is_current then
    return '{"status":"already_current"}'::jsonb;
  end if;

  update public.faculty faculty
  set title = seed.title,
      employment_type = seed.employment_type,
      consultation_role = seed.consultation_role,
      office = seed.office,
      phone = seed.phone,
      email = seed.email,
      website = seed.website,
      contact_visibility = seed.contact_visibility,
      expertise_summary = seed.expertise_summary,
      bio = seed.bio,
      profile_sections = seed.profile_sections,
      status = seed.status,
      weekly_capacity = seed.weekly_capacity,
      priority = seed.priority,
      source_date = seed.source_date,
      last_verified_at = seed.last_verified_at,
      updated_at = pg_catalog.clock_timestamp()
  from pg_catalog.jsonb_to_recordset($faculty$[{"name":"정한결","title":"시간강사","employment_type":"practitioner","consultation_role":"specialist","office":null,"phone":null,"email":null,"website":null,"contact_visibility":{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"},"expertise_summary":"예술사진·AI·기술적 이미지·미디어아트","bio":"사진 매체를 기반으로 사회적 언어, 이데올로기 구조와 주변부 존재의 서사를 탐구하는 시각예술가다. 기록에 퍼포먼스 등 실험적 방식을 결합해 광주에서 작업한다.","profile_sections":{"recommendationRole":"윤태준 교수 총괄 아래 예술사진·AI 기반 창작 연계","education":[],"careers":["2022 5·18기념문화센터 기획전 《길 위에서》 참여","2025 예술공간 집 기획전 《Technically Speaking》 참여","광주시립미술관 청년예술센터 입주작가","대안 문화예술단체 디디에프(DDF) 대표","충장로5가 ‘사색(四色)의 골목’ 문화예술공간 조성 프로젝트"],"teachingFields":["예술사진","사회적 언어와 이미지","AI·기술적 이미지","미디어아트","설치·퍼포먼스 기반 사진"],"studentProjects":["예술사진 연작","AI·기술 이미지 실험","사진·퍼포먼스 결합 프로젝트"],"careerPaths":[],"institutionProjects":[],"majorWorks":[]},"status":"active","weekly_capacity":0,"priority":0,"source_date":"2026-07-20","last_verified_at":null},{"name":"유별남","title":"시간강사","employment_type":"practitioner","consultation_role":"specialist","office":null,"phone":null,"email":null,"website":"https://www.yoobeylnam.com/","contact_visibility":{"office":"hidden","phone":"hidden","email":"hidden","website":"public"},"expertise_summary":"다큐멘터리 사진·포토스토리·사람과 자연의 기록","bio":"사진가로서 사람들이 찾지 않는 곳에서 만난 사람·자연·장소의 장면을 사진에 담고, 전시와 출판을 통해 사진의 이야기를 나눈다. 다큐멘터리 사진의 시선과 포토스토리 작업을 보완한다.","profile_sections":{"recommendationRole":"조대연·김사라 교수 총괄 아래 다큐멘터리 기록 연계","education":[],"careers":[],"teachingFields":["다큐멘터리 사진","포토스토리","장소와 사람의 기록","사진 프로젝트 편집"],"studentProjects":["사람과 장소를 기록하는 사진 연작","장기 포토스토리","사진집·전시 구성"],"careerPaths":[],"institutionProjects":[],"majorWorks":["빗개","AFTER NIGHTFALL","CITY","K2","NEVER STOP"]},"status":"active","weekly_capacity":0,"priority":0,"source_date":"2026-07-20","last_verified_at":"2026-07-20T00:00:00+09:00"},{"name":"김태현","title":"시간강사","employment_type":"practitioner","consultation_role":"specialist","office":null,"phone":null,"email":null,"website":"https://studio.underyourwater.com/","contact_visibility":{"office":"hidden","phone":"hidden","email":"hidden","website":"public"},"expertise_summary":"다큐멘터리·영상제작·예술사진","bio":"카메라를 성실한 재현을 돕는 조력자이자 이미지를 특정한 의미에 가두는 기계로 인식한다. 현실의 충실한 재현을 지향하며 다큐멘터리적 태도로 사진과 영상 작업을 한다. 서울에서 스튜디오 물밑을 운영한다.","profile_sections":{"recommendationRole":"전임교원 총괄 아래 다큐멘터리·영상 제작 연계","education":["2025 한국예술종합학교 영상원 방송영상과 다큐멘터리 전공 예술전문사 재학","2017 중앙대학교 공연예술창작학부 사진전공 학사","2017 중앙대학교 문화콘텐츠융합전공 학사"],"careers":["2020–2025 KBS 창원총국 촬영감독","스튜디오 물밑 운영"],"teachingFields":["다큐멘터리 사진","다큐멘터리 영상","촬영·편집","예술사진"],"studentProjects":["다큐멘터리 사진·영상 프로젝트","인터뷰 기반 영상","사진·영상 포트폴리오"],"careerPaths":[],"institutionProjects":[],"majorWorks":[]},"status":"active","weekly_capacity":0,"priority":0,"source_date":"2026-07-20","last_verified_at":"2026-07-20T00:00:00+09:00"},{"name":"김명우","title":"시간강사","employment_type":"practitioner","consultation_role":"specialist","office":null,"phone":null,"email":null,"website":null,"contact_visibility":{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"},"expertise_summary":"AI 영상·미디어아트·영상설치","bio":"판화·미디어·입체미술을 바탕으로 비디오아트 작업을 이어온 미디어아트 작가다. 급변하는 미디어 환경과 디지털 기기가 인간의 삶에 미치는 영향을 영상과 설치로 탐구하며, 디지털 추상 이미지와 현실의 경계를 다룬다.","profile_sections":{"recommendationRole":"윤태준 교수 총괄 아래 AI 영상·미디어아트 연계","education":["조선대학교·중앙대학교·국민대학교에서 판화·미디어·입체미술 전공"],"careers":["2016 제29회 광주광역시미술대전 미디어 대상","2022 광주시립미술관 국제레지던시","2020 광주문화재단 미디어아트 레지던시"],"teachingFields":["AI 영상","비디오아트","미디어아트","영상설치","디지털 이미지"],"studentProjects":["AI 영상 실험","비디오아트·설치 프로젝트","미디어아트 포트폴리오"],"careerPaths":[],"institutionProjects":[],"majorWorks":[]},"status":"active","weekly_capacity":0,"priority":0,"source_date":"2026-07-20","last_verified_at":null}]$faculty$::jsonb) as seed (
    name text, title text, employment_type text, consultation_role text, office text,
    phone text, email text, website text, contact_visibility jsonb, expertise_summary text,
    bio text, profile_sections jsonb, status text, weekly_capacity smallint,
    priority smallint, source_date date, last_verified_at timestamptz
  )
  where faculty.name = seed.name;

  insert into public.faculty (
    name, title, employment_type, consultation_role, office, phone, email, website,
    contact_visibility, expertise_summary, bio, profile_sections, status,
    weekly_capacity, priority, source_date, last_verified_at
  )
  select seed.name, seed.title, seed.employment_type, seed.consultation_role,
    seed.office, seed.phone, seed.email, seed.website, seed.contact_visibility,
    seed.expertise_summary, seed.bio, seed.profile_sections, seed.status,
    seed.weekly_capacity, seed.priority, seed.source_date, seed.last_verified_at
  from pg_catalog.jsonb_to_recordset($faculty$[{"name":"정한결","title":"시간강사","employment_type":"practitioner","consultation_role":"specialist","office":null,"phone":null,"email":null,"website":null,"contact_visibility":{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"},"expertise_summary":"예술사진·AI·기술적 이미지·미디어아트","bio":"사진 매체를 기반으로 사회적 언어, 이데올로기 구조와 주변부 존재의 서사를 탐구하는 시각예술가다. 기록에 퍼포먼스 등 실험적 방식을 결합해 광주에서 작업한다.","profile_sections":{"recommendationRole":"윤태준 교수 총괄 아래 예술사진·AI 기반 창작 연계","education":[],"careers":["2022 5·18기념문화센터 기획전 《길 위에서》 참여","2025 예술공간 집 기획전 《Technically Speaking》 참여","광주시립미술관 청년예술센터 입주작가","대안 문화예술단체 디디에프(DDF) 대표","충장로5가 ‘사색(四色)의 골목’ 문화예술공간 조성 프로젝트"],"teachingFields":["예술사진","사회적 언어와 이미지","AI·기술적 이미지","미디어아트","설치·퍼포먼스 기반 사진"],"studentProjects":["예술사진 연작","AI·기술 이미지 실험","사진·퍼포먼스 결합 프로젝트"],"careerPaths":[],"institutionProjects":[],"majorWorks":[]},"status":"active","weekly_capacity":0,"priority":0,"source_date":"2026-07-20","last_verified_at":null},{"name":"유별남","title":"시간강사","employment_type":"practitioner","consultation_role":"specialist","office":null,"phone":null,"email":null,"website":"https://www.yoobeylnam.com/","contact_visibility":{"office":"hidden","phone":"hidden","email":"hidden","website":"public"},"expertise_summary":"다큐멘터리 사진·포토스토리·사람과 자연의 기록","bio":"사진가로서 사람들이 찾지 않는 곳에서 만난 사람·자연·장소의 장면을 사진에 담고, 전시와 출판을 통해 사진의 이야기를 나눈다. 다큐멘터리 사진의 시선과 포토스토리 작업을 보완한다.","profile_sections":{"recommendationRole":"조대연·김사라 교수 총괄 아래 다큐멘터리 기록 연계","education":[],"careers":[],"teachingFields":["다큐멘터리 사진","포토스토리","장소와 사람의 기록","사진 프로젝트 편집"],"studentProjects":["사람과 장소를 기록하는 사진 연작","장기 포토스토리","사진집·전시 구성"],"careerPaths":[],"institutionProjects":[],"majorWorks":["빗개","AFTER NIGHTFALL","CITY","K2","NEVER STOP"]},"status":"active","weekly_capacity":0,"priority":0,"source_date":"2026-07-20","last_verified_at":"2026-07-20T00:00:00+09:00"},{"name":"김태현","title":"시간강사","employment_type":"practitioner","consultation_role":"specialist","office":null,"phone":null,"email":null,"website":"https://studio.underyourwater.com/","contact_visibility":{"office":"hidden","phone":"hidden","email":"hidden","website":"public"},"expertise_summary":"다큐멘터리·영상제작·예술사진","bio":"카메라를 성실한 재현을 돕는 조력자이자 이미지를 특정한 의미에 가두는 기계로 인식한다. 현실의 충실한 재현을 지향하며 다큐멘터리적 태도로 사진과 영상 작업을 한다. 서울에서 스튜디오 물밑을 운영한다.","profile_sections":{"recommendationRole":"전임교원 총괄 아래 다큐멘터리·영상 제작 연계","education":["2025 한국예술종합학교 영상원 방송영상과 다큐멘터리 전공 예술전문사 재학","2017 중앙대학교 공연예술창작학부 사진전공 학사","2017 중앙대학교 문화콘텐츠융합전공 학사"],"careers":["2020–2025 KBS 창원총국 촬영감독","스튜디오 물밑 운영"],"teachingFields":["다큐멘터리 사진","다큐멘터리 영상","촬영·편집","예술사진"],"studentProjects":["다큐멘터리 사진·영상 프로젝트","인터뷰 기반 영상","사진·영상 포트폴리오"],"careerPaths":[],"institutionProjects":[],"majorWorks":[]},"status":"active","weekly_capacity":0,"priority":0,"source_date":"2026-07-20","last_verified_at":"2026-07-20T00:00:00+09:00"},{"name":"김명우","title":"시간강사","employment_type":"practitioner","consultation_role":"specialist","office":null,"phone":null,"email":null,"website":null,"contact_visibility":{"office":"hidden","phone":"hidden","email":"hidden","website":"hidden"},"expertise_summary":"AI 영상·미디어아트·영상설치","bio":"판화·미디어·입체미술을 바탕으로 비디오아트 작업을 이어온 미디어아트 작가다. 급변하는 미디어 환경과 디지털 기기가 인간의 삶에 미치는 영향을 영상과 설치로 탐구하며, 디지털 추상 이미지와 현실의 경계를 다룬다.","profile_sections":{"recommendationRole":"윤태준 교수 총괄 아래 AI 영상·미디어아트 연계","education":["조선대학교·중앙대학교·국민대학교에서 판화·미디어·입체미술 전공"],"careers":["2016 제29회 광주광역시미술대전 미디어 대상","2022 광주시립미술관 국제레지던시","2020 광주문화재단 미디어아트 레지던시"],"teachingFields":["AI 영상","비디오아트","미디어아트","영상설치","디지털 이미지"],"studentProjects":["AI 영상 실험","비디오아트·설치 프로젝트","미디어아트 포트폴리오"],"careerPaths":[],"institutionProjects":[],"majorWorks":[]},"status":"active","weekly_capacity":0,"priority":0,"source_date":"2026-07-20","last_verified_at":null}]$faculty$::jsonb) as seed (
    name text, title text, employment_type text, consultation_role text, office text,
    phone text, email text, website text, contact_visibility jsonb, expertise_summary text,
    bio text, profile_sections jsonb, status text, weekly_capacity smallint,
    priority smallint, source_date date, last_verified_at timestamptz
  )
  where not exists (select 1 from public.faculty faculty where faculty.name = seed.name);

  update public.faculty faculty
  set priority = case faculty.name
        when '정한결' then 60
        when '유별남' then 50
        when '김태현' then 40
        when '김명우' then 30
      end,
      updated_at = pg_catalog.clock_timestamp()
  where faculty.name = any (array['정한결', '유별남', '김태현', '김명우']::text[])
    and faculty.priority is distinct from case faculty.name
      when '정한결' then 60 when '유별남' then 50 when '김태현' then 40 when '김명우' then 30 end;

  delete from public.faculty_tags tag
  using public.faculty faculty
  where tag.faculty_id = faculty.id
    and faculty.name = any (array['정한결', '유별남', '김태현', '김명우']::text[]);

  insert into public.faculty_tags (
    faculty_id, tag_key, tag_label, category, weight, is_primary
  )
  select faculty.id, seed.tag_key, seed.tag_label, seed.category, seed.weight, seed.is_primary
  from pg_catalog.jsonb_to_recordset($tags$[{"faculty_name":"정한결","tag_key":"art_photo","tag_label":"예술사진","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"정한결","tag_key":"ai","tag_label":"AI","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"정한결","tag_key":"media_art","tag_label":"미디어아트","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"정한결","tag_key":"installation","tag_label":"설치","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"정한결","tag_key":"photography","tag_label":"예술사진","category":"activity","weight":2,"is_primary":false},{"faculty_name":"정한결","tag_key":"activity_c9160324","tag_label":"사회적 언어와 이미지","category":"activity","weight":2,"is_primary":false},{"faculty_name":"정한결","tag_key":"ai","tag_label":"AI·기술적 이미지","category":"activity","weight":2,"is_primary":false},{"faculty_name":"정한결","tag_key":"media_art","tag_label":"미디어아트","category":"activity","weight":2,"is_primary":false},{"faculty_name":"정한결","tag_key":"installation","tag_label":"설치·퍼포먼스 기반 사진","category":"activity","weight":2,"is_primary":false},{"faculty_name":"정한결","tag_key":"photography","tag_label":"예술사진 연작","category":"result","weight":2,"is_primary":false},{"faculty_name":"정한결","tag_key":"ai","tag_label":"AI·기술 이미지 실험","category":"result","weight":2,"is_primary":false},{"faculty_name":"유별남","tag_key":"documentary","tag_label":"다큐멘터리","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"유별남","tag_key":"record","tag_label":"기록","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"유별남","tag_key":"photo_story","tag_label":"포토스토리","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"유별남","tag_key":"documentary","tag_label":"다큐멘터리 사진","category":"activity","weight":2,"is_primary":false},{"faculty_name":"유별남","tag_key":"photography","tag_label":"다큐멘터리 사진","category":"activity","weight":2,"is_primary":false},{"faculty_name":"유별남","tag_key":"photo_story","tag_label":"포토스토리","category":"activity","weight":2,"is_primary":false},{"faculty_name":"유별남","tag_key":"record","tag_label":"장소와 사람의 기록","category":"activity","weight":2,"is_primary":false},{"faculty_name":"유별남","tag_key":"record","tag_label":"사람과 장소를 기록하는 사진 연작","category":"result","weight":2,"is_primary":false},{"faculty_name":"유별남","tag_key":"photography","tag_label":"사람과 장소를 기록하는 사진 연작","category":"result","weight":2,"is_primary":false},{"faculty_name":"유별남","tag_key":"photo_story","tag_label":"장기 포토스토리","category":"result","weight":2,"is_primary":false},{"faculty_name":"유별남","tag_key":"photobook","tag_label":"사진집·전시 구성","category":"result","weight":2,"is_primary":false},{"faculty_name":"유별남","tag_key":"exhibition","tag_label":"사진집·전시 구성","category":"result","weight":2,"is_primary":false},{"faculty_name":"김태현","tag_key":"documentary","tag_label":"다큐멘터리","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"김태현","tag_key":"video","tag_label":"영상","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"김태현","tag_key":"art_photo","tag_label":"예술사진","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"김태현","tag_key":"documentary","tag_label":"다큐멘터리 사진","category":"activity","weight":2,"is_primary":false},{"faculty_name":"김태현","tag_key":"photography","tag_label":"다큐멘터리 사진","category":"activity","weight":2,"is_primary":false},{"faculty_name":"김태현","tag_key":"video","tag_label":"다큐멘터리 영상","category":"activity","weight":2,"is_primary":false},{"faculty_name":"김태현","tag_key":"activity_2a1e6fe8","tag_label":"촬영·편집","category":"activity","weight":2,"is_primary":false},{"faculty_name":"김태현","tag_key":"video","tag_label":"다큐멘터리 사진·영상 프로젝트","category":"result","weight":2,"is_primary":false},{"faculty_name":"김태현","tag_key":"documentary","tag_label":"다큐멘터리 사진·영상 프로젝트","category":"result","weight":2,"is_primary":false},{"faculty_name":"김태현","tag_key":"photography","tag_label":"다큐멘터리 사진·영상 프로젝트","category":"result","weight":2,"is_primary":false},{"faculty_name":"김태현","tag_key":"interview","tag_label":"인터뷰 기반 영상","category":"result","weight":2,"is_primary":false},{"faculty_name":"김태현","tag_key":"portfolio","tag_label":"사진·영상 포트폴리오","category":"result","weight":2,"is_primary":false},{"faculty_name":"김명우","tag_key":"ai","tag_label":"AI","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"김명우","tag_key":"video","tag_label":"영상","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"김명우","tag_key":"media_art","tag_label":"미디어아트","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"김명우","tag_key":"installation","tag_label":"설치","category":"specialist","weight":3,"is_primary":true},{"faculty_name":"김명우","tag_key":"video","tag_label":"AI 영상","category":"activity","weight":2,"is_primary":false},{"faculty_name":"김명우","tag_key":"ai","tag_label":"AI 영상","category":"activity","weight":2,"is_primary":false},{"faculty_name":"김명우","tag_key":"activity_4e833857","tag_label":"비디오아트","category":"activity","weight":2,"is_primary":false},{"faculty_name":"김명우","tag_key":"media_art","tag_label":"미디어아트","category":"activity","weight":2,"is_primary":false},{"faculty_name":"김명우","tag_key":"installation","tag_label":"영상설치","category":"activity","weight":2,"is_primary":false},{"faculty_name":"김명우","tag_key":"activity_1ff66c97","tag_label":"디지털 이미지","category":"activity","weight":2,"is_primary":false},{"faculty_name":"김명우","tag_key":"video","tag_label":"AI 영상 실험","category":"result","weight":2,"is_primary":false},{"faculty_name":"김명우","tag_key":"ai","tag_label":"AI 영상 실험","category":"result","weight":2,"is_primary":false},{"faculty_name":"김명우","tag_key":"installation","tag_label":"비디오아트·설치 프로젝트","category":"result","weight":2,"is_primary":false},{"faculty_name":"김명우","tag_key":"portfolio","tag_label":"미디어아트 포트폴리오","category":"result","weight":2,"is_primary":false},{"faculty_name":"김명우","tag_key":"media_art","tag_label":"미디어아트 포트폴리오","category":"result","weight":2,"is_primary":false}]$tags$::jsonb) as seed (
    faculty_name text, tag_key text, tag_label text, category text,
    weight smallint, is_primary boolean
  )
  join public.faculty faculty on faculty.name = seed.faculty_name;

  with ranked_tags as (
    select tag.id,
      pg_catalog.row_number() over (
        partition by tag.faculty_id, tag.category
        order by tag.weight desc, tag.tag_key
      ) = 1 as is_primary
    from public.faculty_tags tag
    join public.faculty faculty on faculty.id = tag.faculty_id
    where faculty.name = any (array['정한결', '유별남', '김태현', '김명우']::text[])
  )
  update public.faculty_tags tag
  set is_primary = ranked_tags.is_primary
  from ranked_tags
  where tag.id = ranked_tags.id
    and tag.is_primary is distinct from ranked_tags.is_primary;

  delete from public.faculty_specialist_links link
  using public.faculty specialist
  where link.specialist_faculty_id = specialist.id
    and specialist.name = any (array['정한결', '유별남', '김태현', '김명우']::text[]);

  insert into public.faculty_specialist_links (
    primary_faculty_id, specialist_faculty_id, tag_key, priority, explanation_template
  )
  select primary_faculty.id, specialist.id, seed.tag_key, seed.priority, seed.explanation_template
  from pg_catalog.jsonb_to_recordset($links$[{"primary_faculty_name":"윤태준","specialist_faculty_name":"정한결","tag_key":"art_photo","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 윤태준 교수를 중심으로 진행하고, 예술사진·AI 기반 창작과 기술적 이미지 실험이 필요한 경우 정한결 시간강사를 연계한다."},{"primary_faculty_name":"윤태준","specialist_faculty_name":"정한결","tag_key":"ai","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 윤태준 교수를 중심으로 진행하고, 예술사진·AI 기반 창작과 기술적 이미지 실험이 필요한 경우 정한결 시간강사를 연계한다."},{"primary_faculty_name":"윤태준","specialist_faculty_name":"정한결","tag_key":"media_art","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 윤태준 교수를 중심으로 진행하고, 예술사진·AI 기반 창작과 기술적 이미지 실험이 필요한 경우 정한결 시간강사를 연계한다."},{"primary_faculty_name":"윤태준","specialist_faculty_name":"정한결","tag_key":"installation","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 윤태준 교수를 중심으로 진행하고, 예술사진·AI 기반 창작과 기술적 이미지 실험이 필요한 경우 정한결 시간강사를 연계한다."},{"primary_faculty_name":"조대연","specialist_faculty_name":"유별남","tag_key":"documentary","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 조대연 교수를 중심으로 진행하고, 다큐멘터리 사진의 시선과 포토스토리 작업이 필요한 경우 유별남 시간강사를 연계한다."},{"primary_faculty_name":"김사라","specialist_faculty_name":"유별남","tag_key":"documentary","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 김사라 교수를 중심으로 진행하고, 다큐멘터리 사진의 시선과 포토스토리 작업이 필요한 경우 유별남 시간강사를 연계한다."},{"primary_faculty_name":"조대연","specialist_faculty_name":"유별남","tag_key":"record","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 조대연 교수를 중심으로 진행하고, 사람과 장소의 기록과 장기 포토스토리 작업이 필요한 경우 유별남 시간강사를 연계한다."},{"primary_faculty_name":"조대연","specialist_faculty_name":"유별남","tag_key":"photo_story","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 조대연 교수를 중심으로 진행하고, 사람과 장소의 기록과 장기 포토스토리 작업이 필요한 경우 유별남 시간강사를 연계한다."},{"primary_faculty_name":"조대연","specialist_faculty_name":"김태현","tag_key":"documentary","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 조대연 교수를 중심으로 진행하고, 다큐멘터리 사진·영상의 촬영과 편집이 필요한 경우 김태현 시간강사를 연계한다."},{"primary_faculty_name":"김사라","specialist_faculty_name":"김태현","tag_key":"documentary","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 김사라 교수를 중심으로 진행하고, 다큐멘터리 사진·영상의 촬영과 편집이 필요한 경우 김태현 시간강사를 연계한다."},{"primary_faculty_name":"윤태준","specialist_faculty_name":"김태현","tag_key":"video","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 윤태준 교수를 중심으로 진행하고, 다큐멘터리적 태도의 영상 제작과 예술사진 작업이 필요한 경우 김태현 시간강사를 연계한다."},{"primary_faculty_name":"윤태준","specialist_faculty_name":"김태현","tag_key":"art_photo","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 윤태준 교수를 중심으로 진행하고, 다큐멘터리적 태도의 영상 제작과 예술사진 작업이 필요한 경우 김태현 시간강사를 연계한다."},{"primary_faculty_name":"윤태준","specialist_faculty_name":"김명우","tag_key":"ai","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 윤태준 교수를 중심으로 진행하고, AI 영상·미디어아트·영상설치 작업이 필요한 경우 김명우 시간강사를 연계한다."},{"primary_faculty_name":"윤태준","specialist_faculty_name":"김명우","tag_key":"video","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 윤태준 교수를 중심으로 진행하고, AI 영상·미디어아트·영상설치 작업이 필요한 경우 김명우 시간강사를 연계한다."},{"primary_faculty_name":"윤태준","specialist_faculty_name":"김명우","tag_key":"media_art","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 윤태준 교수를 중심으로 진행하고, AI 영상·미디어아트·영상설치 작업이 필요한 경우 김명우 시간강사를 연계한다."},{"primary_faculty_name":"윤태준","specialist_faculty_name":"김명우","tag_key":"installation","priority":100,"explanation_template":"학생의 주요 상담과 학습경로 설계는 윤태준 교수를 중심으로 진행하고, AI 영상·미디어아트·영상설치 작업이 필요한 경우 김명우 시간강사를 연계한다."}]$links$::jsonb) as seed (
    primary_faculty_name text, specialist_faculty_name text, tag_key text,
    priority smallint, explanation_template text
  )
  left join public.faculty primary_faculty on primary_faculty.name = seed.primary_faculty_name
  join public.faculty specialist on specialist.name = seed.specialist_faculty_name;

  if (select pg_catalog.count(*) from public.faculty
      where name = any (array['정한결', '유별남', '김태현', '김명우']::text[])
        and status = 'active' and employment_type = 'practitioner'
        and consultation_role = 'specialist' and weekly_capacity = 0) <> 4
    or (select pg_catalog.count(*)
      from public.faculty_tags tag
      join public.faculty faculty on faculty.id = tag.faculty_id
      where faculty.name = any (array['정한결', '유별남', '김태현', '김명우']::text[])) <> 50
    or (select pg_catalog.count(*)
      from public.faculty_specialist_links link
      join public.faculty specialist on specialist.id = link.specialist_faculty_id
      where specialist.name = any (array['정한결', '유별남', '김태현', '김명우']::text[])) <> 16
  then
    raise exception using
      errcode = 'P0001',
      message = 'SUPPORTING_INSTRUCTOR_POSTCONDITION_FAILED';
  end if;

  return '{"status":"updated"}'::jsonb;
end;
$$;

revoke all on function public.upsert_verified_2026_supporting_instructors()
  from public, anon, authenticated, service_role;

select public.upsert_verified_2026_supporting_instructors();

create or replace function public.activate_verified_2026_content()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_user_id uuid;
  v_faculty public.faculty%rowtype;
  v_resource public.resources%rowtype;
  v_outcome jsonb;
  v_track text;
  v_faculty_published integer := 0;
  v_resources_published integer := 0;
  v_validation_errors integer := 0;
begin
  select admin_user.id into v_admin_user_id
  from public.admin_users admin_user
  where admin_user.role = 'admin' and admin_user.is_active
  order by admin_user.created_at, admin_user.id
  limit 1;
  if v_admin_user_id is null then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  if (select count(*) from public.faculty where name = any (array[
    '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱',
      '정한결', '유별남', '김태현', '김명우'
  ]::text[])) <> 10
    or exists (
      select 1 from public.faculty
      where name = any (array['조대연', '윤태준', '김사라']::text[])
        and (employment_type <> 'full_time' or consultation_role <> 'primary')
    )
    or exists (
      select 1 from public.faculty
      where name = any (array['박재웅', '정철호', '곽동욱']::text[])
        and (employment_type <> 'adjunct' or consultation_role <> 'specialist')
    )
    or exists (
      select 1 from public.faculty
      where name = any (array['정한결', '유별남', '김태현', '김명우']::text[])
        and (employment_type <> 'practitioner' or consultation_role <> 'specialist'
          or weekly_capacity <> 0)
    )
  then
    raise exception using errcode = 'P0001', message = 'CONTENT_SEED_FACULTY_INVALID';
  end if;

  update public.faculty faculty
  set weekly_capacity = case faculty.name
        when '조대연' then 4
        when '윤태준' then 4
        when '김사라' then 4
        else 0
      end,
      priority = case faculty.name
        when '조대연' then 300
        when '윤태준' then 200
        when '김사라' then 100
        when '박재웅' then 90
        when '정철호' then 80
        when '곽동욱' then 70
        when '정한결' then 60
        when '유별남' then 50
        when '김태현' then 40
        when '김명우' then 30
        else faculty.priority
      end,
      updated_at = pg_catalog.clock_timestamp()
  where faculty.name = any (array[
    '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱',
      '정한결', '유별남', '김태현', '김명우'
  ]::text[])
    and (
      faculty.weekly_capacity is distinct from case faculty.name
        when '조대연' then 4 when '윤태준' then 4 when '김사라' then 4 else 0 end
      or faculty.priority is distinct from case faculty.name
        when '조대연' then 300 when '윤태준' then 200 when '김사라' then 100
        when '박재웅' then 90 when '정철호' then 80 when '곽동욱' then 70
        when '정한결' then 60 when '유별남' then 50 when '김태현' then 40 when '김명우' then 30
        else faculty.priority end
    );

  with ranked_tags as (
    select tag.id,
      pg_catalog.row_number() over (
        partition by tag.faculty_id, tag.category
        order by tag.weight desc, tag.tag_key
      ) = 1 as is_primary
    from public.faculty_tags tag
    join public.faculty faculty on faculty.id = tag.faculty_id
    where faculty.name = any (array[
      '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱',
      '정한결', '유별남', '김태현', '김명우'
    ]::text[])
  )
  update public.faculty_tags tag
  set is_primary = ranked_tags.is_primary
  from ranked_tags
  where tag.id = ranked_tags.id
    and tag.is_primary is distinct from ranked_tags.is_primary;

  update public.faculty_tags tag
  set category = case
        when tag.category = 'track' and tag.tag_key = 'contemporary_art' then 'activity'
        else tag.category
      end,
      tag_label = case tag.tag_key
        when 'documentary' then '다큐멘터리 사진'
        when 'video' then '영상과 기술(AI·편집·드론)'
        else tag.tag_label
      end
  from public.faculty faculty
  where faculty.id = tag.faculty_id
    and faculty.name = any (array[
      '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱',
      '정한결', '유별남', '김태현', '김명우'
    ]::text[])
    and (
      (tag.category = 'track' and tag.tag_key = 'contemporary_art')
      or (tag.tag_key = 'documentary' and tag.tag_label <> '다큐멘터리 사진')
      or (tag.tag_key = 'video' and tag.tag_label <> '영상과 기술(AI·편집·드론)')
    );

  for v_faculty in
    select * from public.faculty
    where name = any (array[
      '조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱',
      '정한결', '유별남', '김태현', '김명우'
    ]::text[])
    order by case when consultation_role = 'primary' then 0 else 1 end, name
  loop
    if v_faculty.status = 'active' then
      continue;
    end if;
    if v_faculty.status <> 'draft' then
      raise exception using errcode = 'P0001', message = 'CONTENT_SEED_FACULTY_STATUS_INVALID';
    end if;

    v_outcome := public.publish_admin_faculty(
      v_admin_user_id, v_faculty.updated_at, v_faculty.id, pg_catalog.gen_random_uuid()
    );
    if v_outcome ->> 'status' <> 'updated' then
      raise exception using errcode = 'P0001', message = 'CONTENT_SEED_FACULTY_PUBLISH_FAILED';
    end if;
    v_faculty_published := v_faculty_published + 1;
  end loop;

  update public.resources resource
  set metadata = resource.metadata || pg_catalog.jsonb_build_object('goal', resource.metadata ->> 'source_goal'),
      updated_at = pg_catalog.clock_timestamp()
  where resource.status = 'draft'
    and resource.visibility = 'public'
    and resource.type = 'course'
    and resource.metadata ->> 'seedKey' like 'course:%'
    and pg_catalog.jsonb_typeof(resource.metadata -> 'goal') is distinct from 'string'
    and pg_catalog.jsonb_typeof(resource.metadata -> 'source_goal') = 'string';

  for v_resource in
    select * from public.resources
    where status = 'draft' and visibility = 'public'
    order by id
  loop
    v_outcome := public.transition_admin_resource(
      v_admin_user_id, v_resource.updated_at, pg_catalog.gen_random_uuid(), v_resource.id, 'active'
    );
    if v_outcome ->> 'status' = 'updated' then
      v_resources_published := v_resources_published + 1;
    elsif v_outcome ->> 'status' = 'validation_error' then
      if (select status from public.resources where id = v_resource.id) <> 'draft' then
        raise exception using errcode = 'P0001', message = 'CONTENT_SEED_RESOURCE_VALIDATION_MUTATED';
      end if;
      v_validation_errors := v_validation_errors + 1;
    else
      raise exception using errcode = 'P0001', message = 'CONTENT_SEED_RESOURCE_PUBLISH_FAILED';
    end if;
  end loop;

  if (select count(*) from public.faculty
      where name = any (array['조대연', '윤태준', '김사라', '박재웅', '정철호', '곽동욱',
      '정한결', '유별남', '김태현', '김명우']::text[])
        and status = 'active') <> 10
    or (select count(*) from public.faculty
        where name = any (array['조대연', '윤태준', '김사라']::text[])
          and status = 'active' and employment_type = 'full_time'
          and consultation_role = 'primary' and weekly_capacity > 0) <> 3
    or (select count(*) from public.faculty
        where name = any (array['정한결', '유별남', '김태현', '김명우']::text[])
          and status = 'active' and employment_type = 'practitioner'
          and consultation_role = 'specialist' and weekly_capacity = 0) <> 4
  then
    raise exception using errcode = 'P0001', message = 'CONTENT_SEED_FACULTY_POSTCONDITION_FAILED';
  end if;

  foreach v_track in array array['documentary', 'art_photo', 'commercial', 'video']::text[]
  loop
    if not exists (
      select 1
      from public.resources resource
      join public.resource_tags tag on tag.resource_id = resource.id
      where resource.type = 'course' and resource.status = 'active'
        and resource.visibility = 'public' and tag.tag_key = v_track
    ) then
      raise exception using errcode = 'P0001', message = 'CONTENT_SEED_COURSE_POSTCONDITION_FAILED';
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'status', case when v_faculty_published + v_resources_published > 0 then 'updated' else 'already_activated' end,
    'facultyPublished', v_faculty_published,
    'resourcesPublished', v_resources_published,
    'validationErrors', v_validation_errors
  );
end;
$$;

revoke all on function public.activate_verified_2026_content()
  from public, anon, authenticated, service_role;
grant execute on function public.activate_verified_2026_content() to service_role;
