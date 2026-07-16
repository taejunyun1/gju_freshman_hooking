# PHOTO:NEXT 학과 아카이브 근거 운영 가이드

- 기준일: 2026-07-16
- 공개 자료 스냅샷 기준: Notion 2026-05-26, 각 개별 페이지의 `sourceLastEditedDate`
- 적용 범위: 졸업생 진로 사례, 비교과·프로젝트, 시설 후보
- 구조화 원본: `supabase/seed/department-archive-2026-05-26.json`
- 생성 결과: `supabase/seed/content-2026.sql`

## 1. 목적과 경계

학과 공개 자료에 있는 진로·프로그램·프로젝트·시설 근거를 학생 결과에 연결할 수 있는 짧고 검수 가능한 레코드로 보존한다. 공개 페이지의 긴 본문을 복제하거나, 사진 속 학생 작업·동아리 이름·현재 모집 여부를 추정하는 용도가 아니다.

아카이브 레코드는 모두 `draft`로 시작한다. `draft`, `admin_only`, `verify_required` 레코드는 학생 결과와 AI 입력에서 제외하고, 관리자가 검수·게시한 공개 레코드만 사용할 수 있다.

## 2. 출처 우선순위와 날짜

출처 우선순위는 다음과 같다.

1. 학과가 제공한 2026 교과 원본과 2026-07-14 기자재 운영 원본
2. 광주대학교 사진영상미디어학과 공식 웹 `https://gjuphoto.com/`
3. 학과 공개 Notion `https://gjphoto94.notion.site/`

공개 웹은 내부 원본을 보완하는 근거이며 내부 교과명, 기자재 수량, 접근 방식, 기존 네 시설을 덮어쓰지 않는다. 우선순위가 높은 출처와 낮은 출처가 다르면 한 값을 선택해 덮어쓰지 않고 충돌 후보와 URL을 함께 보존한다.

각 레코드는 `sourceUrl`, `sourcePageTitle`, `sourceLastEditedDate`, `evidenceStatus`, `verificationNote`를 가진다. `sourceDate`는 해당 레코드의 `sourceLastEditedDate`와 같아야 한다. 페이지 날짜가 최신이라는 이유만으로 현재 운영, 현재 직장, 현재 모집을 뜻하지 않는다.

내부 원본 네 파일은 byte-lock 테스트로 보호한다.

- `supabase/seed/curriculum-2026.json`
- `supabase/seed/equipment-inventory-2026-07-14.json`
- `supabase/seed/facilities-2026.json`
- `supabase/seed/faculty-2026.json`

## 3. 네 트랙 연결

아카이브도 기존 네 트랙만 사용한다.

| 키 | 표시 방향 | 아카이브 연결 예 |
|---|---|---|
| `documentary` | 다큐멘터리 사진 | 언론·인터뷰·지역 기록·아카이브·현장 리서치 |
| `art_photo` | 예술사진 | 개인 작업·전시·포토북·파인프린트·현대예술 |
| `commercial` | 광고사진 | 제품·패션·브랜드·스튜디오·상업 제작 |
| `video` | 영상과 기술(AI·편집·드론) | 촬영·편집·VFX·드론·VR·기술 이미지 |

각 레코드는 `trackEvidence` 1–4개와 `interestTags` 1개 이상을 가진다. 첫 트랙 하나만 primary 태그이며 나머지 트랙과 관심 태그는 보조 근거다. AI·드론·VFX·VR을 별도 트랙으로 만들지 않는다.

결과 설명 순서는 반드시 `curriculum → project → outcome → career → supporting_evidence`다. 장비·시설은 가장 관련 높은 1–2개를 먼저 보여주고 펼친 상태에서도 최대 4개만 보여준다. 장비 보유나 시설 존재만으로 특정 진로에 충분하다고 말하지 않는다.

## 4. 근거 상태

| 상태 | 의미 | 운영 문구 |
|---|---|---|
| `snapshot` | 해당 공개 시점에 확인된 진로 사례 | 현재 직장으로 일반화하지 않고 “공개 시점 사례”로 설명 |
| `historical` | 종료 연도 또는 단일 시행 시점이 확인된 활동 | 요약에 반드시 “과거 운영 사례” 포함 |
| `recurring` | 반복 교육 유형은 확인되나 개별 일정은 미확인 | 현재 일정·모집·참여 보장 금지 |
| `verify_required` | 출처 충돌 또는 현재 운영 정보가 부족함 | 검수 전 게시 금지, 필요한 확인 항목을 메모 |

