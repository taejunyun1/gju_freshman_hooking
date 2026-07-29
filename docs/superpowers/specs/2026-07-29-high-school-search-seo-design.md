# PHOTO:NEXT 고등학생 검색 SEO 설계

## 목적

광주·전남·전북을 중심으로 사진영상학과, 영상편집, 사진·영상 진로, 대학교 진학을 탐색하는 고등학생이 검색 결과에서 광주대학교 사진영상미디어학과 PHOTO:NEXT를 발견하고, 사진·영상·편집·AI·드론 학습 경로를 이해한 뒤 관심사 진단으로 이동하게 한다.

## 범위

- 공개 색인 대상은 랜딩 루트 하나다.
- 학생 로그인·등록·설문·결과·상담·관리자·API는 색인과 사이트맵에서 제외한다.
- 검색용 별도 콘텐츠 사이트나 자동 생성 페이지는 만들지 않는다.

## 공개 랜딩

기준 URL은 현재 운영 주소 https://photo-next-mvp.taejunyun.workers.dev다. 코드에는 이 URL을 하나의 공개 사이트 상수로 두며, 이후 학과의 별도 도메인이 생기면 그 상수만 바꾼다.

랜딩은 서버 렌더링 head에 다음을 제공한다.

- 제목: 광주대학교 사진영상미디어학과 | 사진·영상·편집 진로·입시 안내
- 설명: 광주·전남·전북 고등학생을 위한 광주대학교 사진영상미디어학과 안내. 사진, 영상촬영·편집, 광고사진, AI·드론 관심사를 교과과정·프로젝트·교수진·진로와 연결해 봅니다.
- canonical, index 지시문, Open Graph와 Twitter 공유 메타
- 공유 이미지는 기존 학과 행사 사진 event-shooting-1.webp를 사용한다.

기존의 짧고 사진 중심인 랜딩 경험을 유지한다. 4단계 미리보기 아래에 CTA를 복제하지 않는 입시·진로 안내 블록 하나만 둔다.

- 제목: 사진영상학과에서 무엇을 배우는지, 관심사부터 확인해보세요.
- 본문: 사진 촬영과 광고사진, 영상촬영·편집, AI 이미지·영상, 드론 콘텐츠처럼 관심 있는 작업을 고르면 광주대학교 사진영상미디어학과의 교과과정과 프로젝트, 교수진, 진로 방향을 함께 볼 수 있습니다. 광주·전남·전북에서 사진·영상 전공과 대학 진학을 고민하는 고등학생이 학과에서 만들 수 있는 작업을 미리 살펴보는 안내입니다.

이 블록은 section과 h2를 사용한다. 점수·통계·모집 약속·입시 전형 정보는 넣지 않는다. 기존 주요 CTA 나의 연결 경로 찾기만 유지한다.

## 구조화 데이터

랜딩에는 서버 전용 JSON-LD를 넣는다. CollegeOrUniversity에는 정식 학과명, canonical URL, 공식 학과 웹 https://gjuphoto.com/, 동일한 설명, 광주광역시·전라남도·전라북도, 사진·영상촬영·영상편집·광고사진·AI 이미지·드론 콘텐츠를 넣는다. WebSite에는 PHOTO:NEXT 명칭과 canonical URL, 한국어를 넣는다. 확인하지 않은 주소, 전화번호, 모집 요강, 공식 계정은 넣지 않는다.

## 크롤러 제어

robots.txt는 홈을 허용하고 admin, login, register, assessment, start, history, counseling, credentials, pin, password, result, api 경로를 차단하며 sitemap URL을 안내한다.

sitemap.xml은 홈 URL 하나만 반환하고 lastmod는 생략한다. Nuxt routeRules는 같은 개인·운영 경로와 API에 X-Robots-Tag noindex, nofollow, noarchive를 준다. 홈에는 noindex 헤더를 주지 않는다.

## 테스트와 검증

- 랜딩 SSR HTML에 제목, 설명, canonical, Open Graph, Twitter, index 지시문, 두 JSON-LD 타입이 있다.
- 안내 본문에는 사진영상학과, 영상촬영·편집, 광주·전남·전북, 고등학생이 자연스럽게 포함된다.
- robots.txt는 sitemap과 개인 경로 차단을, sitemap.xml은 홈 하나를 반환한다.
- login, register, assessment, result, admin, API 응답은 X-Robots-Tag noindex를 갖는다.
- 대상 Vitest, pnpm lint, pnpm typecheck, pnpm build 후 운영 홈·robots·sitemap·login 헤더를 확인한다.

Google Search Console 소유권 확인과 색인 요청은 학과 소유자가 필요할 때 별도로 수행한다. 검색 순위, 특정 키워드 상위 노출, 광고·백링크·지역별 별도 랜딩 페이지는 이번 범위에 넣지 않는다.
