<script setup lang="ts">
import type { AdminStudentListItem } from '../../../shared/schemas/admin-students'

const props = defineProps<{
  items: AdminStudentListItem[]
  listUrl: string
}>()

const stageLabels = {
  high1: '고1',
  high2: '고2',
  high3: '고3',
  graduate: '고교 졸업',
  ged: '검정고시',
  other: '기타',
} as const

const regionLabels = {
  gwangju: '광주',
  jeonbuk: '전북',
  capital: '수도권',
  chungcheong: '충청권',
  gyeongsang: '경상권',
  gangwon_jeju: '강원·제주',
  overseas: '해외',
  other: '기타',
} as const

const formatStudentId = (id: number): string => `#${String(id).padStart(6, '0')}`
const formatDate = (value: string): string => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hour12: false,
}).format(new Date(value))
const hasControlCharacters = (value: string): boolean => [...value].some((character) => {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 0x1F || (codePoint >= 0x7F && codePoint <= 0x9F)
})

const safeListUrl = (): string => {
  if (props.listUrl.length > 2_000 || hasControlCharacters(props.listUrl)) {
    return '/admin/students'
  }
  try {
    const parsed = new URL(props.listUrl, 'https://photo-next.invalid')
    return parsed.origin === 'https://photo-next.invalid' && parsed.pathname === '/admin/students'
      ? `${parsed.pathname}${parsed.search}`
      : '/admin/students'
  }
  catch {
    return '/admin/students'
  }
}

const detailTarget = (studentId: number) => ({
  path: `/admin/students/${studentId}`,
  query: { returnTo: safeListUrl() },
})
</script>

<template>
  <div class="student-data">
    <div class="student-data__desktop">
      <table aria-label="학생 목록">
        <thead>
          <tr>
            <th scope="col">학생</th>
            <th scope="col">학교·학년</th>
            <th scope="col">연락처</th>
            <th scope="col">최근 활동</th>
            <th scope="col">상세</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="student in items" :key="student.id">
            <th scope="row">
              <span class="student-data__marker" data-film-edge>
                <span aria-hidden="true" class="student-data__perforation" />
                <span class="student-data__identity">
                  <span>{{ formatStudentId(student.id) }}</span>
                  <time :datetime="student.lastActiveAt">{{ formatDate(student.lastActiveAt) }}</time>
                </span>
              </span>
              <strong>{{ student.nickname }}</strong>
            </th>
            <td>
              <strong>{{ student.schoolName }}</strong>
              <span>{{ stageLabels[student.applicantStage] }}</span>
            </td>
            <td class="student-data__phone">{{ student.phone }}</td>
            <td><time :datetime="student.lastActiveAt">{{ formatDate(student.lastActiveAt) }}</time></td>
            <td><NuxtLink :to="detailTarget(student.id)">학생 보기</NuxtLink></td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul class="student-data__mobile" aria-label="학생 목록">
      <li v-for="student in items" :key="student.id" data-mobile-card>
        <article>
          <header>
            <span class="student-data__marker" data-film-edge>
              <span aria-hidden="true" class="student-data__perforation" />
              <span class="student-data__identity">
                <span>{{ formatStudentId(student.id) }}</span>
                <time :datetime="student.lastActiveAt">{{ formatDate(student.lastActiveAt) }}</time>
              </span>
            </span>
            <h2>{{ student.nickname }}</h2>
          </header>
          <dl>
            <div>
              <dt>학교·학년</dt>
              <dd>{{ student.schoolName }} · {{ stageLabels[student.applicantStage] }}</dd>
            </div>
            <div>
              <dt>연락처</dt>
              <dd class="student-data__phone">{{ student.phone }}</dd>
            </div>
            <div>
              <dt>지역</dt>
              <dd>{{ regionLabels[student.region] }}</dd>
            </div>
            <div>
              <dt>최근 활동</dt>
              <dd><time :datetime="student.lastActiveAt">{{ formatDate(student.lastActiveAt) }}</time></dd>
            </div>
          </dl>
          <NuxtLink :to="detailTarget(student.id)">학생 상세 보기</NuxtLink>
        </article>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.student-data {
  min-width: 0;
}

.student-data__desktop {
  overflow-x: auto;
  border: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
  background: var(--color-surface);
}

table {
  width: 100%;
  min-width: 58rem;
  border-collapse: collapse;
  text-align: left;
}

th,
td {
  border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent);
  padding: 0.875rem 1rem;
  vertical-align: middle;
}

thead th {
  background: color-mix(in srgb, var(--color-canvas) 70%, var(--color-surface));
  color: color-mix(in srgb, var(--color-ink) 72%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
}

tbody tr:last-child > * {
  border-bottom: 0;
}

tbody th,
tbody td:first-of-type {
  min-width: 13rem;
}

tbody th strong,
tbody td strong,
tbody td span {
  display: block;
}

tbody td span {
  margin-top: 0.2rem;
  color: color-mix(in srgb, var(--color-ink) 62%, transparent);
  font-size: 0.8125rem;
}

.student-data__marker {
  display: inline-flex;
  align-items: stretch;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
  border: 1px solid color-mix(in srgb, var(--color-ink) 26%, transparent);
  background: var(--color-ink);
  color: var(--color-surface);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 500;
  letter-spacing: 0.02em;
}

.student-data__perforation {
  width: 0.65rem;
  margin-block: 0.2rem;
  border-inline: 2px dotted var(--color-canvas);
}

.student-data__identity {
  display: flex;
  gap: 0.6rem;
  padding: 0.25rem 0.4rem 0.25rem 0;
}

.student-data__identity time {
  color: color-mix(in srgb, var(--color-surface) 68%, transparent);
}

.student-data__phone {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

a {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  color: var(--color-resource);
  font-family: var(--font-display);
  font-weight: 700;
  text-underline-offset: 0.2em;
}

a:focus-visible {
  outline: 3px solid var(--color-sequence);
  outline-offset: 3px;
}

.student-data__mobile {
  display: none;
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 44.99rem) {
  .student-data__desktop {
    display: none;
  }

  .student-data__mobile {
    display: grid;
    gap: 0.75rem;
  }

  .student-data__mobile article {
    border: 1px solid color-mix(in srgb, var(--color-ink) 16%, transparent);
    background: var(--color-surface);
    padding: 1rem;
  }

  .student-data__mobile h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.125rem;
  }

  .student-data__mobile dl {
    display: grid;
    gap: 0.625rem;
    margin: 1rem 0;
  }

  .student-data__mobile dl div {
    display: grid;
    grid-template-columns: minmax(6rem, 34%) minmax(0, 1fr);
    gap: 0.75rem;
  }

  .student-data__mobile dt {
    color: color-mix(in srgb, var(--color-ink) 60%, transparent);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
  }

  .student-data__mobile dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }
}
</style>
