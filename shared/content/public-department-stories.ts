import type { TrackKey } from '../types/domain'

// Editorial selections from gjuphoto.com, reviewed 2026-10-07.
// These are published examples, not additional personalized recommendation scores.
const media = (path: string, alt: string, page: string) => ({
  image: `/images/gjuphoto${path.replace('/uploads', '')}`,
  sourceImage: `https://gjuphoto.com${path}`,
  alt,
  href: `https://gjuphoto.com${page}`,
})

const projection = {
  ...media('/uploads/events/campus-2026/3.webp', '프로젝터와 컴퓨터를 사용하는 학과 프로젝션 맵핑 수업', '/events/projection-mapping-2026/'),
  title: '이미지가 공간이 되는 수업', category: '프로젝션 맵핑', date: '2026.07',
  description: '사진과 영상을 프로젝터로 확장하며 공간 속 이미지를 실험합니다.',
}
const conversation = {
  ...media('/uploads/events/campus-2026/14.webp', '「사진의 얼굴」 상영 및 GV 참여 현장', '/events/faces-of-photography-2026/'),
  title: '작품을 보고, 작가와 대화하기', category: '「사진의 얼굴」 GV', date: '2026.09',
  description: '상영과 대화를 통해 사진을 바라보는 관점을 넓힌 현장입니다.',
}
const alumni = (id: number, name: string, role: string, responsive = true) => ({
  ...media(responsive ? `/uploads/responsive/alumni/interviews/${id}/01--480.webp` : `/uploads/alumni/interviews/${id}/01.webp`, `${name} 졸업생 인터뷰 대표 사진`, `/notice/${id}`),
  name, role,
})

export const publicDepartmentStories = {
  video: {
    title: '영상 + AI', line: '촬영한 장면을, 새로운 영상 언어로.',
    description: '촬영·편집·AI를 함께 배우며 나만의 영상 작업으로 이어가세요.',
    curriculumHref: 'https://gjuphoto.com/curriculum/#route-0',
    hero: { ...media('/uploads/notion/notion_event_19.webp', '카메라로 영상 촬영을 실습하는 사진영상미디어학과 학생들', '/curriculum/'), caption: '학과 영상 제작 실습' },
    activities: [
      { ...media('/uploads/events/campus-2026/9.webp', '2026 광주 에이스페어 AI PORTRAIT LAB 부스', '/events/ace-fair-2026/'), title: 'AI PORTRAIT LAB, 현장으로', category: '광주 에이스페어', date: '2026.09', description: 'AI 이미지와 관객이 만나는 부스에 학생들이 직접 참여했습니다.' },
      projection,
    ],
    alumni: [alumni(115, '박래현', '컬러 그레이딩 · 영상 데이터 관리'), alumni(109, '임승찬', 'VFX 영상편집자')],
  },
  art_photo: {
    title: '예술사진', line: '나의 질문을, 사진과 전시로.',
    description: '이미지와 장소, 매체를 탐구하며 개인 작업과 전시를 만들어가세요.',
    curriculumHref: 'https://gjuphoto.com/curriculum/#route-1',
    hero: { ...media('/uploads/notion/notion_event_02.webp', '학과 학생들의 사진 작품이 전시된 쇼케이스 공간', '/gallery/'), caption: '학과 작품 전시 아카이브' },
    activities: [projection, conversation],
    alumni: [alumni(118, '정한결', '현대 시각 미디어 작가 · SPACE DDF'), alumni(114, '김윤교', '광고 스튜디오 AR 제작', false)],
  },
  documentary: {
    title: '다큐멘터리', line: '사람과 지역의 이야기를, 나의 시선으로.',
    description: '만나고 기록하고 편집하며 사진과 영상의 이야기를 쌓아가세요.',
    curriculumHref: 'https://gjuphoto.com/curriculum/#route-2',
    hero: { ...media('/uploads/events/onbit-2026/workshop.webp', '2026 온빛다큐멘터리 워크숍에서 작업을 함께 살펴보는 참가자들', '/events/onbit-2026/'), caption: '2026 온빛다큐멘터리 워크숍 참여' },
    activities: [
      { ...media('/uploads/events/campus-2026/1.webp', '5·27 승리의 날 새벽광장에 참여한 학과 학생들', '/events/dawn-square-2026/'), title: '지역의 기억을 만나는 현장', category: '5·27 새벽광장', date: '2026.05', description: '지역의 역사와 만나는 행사에 학생들이 함께한 기록입니다.' },
      conversation,
    ],
    alumni: [alumni(119, '신희수', '사회적 다큐멘터리 사진가'), alumni(120, '판영석', '전남일보 사진기자', false)],
  },
  commercial: {
    title: '광고사진', line: '브랜드의 이야기를, 설득력 있는 이미지로.',
    description: '조명과 촬영, 후반작업을 익혀 패션·제품·브랜드 이미지를 만들어가세요.',
    curriculumHref: 'https://gjuphoto.com/curriculum/#route-3',
    hero: { ...media('/uploads/notion/notion_event_14.webp', '스튜디오에서 조명 사용법을 익히는 학과 학생들', '/curriculum/'), caption: '학과 스튜디오 조명 실습' },
    activities: [
      { ...media('/uploads/extracurricular/group.webp', '스튜디오 기자재 교육에 참여한 사진영상미디어학과 학생들', '/curriculum/#extracurricular-programs'), title: '장비를 익히고, 촬영으로 연결하기', category: '스튜디오 기자재 교육', date: '교육 아카이브', description: '스튜디오 기자재와 제작 실무를 경험하는 비교과 교육입니다.' },
      { ...media('/uploads/responsive/notion/notion_event_02--480.webp', '사진 작품을 발표하는 학과 전시 공간', '/gallery/'), title: '작업을 모아, 포트폴리오로', category: '졸업전시 · 작품', date: '작품 아카이브', description: '학생들이 완성한 사진과 영상 작업을 학과 갤러리에서 만나보세요.' },
    ],
    alumni: [alumni(121, '이영은', 'YNG STUDIO 대표실장 · 리터처', false), alumni(105, '윤동규', '패션사진가 · 프리랜서')],
  },
} as const satisfies Record<TrackKey, unknown>

export const departmentFacultyImages: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  Object.entries({ 조대연: 'sub02_13img', 윤태준: 'sub02_21img', 김사라: 'sub02_22img', 박재웅: 'sub02_17img', 곽동욱: 'sub02_26img', 정철호: 'sub02_24img', 김명우: 'kim-myungwoo-adjunct', 유별남: 'yoobeylnam-lecturer', 정한결: 'jeong-hangyeol-lecturer' })
    .map(([name, file]) => [name, `/images/gjuphoto/2025/08/${file}.webp`]),
))
