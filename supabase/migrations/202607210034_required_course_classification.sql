update public.resources resource
set metadata = resource.metadata || pg_catalog.jsonb_build_object(
      'requirement_type',
      case
        when resource.title = any (array[
          '라이팅과 스튜디오',
          '디지털 이미지 제작과 프린트',
          '영상 컬러와 포스트 프로덕션',
          '커머셜 포토그라피 기초 워크숍',
          '커머셜 포토그라피 심화 워크숍'
        ]::text[]) then 'major_required'
        else 'major_elective'
      end
    ),
    updated_at = pg_catalog.clock_timestamp()
where resource.type = 'course'
  and resource.metadata @> '{"academic_year": 2026}'::jsonb
  and resource.metadata ->> 'requirement_type' is distinct from case
    when resource.title = any (array[
      '라이팅과 스튜디오',
      '디지털 이미지 제작과 프린트',
      '영상 컬러와 포스트 프로덕션',
      '커머셜 포토그라피 기초 워크숍',
      '커머셜 포토그라피 심화 워크숍'
    ]::text[]) then 'major_required'
    else 'major_elective'
  end;
