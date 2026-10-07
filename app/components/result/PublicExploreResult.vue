<script setup lang="ts">
import { computed } from 'vue'
import type { ResultSnapshot } from '../../../shared/types/result'
import { publicDepartmentStories, departmentFacultyImages } from '../../../shared/content/public-department-stories'
import TrackScore from './TrackScore.vue'

const props = defineProps<{ snapshot: ResultSnapshot }>()
const story = computed(() => publicDepartmentStories[props.snapshot.rankedTracks[0]])
const faculty = computed(() => [props.snapshot.faculty.primary, props.snapshot.faculty.backup])
const specialists = computed(() => props.snapshot.faculty.specialists.slice(0, 2))
const yearLabels = ['사진·영상의 기초', '제작과 후반작업', '전공심화·프로젝트', '나만의 포트폴리오']
const projects = computed(() => [...props.snapshot.resources.project].sort((a, b) => (
  Number(b.displayMetadata.displayTier === 'current') - Number(a.displayMetadata.displayTier === 'current')
)).slice(0, 3))
</script>

<template>
  <article class="public-result" data-public-visual-result>
    <section class="public-result__hero" aria-labelledby="result-title">
      <div class="public-result__hero-copy">
        <p class="public-result__eyebrow">YOUR PATH · {{ story.title }}</p>
        <h1 id="result-title">{{ story.line }}</h1>
        <p>{{ story.description }}</p>
        <div class="public-result__actions"><a class="public-result__button" href="#public-curriculum">나의 4년 커리큘럼 ↓</a><a href="#public-counseling">상담하기 ↗</a></div>
        <span class="public-result__fine">선택한 관심사에 가까운 학습경로입니다.</span>
      </div>
      <a :href="story.hero.href" target="_blank" rel="noopener noreferrer" class="public-result__hero-image" aria-label="학과 현장 사진 원문 보기 (새 창)">
        <img :src="story.hero.image" :alt="story.hero.alt" width="1200" height="900" fetchpriority="high">
        <span>{{ story.hero.caption }} <span aria-hidden="true">↗</span></span>
      </a>
    </section>

    <section id="public-curriculum" class="public-result__section public-result__curriculum" aria-labelledby="public-curriculum-title">
      <header class="public-result__section-head"><div><p class="public-result__eyebrow">01 / YOUR FOUR YEARS</p><h2 id="public-curriculum-title">관심에서 시작해, 작품으로 남기는 4년</h2></div><a :href="story.curriculumHref" target="_blank" rel="noopener noreferrer">전체 교육과정 ↗</a></header>
      <ol class="public-result__years">
        <li v-for="year in snapshot.learningPath" :key="year.year" :data-public-year="year.year" class="public-result__year">
          <span class="public-result__year-number">0{{ year.year }}</span>
          <h3>{{ year.year }}학년 <span>{{ yearLabels[year.year - 1] }}</span></h3>
          <ul class="public-result__courses">
            <li v-for="course in year.resources" :key="course.id"><span>{{ course.title }}</span><small v-if="course.displayMetadata.requirementType === 'major_required'" data-required-course>전공필수</small></li>
          </ul>
          <p v-if="year.resources.length === 0" class="public-result__fine">교과 정보를 준비 중입니다.</p>
          <details v-if="year.resources.length" class="public-result__course-detail">
            <summary>수업 자세히 보기</summary>
            <div v-for="course in year.resources" :key="course.id"><h4>{{ course.title }}</h4><p>{{ course.summary }}</p><small>{{ course.displayMetadata.term }} · {{ course.displayMetadata.credits }}학점</small></div>
          </details>
        </li>
      </ol>
      <p class="public-result__fine">관심 분야를 함께 고려한 추천입니다. 실제 개설·수강 정보는 학과 안내를 확인해 주세요.</p>
    </section>

    <section class="public-result__section" aria-labelledby="public-activities-title">
      <header class="public-result__section-head"><div><p class="public-result__eyebrow">02 / INSIDE DPIM</p><h2 id="public-activities-title">교실 밖에서는, 이렇게 배웁니다</h2></div><a href="https://gjuphoto.com/events/" target="_blank" rel="noopener noreferrer">학과 활동 더 보기 ↗</a></header>
      <div class="public-result__stories">
        <a v-for="item in story.activities" :key="item.href" :href="item.href" target="_blank" rel="noopener noreferrer" class="public-result__story" data-homepage-activity>
          <img :src="item.image" :alt="item.alt" width="900" height="600" loading="lazy" decoding="async">
          <div class="public-result__story-copy"><div class="public-result__meta"><span>{{ item.category }}</span><time>{{ item.date }}</time></div><h3>{{ item.title }} <span aria-hidden="true">↗</span></h3><p>{{ item.description }}</p></div>
        </a>
      </div>
      <p class="public-result__fine">학과 홈페이지에 공개된 활동 사례입니다. 향후 참여·운영 일정은 별도 안내됩니다.</p>
      <details v-if="projects.length" class="public-result__fold"><summary>내 관심사와 연결된 프로젝트 {{ projects.length }}개</summary><div class="public-result__project-list"><article v-for="project in projects" :key="project.id"><small>{{ project.displayMetadata.displayTier === 'experience' ? '학과의 이전 경험' : project.displayMetadata.statusLabel || '연결 프로젝트' }} · {{ project.displayMetadata.periodLabel || project.sourceDate }}</small><h3>{{ project.title }}</h3><p>{{ project.summary }}</p></article></div></details>
    </section>

    <aside class="public-result__mid"><div><span class="public-result__eyebrow">LET’S TALK</span><h2>이 수업이 궁금하다면,<br>학과에 직접 물어보세요.</h2></div><a href="#public-counseling" class="public-result__button">상담 신청하기 ↗</a></aside>

    <section class="public-result__section" aria-labelledby="public-faculty-title">
      <header class="public-result__section-head"><div><p class="public-result__eyebrow">03 / PEOPLE</p><h2 id="public-faculty-title">함께 방향을 찾아갈 교수진</h2></div><a href="https://gjuphoto.com/faculty/" target="_blank" rel="noopener noreferrer">교수진 소개 ↗</a></header>
      <div class="public-result__faculty-list"><article v-for="person in faculty" :key="person.id" class="public-result__faculty" :data-public-faculty="person.role"><img v-if="departmentFacultyImages[person.name]" :src="departmentFacultyImages[person.name]" :alt="`${person.name} ${person.title}`" width="96" height="120" loading="lazy"><div><span class="public-result__eyebrow">{{ person.role === 'primary' ? '추천 총괄교수' : '함께 살펴볼 전임교수' }}</span><h3>{{ person.name }} <small>{{ person.title }}</small></h3><p>{{ person.expertise }}</p></div></article></div>
      <div v-if="specialists.length" class="public-result__specialists"><article v-for="person in specialists" :key="person.id" data-public-specialist><img v-if="departmentFacultyImages[person.name]" :src="departmentFacultyImages[person.name]" :alt="`${person.name} ${person.title}`" width="48" height="60" loading="lazy"><div><small>실무·창작 연계</small><h3>{{ person.name }} <small>{{ person.title }}</small></h3><p>{{ person.expertise }}</p></div></article></div>
      <p class="public-result__fine">관심사 기반 상담 추천이며, 실제 담당 교수는 상담 접수 후 최종 안내합니다.</p>
    </section>

    <section class="public-result__section" aria-labelledby="public-alumni-title">
      <header class="public-result__section-head"><div><p class="public-result__eyebrow">04 / AFTER DPIM</p><h2 id="public-alumni-title">먼저 시작한 선배들의 다음 장면</h2></div><a href="https://gjuphoto.com/alumni/" target="_blank" rel="noopener noreferrer">졸업생 이야기 ↗</a></header>
      <div class="public-result__alumni"><a v-for="person in story.alumni" :key="person.name" :href="person.href" target="_blank" rel="noopener noreferrer" data-homepage-alumnus><img :src="person.image" :alt="person.alt" width="180" height="180" loading="lazy" decoding="async"><div><p>{{ person.role }}</p><h3>{{ person.name }}</h3><span>인터뷰 읽기 ↗</span></div></a></div>
      <p class="public-result__fine">{{ story.title }}에서 함께 살펴볼 실제 졸업생 사례입니다. 각자의 경험을 인터뷰로 확인해 보세요.</p>
    </section>

    <div class="public-result__extras">
      <details class="public-result__fold"><summary>작업을 뒷받침하는 공간과 장비</summary><div class="public-result__support"><div><h3>학과 공간</h3><ul><li v-for="item in snapshot.resources.facility" :key="item.id">{{ item.title }}</li></ul><a href="https://gjuphoto.com/facilities/" target="_blank" rel="noopener noreferrer">공간 사진과 시설 안내 ↗</a></div><div><h3>연결 기자재</h3><ul><li v-for="item in snapshot.resources.equipment" :key="item.id">{{ item.title }}</li></ul><span class="public-result__fine">이용 가능 여부와 절차는 학과에 확인해 주세요.</span></div></div></details>
      <details class="public-result__fold" data-recommendation-details><summary>나의 선택과 추천 근거 자세히 보기</summary><div class="public-result__reason"><div class="public-result__interest-tags"><span v-for="interest in snapshot.selectedInterests" :key="interest.key">{{ interest.label }}</span></div><TrackScore :scores="snapshot.trackScores" :environment-score="snapshot.environmentScore" /><div v-for="person in [...faculty, ...specialists]" :key="person.id"><h3>{{ person.name }} {{ person.title }}</h3><p>{{ person.reason }}</p></div></div></details>
    </div>
    <section class="public-result__section"><slot name="counseling" /></section>
  </article>