`verify_required`가 남아 있는 아카이브는 관리자 서비스와 DB 전환 함수 양쪽에서 게시가 원자적으로 차단되며 `RESOURCE_ARCHIVE_VERIFICATION_REQUIRED`를 반환한다. 관리자가 원문을 다시 확인하고 메타데이터를 수정한 뒤 `evidenceStatus`를 `snapshot`, `recurring`, `historical` 중 사실에 맞는 상태로 바꿔야만 게시할 수 있다.

한 번 아카이브로 생성된 레코드는 `metadata.archive` 객체를 제거하거나 바깥 `metadata.seedKey`를 바꿀 수 없다. 관리자 서비스와 DB 업데이트 함수가 모두 이를 검사하고 `RESOURCE_ARCHIVE_IDENTITY_REQUIRED`를 반환한다. 관리자는 같은 `seedKey`와 `archive` 객체를 유지한 채 검수 결과와 `evidenceStatus`만 사실에 맞게 갱신한다.

직무 상태는 제목과 본문이 일치하면 `title_confirmed`, 본문에만 있으면 `body_only`, 서로 다르면 `conflicted`다. `body_only`는 현재 직장·직함으로 단정하지 않는다. `conflicted`는 후보를 모두 보존하고 `roleAtSource: null`, `admin_only`, `verify_required`로 둔다.

졸업연도도 같은 원칙을 사용한다. 충돌하면 `graduationYear: null`, `graduationYearStatus: conflicted`로 두고 두 후보와 각 URL을 보존한다.

## 5. 졸업생 17명 스냅샷

| 이름 | 졸업연도 | 공개 시점 역할 근거 | 상태 |
|---|---:|---|---|
| 서재훈 | 2006 | 한국일보 뉴스룸국 멀티미디어부 차장 | `title_confirmed` |
| 김수성 | 2011 | 오션테크 수석포토그래퍼·수중 스톡작가 | `title_confirmed` |
| 설소영 | 2015 | 아시아투데이 취재기자 | `title_confirmed` |
| 김민범 | 2015 | 무신사 에디터(전 광고대행사 아트디렉터) | `title_confirmed` |
| 윤동규 | 미확정 | 프리랜서 패션사진가 | 졸업연도 `conflicted`, `admin_only` |
| 노하윤 | 2024 | 사진영상 창업자 | `title_confirmed` |
| 박지우 | 2024 | 강철금 스튜디오 PM | `title_confirmed` |
| 박준희 | 2024 | 아크리트 스튜디오 대표 | `title_confirmed` |
| 임승찬 | 2023 | VFX 영상편집자 | `title_confirmed` |
| 최관호 | 2023 | CST 대표·사진영상 광고 | `title_confirmed` |
| 김병준 | 2023 | 단일 역할 미확정 | 역할 `conflicted`, `admin_only` |
| 유성현 | 2022 | 1인 사진관 운영·스냅 촬영 | `body_only` |
| 정해찬 | 2022 | 웹디자인·마케팅·푸드스타일링 결합 상업 제작 | `body_only` |
| 김윤교 | 2022 | 광고 스튜디오 AR 제작 | `body_only` |
| 박래현 | 2022 | 포스트프로덕션 컬러리스트 보조 | `body_only` |
| 박진우 | 2022 | 영상 촬영 기자 | `body_only` |
| 유승현 | 2022 | 가상현실 콘텐츠 제작사 업무 | `body_only` |

이 목록은 동문 전체 명단이나 취업 통계가 아니다. 공개 인터뷰 페이지에서 구조화할 수 있었던 17개 사례의 스냅샷이다.

## 6. 충돌·검수 목록

### 윤동규 졸업연도

- Notion 졸업생 인터뷰: 2024
- 공식 학과 웹 `https://gjuphoto.com/?kboard_content_redirect=12`: 2023
- 저장: `graduationYear: null`, 후보 2개와 URL 보존
- 공개: `admin_only`, `verify_required`

### 김병준 역할

- 제목 근거: VFX 영상편집자
- 본문 근거: 1인 프로덕션 CP
- 저장: `roleAtSource: null`, 두 후보 보존
- 공개: `admin_only`, `verify_required`

