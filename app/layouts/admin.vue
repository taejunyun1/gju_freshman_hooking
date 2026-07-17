<script setup lang="ts">
import { computed } from 'vue'
import { getAdminSupabaseClient } from '../utils/admin-supabase'
import { useAdminSessionStore } from '../stores/admin-session'

const adminSession = useAdminSessionStore()

const expiryLabel = computed(() => {
  const expiresAt = adminSession.session?.expiresAt
  if (!expiresAt) return '세션 없음'
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) return '세션 확인 필요'
  return `세션 만료 ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(date)}`
})

const logout = async (): Promise<void> => {
  try {
    await getAdminSupabaseClient().auth.signOut({ scope: 'local' })
  }
  finally {
    adminSession.clear()
    await navigateTo('/admin/login', { replace: true })
  }
}
</script>

<template>
  <div class="admin-shell">
    <aside class="admin-shell__rail">
      <NuxtLink
        class="admin-shell__brand"
        to="/admin"
        aria-label="PHOTO:NEXT 관리자 홈"
      >
        PHOTO:<span>NEXT</span>
        <small>OPERATIONS</small>
      </NuxtLink>

      <nav aria-label="관리자 메뉴">
        <NuxtLink to="/admin">운영 홈</NuxtLink>
        <NuxtLink to="/admin/students">학생 찾기</NuxtLink>
        <NuxtLink to="/admin/students/roster">연간 명단 관리</NuxtLink>
        <NuxtLink to="/admin/counseling">상담 운영</NuxtLink>
        <NuxtLink to="/admin/resources">학과 자원</NuxtLink>
        <NuxtLink to="/admin/faculty">교수진 운영</NuxtLink>
        <NuxtLink to="/admin/campaigns">캠페인 운영</NuxtLink>
        <NuxtLink to="/admin/export">데이터 내보내기</NuxtLink>
        <NuxtLink to="/admin/narrative-reports">AI 문장 신고</NuxtLink>
      </nav>

      <div class="admin-shell__session">
        <p>{{ expiryLabel }}</p>
        <button
          type="button"
          @click="logout"
        >
          로그아웃
        </button>
      </div>
    </aside>

    <main class="admin-shell__main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
  background: var(--color-canvas);
}

.admin-shell__rail {
  display: grid;
  gap: 1.5rem;
  background: var(--color-primary-strong);
  color: var(--color-surface);
  padding: 1rem 1.25rem;
}

.admin-shell__brand {
  min-height: var(--touch-target);
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: center;
  color: var(--color-surface);
  font-family: var(--font-display);
  font-weight: 800;
  letter-spacing: -0.04em;
  text-decoration: none;
}

.admin-shell__brand span { color: var(--color-primary); }

.admin-shell__brand small {
  flex-basis: 100%;
  margin-top: 0.15rem;
  color: color-mix(in srgb, var(--color-surface) 58%, transparent);
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 500;
  letter-spacing: 0.12em;
}

.admin-shell nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.admin-shell nav a,
.admin-shell__session button {
  min-height: var(--touch-target);
  display: inline-flex;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--color-surface) 30%, transparent);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-surface);
  padding: 0.625rem 0.75rem;
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 650;
  text-decoration: none;
}

.admin-shell nav a.router-link-exact-active {
  border-color: var(--color-primary);
  background: var(--color-primary);
}

.admin-shell__session {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
}

.admin-shell__session p {
  margin: 0;
  color: color-mix(in srgb, var(--color-surface) 70%, transparent);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}

.admin-shell__session button {
  border-color: color-mix(in srgb, var(--color-surface) 48%, transparent);
  cursor: pointer;
}

.admin-shell__brand:focus-visible,
.admin-shell nav a:focus-visible,
.admin-shell__session button:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}

.admin-shell__main {
  width: min(100% - 2.5rem, var(--admin));
  margin-inline: auto;
  padding-block: 2.5rem 4rem;
}

@media (min-width: 64rem) {
  .admin-shell {
    display: grid;
    grid-template-columns: 15rem minmax(0, 1fr);
  }

  .admin-shell__rail {
    position: sticky;
    top: 0;
    height: 100vh;
    align-content: start;
    padding: 2rem 1.5rem;
  }

  .admin-shell nav {
    display: grid;
  }

  .admin-shell__session {
    align-self: end;
  }

  .admin-shell__main {
    padding-block: 3.5rem 5rem;
  }
}
</style>