</template>

<style scoped>
.public-result { width: min(100% - 4rem, 1216px); margin: 2.5rem auto 4rem; scroll-margin-top: 1rem; word-break: keep-all; overflow-wrap: anywhere; }
.public-result h1, .public-result h2, .public-result h3, .public-result h4 { color: var(--color-ink); letter-spacing: -.035em; }
.public-result h1 { font-size: clamp(1.75rem, 4vw, 2rem); line-height: 1.3; margin: 1.25rem 0; text-wrap: balance; }
.public-result h2 { font-size: clamp(1.3rem, 2.5vw, 1.65rem); line-height: 1.4; margin: .6rem 0 0; }
.public-result h3 { font-size: 1.05rem; line-height: 1.5; margin: .4rem 0; }
.public-result p { line-height: 1.7; color: var(--color-muted); }
.public-result a { color: inherit; text-decoration: none; }
.public-result a:hover { color: #fff; }
.public-result a:focus-visible, .public-result summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 5px; }
.public-result__eyebrow { font: 600 .65rem var(--font-mono); letter-spacing: .1em; color: var(--color-muted); }
.public-result__fine { display: block; font-size: .72rem; line-height: 1.7; color: var(--color-muted); }
.public-result__hero { display: grid; grid-template-columns: 1fr 1.15fr; align-items: center; gap: 2.5rem; padding: 1.5rem; background: var(--color-surface); border: 1px solid var(--department-border); border-radius: 1.5rem; }
.public-result__hero-copy { padding: 1rem; }
.public-result__hero-copy > p:not(.public-result__eyebrow) { font-size: .95rem; }
.public-result__hero-image { display: block; min-width: 0; }
.public-result__hero-image img { width: 100%; height: 320px; object-fit: contain; display: block; background: #08080b; border-radius: 1rem; }
.public-result__hero-image > span { display: flex; justify-content: space-between; font-size: .68rem; color: var(--color-muted); padding: .65rem .2rem 0; }
.public-result__actions { display: flex; align-items: center; gap: 1.25rem; margin: 1.5rem 0 1rem; font-size: .8rem; }
.public-result .public-result__button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: .8rem 1.2rem; border-radius: .875rem; background: var(--color-primary); color: var(--color-canvas); font-size: .8rem; font-weight: 750; }
.public-result .public-result__button:hover { background: #dfdfe9; }
.public-result__section { margin-top: 4rem; scroll-margin-top: 2rem; }
.public-result__section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
.public-result__section-head p { margin: 0; }
.public-result__section-head > a { flex-shrink: 0; font-size: .75rem; color: var(--color-muted); padding: .5rem 0; }
.public-result__years { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; align-items: start; }
.public-result__year { border-top: 2px solid var(--color-primary); border-radius: 1rem; background: var(--color-surface); padding: 1.25rem; min-width: 0; }
.public-result__year-number { display: block; font: 500 2.25rem var(--font-mono); color: var(--color-muted); margin-bottom: 1.5rem; }
.public-result__year h3 { display: grid; font-size: 1rem; }
.public-result__year h3 span { font-size: .72rem; font-weight: 500; color: var(--color-muted); letter-spacing: 0; margin-top: .4rem; }
.public-result__courses { list-style: none; padding: 0; margin: 1.25rem 0; }
.public-result__courses li { border-top: 1px solid var(--department-border); padding: .75rem 0; font-size: .8rem; font-weight: 650; line-height: 1.65; overflow-wrap: anywhere; }
.public-result__courses small { display: inline-block; border: 1px solid var(--department-border); border-radius: 999px; color: var(--color-muted); padding: .1rem .4rem; margin: .2rem 0 .1rem .35rem; font-size: .6rem; white-space: nowrap; }
.public-result summary { cursor: pointer; line-height: 1.6; }
.public-result__course-detail { font-size: .72rem; color: var(--color-muted); }
.public-result__course-detail summary { padding: .4rem 0; }
.public-result__course-detail h4 { font-size: .8rem; margin: 1rem 0 .35rem; }
.public-result__course-detail p { font-size: .75rem; margin: .4rem 0; }
.public-result__stories { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem; }
.public-result__story { overflow: hidden; background: var(--color-surface); border: 1px solid var(--department-border); border-radius: 1.25rem; }
.public-result__story > img { display: block; width: 100%; aspect-ratio: 3 / 2; height: auto; object-fit: contain; background: #08080b; }
.public-result__story-copy { padding: 1.3rem; }
.public-result__story-copy h3 { display: flex; justify-content: space-between; gap: 1rem; margin: .85rem 0 .4rem; }
.public-result__story-copy p { margin: 0; font-size: .8rem; }
.public-result__meta { display: flex; align-items: center; justify-content: space-between; gap: .6rem; font-size: .65rem; color: var(--color-muted); }
.public-result__meta > span { border: 1px solid var(--department-border); border-radius: 999px; padding: .25rem .65rem; }
.public-result__mid { display: flex; justify-content: space-between; align-items: center; gap: 2rem; margin-top: 3rem; padding: 2rem; border: 1px solid var(--department-border); border-radius: 1.25rem; background: linear-gradient(105deg, #20202c, #101015); }
.public-result__mid h2 { font-size: 1.25rem; }
.public-result__faculty-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.public-result__faculty { display: flex; align-items: center; gap: 1.25rem; padding: 1.25rem; border: 1px solid var(--department-border); border-radius: 1rem; background: var(--color-surface); }
.public-result__faculty img { width: 80px; height: 100px; flex-shrink: 0; object-fit: contain; border-radius: .75rem; }
.public-result__faculty p { font-size: .78rem; margin: .25rem 0; }
.public-result__faculty h3 { font-size: 1.15rem; }
.public-result__faculty h3 small { font-size: .75rem; font-weight: 500; }
.public-result__specialists { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: 1rem; }
.public-result__specialists article { display: flex; gap: .8rem; align-items: center; padding: .85rem 1rem; border: 1px solid var(--department-border); border-radius: .875rem; }
.public-result__specialists img { flex-shrink: 0; width: 40px; height: 50px; object-fit: contain; border-radius: .625rem; }
.public-result__specialists h3 { font-size: .85rem; margin: .15rem 0; }
.public-result__specialists small, .public-result__specialists p { color: var(--color-muted); font-size: .65rem; margin: 0; }
.public-result__alumni { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem; }
.public-result__alumni a { display: flex; gap: 1.25rem; align-items: center; border: 1px solid var(--department-border); border-radius: 1rem; padding: 1rem; background: var(--color-surface); }
.public-result__alumni img { width: 120px; height: 150px; object-fit: contain; background: #08080b; border-radius: .75rem; flex-shrink: 0; }
.public-result__alumni p { font-size: .72rem; margin: 0; }
.public-result__alumni span { display: block; margin-top: 1rem; font-size: .7rem; color: var(--color-muted); }
.public-result__extras { margin-top: 3rem; }
.public-result__fold { border: 1px solid var(--department-border); border-radius: 1rem; padding: 1rem 1.25rem; margin-top: .75rem; }
.public-result__fold > summary { font-size: .85rem; font-weight: 600; }
.public-result__project-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.25rem; padding-top: 1rem; }
.public-result__project-list h3 { font-size: .9rem; }
.public-result__project-list p, .public-result__project-list small { font-size: .72rem; color: var(--color-muted); }
.public-result__support { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5rem; padding-top: 1rem; }
.public-result__support ul { padding-left: 1.2rem; font-size: .8rem; line-height: 1.9; color: var(--color-muted); }
.public-result__support a { font-size: .75rem; text-decoration: underline; }
.public-result__reason { display: grid; gap: 1.5rem; padding: 1.5rem 0 .5rem; }
.public-result__reason p { font-size: .8rem; margin: .3rem 0; }
.public-result__interest-tags { display: flex; flex-wrap: wrap; gap: .5rem; }
.public-result__interest-tags span { font-size: .7rem; padding: .4rem .75rem; border: 1px solid var(--department-border); border-radius: 999px; }
@media (max-width: 1000px) { .public-result__hero { gap: 1rem; } .public-result__years { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) {
  .public-result { width: calc(100% - 2rem); margin-top: 1rem; }
  .public-result__hero { grid-template-columns: 1fr; padding: 1rem; gap: 1rem; }
  .public-result__hero-copy { padding: .5rem; }
  .public-result__hero-image img { height: auto; max-height: 320px; }
  .public-result__section { margin-top: 2.5rem; }
  .public-result__section-head { display: block; }
  .public-result__section-head > a { display: inline-block; margin-top: .5rem; }
  .public-result__years { gap: .75rem; }
  .public-result__year { padding: 1rem; }
  .public-result__year-number { font-size: 1.65rem; margin-bottom: .8rem; }
  .public-result__stories, .public-result__faculty-list, .public-result__alumni, .public-result__project-list, .public-result__support { grid-template-columns: 1fr; }
  .public-result__mid { padding: 1.5rem; display: grid; gap: 1.25rem; }
  .public-result__specialists { grid-template-columns: 1fr; gap: .6rem; }
  .public-result__alumni img { width: 96px; height: 120px; }
}
@media (max-width: 380px) { .public-result__years { grid-template-columns: 1fr; } .public-result__actions { gap: .85rem; } }
</style>
