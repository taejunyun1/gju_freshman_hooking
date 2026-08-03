export const PUBLIC_SITE_URL = 'https://photo-next-mvp.taejunyun.workers.dev' as const

export const PRIVATE_CRAWLER_PATHS = Object.freeze([
  '/admin/',
  '/login',
  '/register',
  '/assessment',
  '/start',
  '/history',
  '/counseling',
  '/credentials',
  '/pin',
  '/password/',
  '/result/',
  '/api/',
])

export const PUBLIC_NOINDEX_PATHS = Object.freeze([
  '/curriculum-routes.html',
  '/curriculum-routes',
])

export const PUBLIC_SEO = Object.freeze({
  title: '광주대학교 사진영상미디어학과 | 사진·영상·편집 진로·입시 안내',
  description: '광주·전남·전북 고등학생을 위한 광주대학교 사진영상미디어학과 안내. 사진, 영상촬영·편집, 광고사진, AI·드론 관심사를 교과과정·프로젝트·교수진·진로와 연결해 봅니다.',
  image: `${PUBLIC_SITE_URL}/images/department/event-shooting-1.webp`,
})

export const PUBLIC_WEB_SITE_JSON_LD = Object.freeze({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'PHOTO:NEXT',
  url: PUBLIC_SITE_URL,
  inLanguage: 'ko-KR',
})

export const PUBLIC_DEPARTMENT_JSON_LD = Object.freeze({
  '@context': 'https://schema.org',
  '@type': 'CollegeOrUniversity',
  name: '광주대학교 사진영상미디어학과',
  url: PUBLIC_SITE_URL,
  sameAs: 'https://gjuphoto.com/',
  description: PUBLIC_SEO.description,
  areaServed: ['광주광역시', '전라남도', '전라북도'],
  knowsAbout: ['사진', '영상촬영', '영상편집', '광고사진', 'AI 이미지', '드론 콘텐츠'],
})

export const LANDING_DISCOVERY_COPY = Object.freeze({
  title: '사진영상학과에서 무엇을 배우는지, 관심사부터 확인해보세요.',
  body: '사진 촬영과 광고사진, 영상촬영·편집, AI 이미지·영상, 드론 콘텐츠처럼 관심 있는 작업을 고르면 광주대학교 사진영상미디어학과의 교과과정과 프로젝트, 교수진, 진로 방향을 함께 볼 수 있습니다. 광주·전남·전북에서 사진·영상 전공과 대학 진학을 고민하는 고등학생이 학과에서 만들 수 있는 작업을 미리 살펴보는 안내입니다.',
})