관리자는 출처 한쪽을 조용히 삭제하지 않는다. 학과 확인으로 정정할 때 확인 일자와 근거 URL을 남기고 상태를 변경한다.

## 7. 비교과·프로젝트 10건

| 유형 | 항목 | 기간 표시 | 상태 |
|---|---|---|---|
| 비교과 | 콘텐츠원캠퍼스 | 2019~2022 | `historical` |
| 비교과 | 지역혁신플랫폼·스마트드론 | 2020~2024 | `historical` |
| 비교과 | 인터뷰 촬영·사운드 프로그램 | 미확인 | `verify_required` |
| 비교과 | 광고 스튜디오 현장견학 | 미확인 | `verify_required` |
| 비교과 | 현장실습·인턴십 | 여름·겨울 방학 유형 | `verify_required` |
| 프로젝트 | 제주 일제동굴진지 아카이브 프로젝트랩 | 2020~2024 사업 기간 중 | `historical` |
| 프로젝트 | 광주비엔날레 스위스 파빌리온 연계전시 | 2023 | `historical` |
| 프로젝트 | 졸업전시 | 4학년 과정 | `recurring` |
| 프로젝트 | 2025 글로벌 챌린지 Frame in 52 | 2025-07~08 | `historical` |
| 프로젝트 | 2025 제주 수중드론·360VR 촬영 워크숍 | 2025-08, 3박 4일 | `historical` |

과거 사업·행사를 “운영 중”, “매년 운영”, “현재 모집”으로 바꾸지 않는다. 현장실습의 과거 실습처도 현재 협약 기관으로 표현하지 않는다.

## 8. 시설 후보 3건

공식 웹 `https://gjuphoto.com/facilities/`에서 이름 또는 존재를 확인한 후보는 다음과 같다.

- 스튜디오 C(영상 촬영)
- 대형 프린트랩
- 포트폴리오 리뷰·실습실

세 후보는 모두 `supportingEvidence: true`, `operation_note: null`, `last_verified_at: null`, `verify_required`로 저장한다. 현재 운영, 위치, 예약 방법, 사양을 확인하기 전에는 게시할 수 없다. 기존 내부 시설 4건과 기자재 원본은 변경하지 않는다.

## 9. 제외한 자료와 데이터 공백

- 학생 작업 이미지·캡션: 학생 동의와 작품별 출처 구조가 없어 `student_work`를 만들지 않는다.
- 동아리·학생회·학생자치: 검증 가능한 공식 명칭과 현재 운영 근거가 없어 레코드를 만들지 않는다.
- 사진만 있는 행사명·연도: 캡션이나 본문 근거가 없으면 추정하지 않는다.
- 긴 인터뷰·소개 본문: 원문을 옮기지 않고, 경로 근거를 1–2문장으로 요약한다.
- 개인 연락처·비공개 정보: 메타데이터에 넣지 않는다.

공백을 임의 데이터로 메우지 않는다. 학생 작업과 동아리는 별도 동의·출처·운영 확인 절차가 생긴 뒤 추가한다.

## 10. 게시 전 체크리스트

- [ ] HTTPS 원문을 다시 열어 제목, 역할, 연도, 편집일을 확인했다.
- [ ] 출처 충돌을 한 값으로 덮어쓰지 않았다.
- [ ] `historical` 요약에 “과거 운영 사례”가 있다.
- [ ] `body_only` 역할을 현재 공식 직함으로 단정하지 않았다.
- [ ] 기존 아카이브의 `metadata.archive`와 `metadata.seedKey`를 유지했다.
- [ ] 현재 모집·반복 운영·시설 사용을 보장하지 않았다.
- [ ] 트랙은 고정 네 키만 쓰며 primary 트랙은 하나다.
- [ ] 관심 태그가 학생 선택과 실제 근거를 설명한다.
- [ ] 결과 순서가 `curriculum → project → outcome → career → supporting_evidence`다.
- [ ] 장비·시설은 첫 화면 1–2개, 확장 시 최대 4개다.
- [ ] 장비·시설 존재만으로 진로 충분성이나 취업 가능성을 주장하지 않았다.
- [ ] 학생 작업, 동아리명, 개인 연락처를 새로 만들지 않았다.
- [ ] 긴 원문 대신 짧은 요약과 출처 링크를 사용했다.
