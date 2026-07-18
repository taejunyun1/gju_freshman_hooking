<script setup lang="ts">
import { z } from 'zod'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import {
  adminCampaignListItemSchema,
  adminCampaignSchema,
  campaignChannels,
  campaignCreateSchema,
  campaignStatuses,
  type AdminCampaign,
} from '../../../shared/schemas/admin'
import type { ApiSuccess } from '../../../shared/types/api'
import CampaignAttributionStrip from '../../components/admin/CampaignAttributionStrip.vue'
import AppState from '../../components/common/AppState.vue'
import { useAdminSessionStore } from '../../stores/admin-session'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const route = useRoute()
const router = useRouter()
const requestUrl = useRequestURL()
const adminSession = useAdminSessionStore()
const items = ref<AdminCampaign[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const listError = ref('')
const queryText = ref('')
const creating = ref(false)
const createError = ref('')
const mutationMessage = ref('')
const copyMessage = ref('')
const confirmingArchiveId = ref<number | null>(null)
const archivingIds = ref<Set<number>>(new Set())
const copying = ref(false)
let active = true
let listVersion = 0
let createVersion = 0
let copyVersion = 0
let sharedMutationVersion = 0
const archiveVersions = new Map<number, number>()
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let stopRouteWatch: (() => void) | undefined
let stopQueryWatch: (() => void) | undefined
let archiveTrigger: HTMLButtonElement | null = null
let archiveHost: Element | null = null

const listSchema = z.object({
  items: z.array(adminCampaignListItemSchema).max(50),
  nextCursor: z.string().min(1).max(200).nullable(),
}).strict()
const mutationSchema = z.object({ campaign: adminCampaignSchema }).strict()

const channelLabels: Record<typeof campaignChannels[number], string> = {
  sms: '문자',
  qr: 'QR',
  social: '소셜',
  kakao: '카카오',
  direct: '직접',
  other: '기타',
}
const statusLabels: Record<typeof campaignStatuses[number], string> = {
  draft: '초안',
  active: '운영',
  archived: '보관',
}
const form = reactive({
  name: '',
  code: '',
  channel: 'qr' as typeof campaignChannels[number],
  status: 'draft' as 'draft' | 'active',
  startsAt: '',
  endsAt: '',
  sentCount: 0,
})
const mutationBusy = computed(() => creating.value || archivingIds.value.size > 0)

const hasControlCharacters = (value: string): boolean => [...value].some((character) => {
  const point = character.codePointAt(0) ?? 0
  return point <= 0x1F || (point >= 0x7F && point <= 0x9F)
})
const routeString = (key: string): string => {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}
const allowedFilter = (key: 'query' | 'status' | 'channel' | 'limit', value: string): string => {
  if (!value || value !== value.trim() || hasControlCharacters(value)) return ''
  if (key === 'query') return value.length <= 100 ? value : ''
  if (key === 'status') return campaignStatuses.includes(value as typeof campaignStatuses[number]) ? value : ''
  if (key === 'channel') return campaignChannels.includes(value as typeof campaignChannels[number]) ? value : ''
  return /^(?:[1-9]|[1-4][0-9]|50)$/u.test(value) ? value : ''
}
const cursorValue = (): string => {
  const value = routeString('cursor')
  return value.length <= 200 && value === value.trim() && !hasControlCharacters(value) ? value : ''
}
const apiQuery = (): Record<string, string> => {
  const query: Record<string, string> = {}
  for (const key of ['query', 'status', 'channel', 'limit'] as const) {
    const value = allowedFilter(key, routeString(key))
    if (value) query[key] = value
  }
  if (!query.limit) query.limit = '20'
  const cursor = cursorValue()
  if (cursor) query.cursor = cursor
  return query
}
const safeListUrl = computed(() => {
  const fallback = '/admin/campaigns'
  if (typeof route.fullPath !== 'string' || route.fullPath.length > 2_000 || hasControlCharacters(route.fullPath)) {
    return fallback
  }
  try {
    const parsed = new URL(route.fullPath, 'https://photo-next.invalid')
    return parsed.origin === 'https://photo-next.invalid' && parsed.pathname === fallback
      ? `${parsed.pathname}${parsed.search}`
      : fallback
  }
  catch { return fallback }
})
const nextTarget = computed(() => nextCursor.value
  ? { path: '/admin/campaigns', query: { ...apiQuery(), cursor: nextCursor.value } }
  : null)

const errorCode = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return ''
  if ('message' in error && (error as { message?: unknown }).message === 'ADMIN_SESSION_REQUIRED') {
    return 'ADMIN_SESSION_REQUIRED'
  }
  const data = (error as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return ''
  const failure = (data as { error?: unknown }).error
  if (typeof failure !== 'object' || failure === null) return ''
  return typeof (failure as { code?: unknown }).code === 'string' ? (failure as { code: string }).code : ''
}
const recoverAuthentication = async (error: unknown): Promise<boolean> => {
  if (!['ADMIN_REQUIRED', 'MFA_REQUIRED', 'REAUTH_REQUIRED', 'ADMIN_SESSION_REQUIRED'].includes(errorCode(error))) return false
  adminSession.clear()
  await navigateTo({
    path: '/admin/login',
    query: { redirect: safeListUrl.value },
  }, { replace: true })
  return true
}

const loadCampaigns = async (): Promise<void> => {
  const version = ++listVersion
  loading.value = true
  listError.value = ''
  try {
    const response = await $fetch<ApiSuccess<unknown>>('/api/admin/campaigns', {
      headers: adminSession.authorizationHeaders(),
      query: apiQuery(),
    })
    if (!active || version !== listVersion) return
    const parsed = listSchema.parse(response.data)
    items.value = parsed.items
    nextCursor.value = parsed.nextCursor
  }
  catch (error) {
    if (!active || version !== listVersion) return
    items.value = []
    nextCursor.value = null
    if (!await recoverAuthentication(error)) {
      listError.value = '캠페인 목록을 불러오지 못했습니다. 세션과 필터를 확인한 뒤 다시 시도하세요.'
    }
  }
  finally {
    if (active && version === listVersion) loading.value = false
  }
}

const replaceFilter = async (key: 'query' | 'status' | 'channel', value: string): Promise<void> => {
  const query = Object.fromEntries(Object.entries(apiQuery()).filter(([entryKey]) => (
    entryKey !== 'cursor' && entryKey !== key
  )))
  const allowed = allowedFilter(key, value.trim())
  if (allowed) query[key] = allowed
  await router.replace({ path: '/admin/campaigns', query })
}
const filterChanged = (key: 'status' | 'channel', event: Event) => {
  void replaceFilter(key, (event.target as HTMLSelectElement).value)
}
const localDateTimeToIso = (value: string): string | null => {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : value
}
const createBody = () => ({
  code: form.code,
  name: form.name,
  channel: form.channel,
  status: form.status,
  startsAt: localDateTimeToIso(form.startsAt),
  endsAt: localDateTimeToIso(form.endsAt),
  sentCount: Number(form.sentCount),
})
const resetCreateForm = () => {
  form.name = ''
  form.code = ''
  form.channel = 'qr'
  form.status = 'draft'
  form.startsAt = ''
  form.endsAt = ''
  form.sentCount = 0
}
const createCampaign = async (): Promise<void> => {
  if (mutationBusy.value) return
  const body = createBody()
  if (!campaignCreateSchema.safeParse(body).success) {
    createError.value = '이름, 코드, 기간과 발송 수를 다시 확인해 주세요.'
    return
  }
  const version = ++createVersion
  const sharedVersion = ++sharedMutationVersion
  const requestRoute = route.fullPath
  creating.value = true
  createError.value = ''
  mutationMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<unknown>>('/api/admin/campaigns', {
      method: 'POST',
      headers: adminSession.authorizationHeaders(),
      body,
    })
    if (!active || version !== createVersion) return
    const parsed = mutationSchema.parse(response.data)
    if (sharedVersion !== sharedMutationVersion) return
    if (requestRoute === route.fullPath) {
      resetCreateForm()
      mutationMessage.value = `캠페인 ${parsed.campaign.code} 링크를 만들었습니다.`
    }
    await loadCampaigns()
  }
  catch (error) {
    if (!active || version !== createVersion) return
    if (!await recoverAuthentication(error)
      && requestRoute === route.fullPath
      && sharedVersion === sharedMutationVersion) {
      createError.value = errorCode(error) === 'CAMPAIGN_CONFLICT'
        ? '이미 사용 중인 코드입니다. 다른 코드를 입력해 주세요.'
        : '캠페인 링크를 만들지 못했습니다. 입력 내용을 확인한 뒤 다시 시도하세요.'
    }
  }
  finally {
    if (active && version === createVersion) creating.value = false
  }
}

const setArchiveBusy = (id: number, busy: boolean) => {
  const next = new Set(archivingIds.value)
  if (busy) next.add(id)
  else next.delete(id)
  archivingIds.value = next
}
const requestArchive = (campaign: AdminCampaign, event: Event) => {
  if (campaign.status === 'archived' || mutationBusy.value) return
  confirmingArchiveId.value = campaign.id
  archiveTrigger = event.currentTarget as HTMLButtonElement
  archiveHost = archiveTrigger.closest('[data-campaign-entry]')
  void nextTick(() => archiveHost?.querySelector<HTMLButtonElement>('[data-action="confirm-archive"]')?.focus())
}
const restoreArchiveFocus = () => {
  const trigger = archiveTrigger
  archiveTrigger = null
  archiveHost = null
  void nextTick(() => trigger?.focus())
}
const cancelArchive = (id: number) => {
  if (confirmingArchiveId.value !== id || mutationBusy.value) return
  confirmingArchiveId.value = null
  restoreArchiveFocus()
}
const archiveCampaign = async (campaign: AdminCampaign): Promise<void> => {
  if (campaign.status === 'archived' || mutationBusy.value) return
  const version = (archiveVersions.get(campaign.id) ?? 0) + 1
  const sharedVersion = ++sharedMutationVersion
  const requestRoute = route.fullPath
  archiveVersions.set(campaign.id, version)
  setArchiveBusy(campaign.id, true)
  mutationMessage.value = ''
  try {
    const response = await $fetch<ApiSuccess<unknown>>(`/api/admin/campaigns/${campaign.id}/archive`, {
      method: 'POST',
      headers: adminSession.authorizationHeaders(),
      body: { expectedUpdatedAt: campaign.updatedAt },
    })
    if (!active || archiveVersions.get(campaign.id) !== version) return
    const parsed = mutationSchema.parse(response.data)
    if (parsed.campaign.id !== campaign.id) throw new Error('CAMPAIGN_ENDPOINT_MISMATCH')
    if (sharedVersion !== sharedMutationVersion) return
    const currentIndex = items.value.findIndex(item => item.id === campaign.id)
    if (requestRoute === route.fullPath && currentIndex >= 0) {
      const currentMetrics = items.value[currentIndex]!.metrics
      const accepted = adminCampaignListItemSchema.parse({
        ...parsed.campaign,
        metrics: currentMetrics,
      })
      items.value = items.value.map(item => item.id === campaign.id ? accepted : item)
      listVersion += 1
      loading.value = false
      mutationMessage.value = `${parsed.campaign.name} 캠페인을 보관했습니다. 기존 기여 기록은 유지됩니다.`
    }
    else {
      await loadCampaigns()
    }
    confirmingArchiveId.value = null
    setArchiveBusy(campaign.id, false)
    restoreArchiveFocus()
  }
  catch (error) {
    if (!active || archiveVersions.get(campaign.id) !== version) return
    if (!await recoverAuthentication(error)
      && requestRoute === route.fullPath
      && sharedVersion === sharedMutationVersion) {
      mutationMessage.value = errorCode(error) === 'CAMPAIGN_CONFLICT'
        ? '다른 관리자가 캠페인을 변경했습니다. 목록을 새로고침한 뒤 다시 시도하세요.'
        : '캠페인을 보관하지 못했습니다. 목록을 새로고침한 뒤 다시 시도하세요.'
    }
  }
  finally {
    if (active && archiveVersions.get(campaign.id) === version) setArchiveBusy(campaign.id, false)
  }
}

const attributionUrl = (code: string): string => new URL(
  `/api/campaign/${encodeURIComponent(code)}`,
  requestUrl.origin,
).toString()
const copyLink = async (campaign: AdminCampaign): Promise<void> => {
  if (copying.value) return
  const version = ++copyVersion
  copying.value = true
  copyMessage.value = ''
  const url = attributionUrl(campaign.code)
  try {
    if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE')
    await navigator.clipboard.writeText(url)
    if (!active || version !== copyVersion) return
    copyMessage.value = `${campaign.name} 링크를 복사했습니다.`
  }
  catch {
    if (!active || version !== copyVersion) return
    copyMessage.value = '복사하지 못했습니다. 표시된 URL을 직접 선택해 복사해 주세요.'
  }
  finally {
    if (active && version === copyVersion) copying.value = false
  }
}

const formatTimestamp = (value: string): string => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'short',
  timeStyle: 'short',
  hour12: false,
}).format(new Date(value))
const periodLabel = (campaign: AdminCampaign): string => {
  if (!campaign.startsAt && !campaign.endsAt) return '기간 제한 없음'
  return `${campaign.startsAt ? formatTimestamp(campaign.startsAt) : '즉시 시작'} — ${campaign.endsAt ? formatTimestamp(campaign.endsAt) : '종료 없음'}`
}

onMounted(() => {
  stopQueryWatch = watch(queryText, (value) => {
    if (value === allowedFilter('query', routeString('query'))) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => { void replaceFilter('query', value) }, 350)
  })
  stopRouteWatch = watch(() => route.fullPath, () => {
    const value = allowedFilter('query', routeString('query'))
    if (queryText.value !== value) queryText.value = value
    void loadCampaigns()
  }, { immediate: true })
})

onBeforeUnmount(() => {
  active = false
  listVersion += 1
  createVersion += 1
  copyVersion += 1
  sharedMutationVersion += 1
  archiveVersions.clear()
  if (debounceTimer) clearTimeout(debounceTimer)
  stopQueryWatch?.()
  stopRouteWatch?.()
})
</script>

<template>
  <section class="campaigns-page" aria-labelledby="campaigns-title">
    <header class="campaigns-page__header">
      <div>
        <p class="campaigns-page__eyebrow">ATTRIBUTION LEDGER / CAMPAIGN LINKS</p>
        <h1 id="campaigns-title">캠페인 운영</h1>
        <p>입시 안내 링크를 만들고, 기록된 기여 흐름과 운영 상태를 검토합니다.</p>
      </div>
      <button type="button" data-action="refresh" :disabled="loading" @click="loadCampaigns">새로고침</button>
    </header>

    <form class="campaigns-page__maker" data-link-maker aria-labelledby="link-maker-title" @submit.prevent="createCampaign">
      <div class="campaigns-page__maker-intro">
        <p>LINK MAKER</p>
        <div>
          <h2 id="link-maker-title">기여 링크 만들기</h2>
          <p>입력한 코드는 영문 소문자 주소로 정리되며, 만든 뒤에는 바꿀 수 없습니다.</p>
        </div>
      </div>
      <fieldset class="campaigns-page__maker-fields" data-create-fields :disabled="mutationBusy">
        <label>캠페인 이름 <input v-model="form.name" name="name" maxlength="100" required></label>
        <label>링크 코드 <input v-model="form.code" name="code" maxlength="200" placeholder="OPEN DAY 2026" required></label>
        <label>채널
          <select v-model="form.channel" name="channel">
            <option v-for="channel in campaignChannels" :key="channel" :value="channel">{{ channelLabels[channel] }}</option>
          </select>
        </label>
        <label>상태
          <select v-model="form.status" name="status">
            <option value="draft">초안</option>
            <option value="active">운영</option>
          </select>
        </label>
        <label>시작 시각 <input v-model="form.startsAt" name="startsAt" type="datetime-local" step="1"></label>
        <label>종료 시각 <input v-model="form.endsAt" name="endsAt" type="datetime-local" step="1"></label>
        <label>발송 수 <input v-model.number="form.sentCount" name="sentCount" type="number" min="0" max="2147483647"></label>
        <button class="campaigns-page__create" type="submit" :disabled="mutationBusy">{{ creating ? '만드는 중' : '캠페인 링크 만들기' }}</button>
      </fieldset>
      <p v-if="createError" class="campaigns-page__inline-error" role="alert">{{ createError }}</p>
    </form>

    <form class="campaigns-page__filters" aria-label="캠페인 목록 필터" @submit.prevent>
      <label class="campaigns-page__query">검색
        <input v-model="queryText" name="queryFilter" type="search" maxlength="100" placeholder="이름이나 코드">
      </label>
      <label>상태
        <select :value="allowedFilter('status', routeString('status'))" name="statusFilter" @change="filterChanged('status', $event)">
          <option value="">전체</option>
          <option v-for="status in campaignStatuses" :key="status" :value="status">{{ statusLabels[status] }}</option>
        </select>
      </label>
      <label>채널
        <select :value="allowedFilter('channel', routeString('channel'))" name="channelFilter" @change="filterChanged('channel', $event)">
          <option value="">전체</option>
          <option v-for="channel in campaignChannels" :key="channel" :value="channel">{{ channelLabels[channel] }}</option>
        </select>
      </label>
    </form>

    <div class="campaigns-page__live" aria-live="polite" aria-atomic="true">
      <p>현재 페이지 {{ items.length }}개</p>
      <p data-live="mutation">{{ mutationMessage }}</p>
      <p data-live="copy">{{ copyMessage }}</p>
    </div>

    <AppState v-if="loading" variant="loading" message="캠페인 링크와 기여 상태를 확인하고 있습니다." />
    <div v-else-if="listError" class="campaigns-page__state">
      <AppState variant="error" :message="listError" />
      <button type="button" data-action="retry" @click="loadCampaigns">다시 시도</button>
    </div>
    <AppState v-else-if="items.length === 0" variant="empty" message="조건에 맞는 캠페인이 없습니다. 필터를 조정하거나 새 링크를 만드세요." />
    <template v-else>
      <div class="campaigns-page__table-wrap">
        <table aria-label="캠페인 운영 목록">
          <thead>
            <tr><th scope="col">캠페인</th><th scope="col">배포 링크</th><th scope="col">기여 흐름</th><th scope="col">운영 기록</th></tr>
          </thead>
          <tbody>
            <tr v-for="campaign in items" :key="campaign.id" data-campaign-entry>
              <th scope="row">
                <strong>{{ campaign.name }}</strong>
                <code>{{ campaign.code }}</code>
                <span>{{ statusLabels[campaign.status] }} · {{ channelLabels[campaign.channel] }}</span>
                <small>{{ periodLabel(campaign) }}</small>
              </th>
              <td>
                <span class="campaigns-page__cell-label">QR 제작용 URL</span>
                <code data-campaign-url tabindex="0">{{ attributionUrl(campaign.code) }}</code>
                <button type="button" data-action="copy-link" :disabled="copying" @click="copyLink(campaign)">링크 복사</button>
              </td>
              <td><CampaignAttributionStrip :metrics="campaign.metrics" :sent-count="campaign.sentCount" /></td>
              <td>
                <dl>
                  <div><dt>생성</dt><dd><time :datetime="campaign.createdAt">{{ formatTimestamp(campaign.createdAt) }}</time></dd></div>
                  <div><dt>수정</dt><dd><time :datetime="campaign.updatedAt">{{ formatTimestamp(campaign.updatedAt) }}</time></dd></div>
                </dl>
                <button type="button" data-action="request-archive" :aria-disabled="campaign.status === 'archived'" :disabled="mutationBusy" @click="requestArchive(campaign, $event)">{{ campaign.status === 'archived' ? '보관됨' : '보관' }}</button>
                <div v-if="confirmingArchiveId === campaign.id" class="campaigns-page__confirm" role="group" aria-label="캠페인 보관 확인">
                  <p>새 링크 기여는 중단되지만 기존 기록은 유지됩니다.</p>
                  <button type="button" data-action="confirm-archive" :disabled="mutationBusy" @click="archiveCampaign(campaign)">보관 확인</button>
                  <button type="button" :disabled="mutationBusy" @click="cancelArchive(campaign.id)">취소</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="campaigns-page__cards" aria-label="모바일 캠페인 운영 목록">
        <article v-for="campaign in items" :key="campaign.id" data-campaign-card data-campaign-entry>
          <section data-card-section="identity">
            <p>{{ statusLabels[campaign.status] }} · {{ channelLabels[campaign.channel] }}</p>
            <h2>{{ campaign.name }}</h2>
            <code>{{ campaign.code }}</code>
            <small>{{ periodLabel(campaign) }}</small>
          </section>
          <section data-card-section="url">
            <h3>QR 제작용 URL</h3>
            <code data-campaign-url tabindex="0">{{ attributionUrl(campaign.code) }}</code>
            <button type="button" data-action="copy-link" :disabled="copying" @click="copyLink(campaign)">링크 복사</button>
          </section>
          <section data-card-section="attribution">
            <h3>기여 흐름</h3>
            <CampaignAttributionStrip :metrics="campaign.metrics" :sent-count="campaign.sentCount" />
          </section>
          <section data-card-section="lifecycle">
            <h3>운영 기록</h3>
            <dl>
              <div><dt>생성</dt><dd><time :datetime="campaign.createdAt">{{ formatTimestamp(campaign.createdAt) }}</time></dd></div>
              <div><dt>수정</dt><dd><time :datetime="campaign.updatedAt">{{ formatTimestamp(campaign.updatedAt) }}</time></dd></div>
            </dl>
            <button type="button" data-action="request-archive" :aria-disabled="campaign.status === 'archived'" :disabled="mutationBusy" @click="requestArchive(campaign, $event)">{{ campaign.status === 'archived' ? '보관됨' : '보관' }}</button>
            <div v-if="confirmingArchiveId === campaign.id" class="campaigns-page__confirm" role="group" aria-label="캠페인 보관 확인">
              <p>새 링크 기여는 중단되지만 기존 기록은 유지됩니다.</p>
              <button type="button" data-action="confirm-archive" :disabled="mutationBusy" @click="archiveCampaign(campaign)">보관 확인</button>
              <button type="button" :disabled="mutationBusy" @click="cancelArchive(campaign.id)">취소</button>
            </div>
          </section>
        </article>
      </div>

      <nav v-if="nextTarget" class="campaigns-page__pagination" aria-label="캠페인 목록 페이지">
        <NuxtLink data-next-page :to="nextTarget">다음 캠페인 보기</NuxtLink>
      </nav>
    </template>
  </section>
</template>

<style scoped>
.campaigns-page { min-width: 0; display: grid; gap: 1.25rem; }
.campaigns-page__header { min-width: 0; display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 1rem; }
.campaigns-page__header > div { max-width: 54rem; }
.campaigns-page__eyebrow,
.campaigns-page__maker-intro > p { margin: 0 0 0.625rem; color: var(--color-sequence); font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.08em; }
.campaigns-page h1 { margin: 0; font-family: var(--font-display); font-size: clamp(1.75rem, 4vw, 2rem); letter-spacing: -0.05em; }
.campaigns-page__header p:last-child { margin: 0.75rem 0 0; color: color-mix(in srgb, var(--color-ink) 68%, transparent); }
.campaigns-page :is(input, select, button) { min-height: var(--touch-target); border: 1px solid color-mix(in srgb, var(--color-ink) 30%, transparent); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-ink); padding: 0.625rem; }
.campaigns-page button { cursor: pointer; font-family: var(--font-display); font-weight: 700; }
.campaigns-page button:disabled { cursor: wait; opacity: 0.62; }
.campaigns-page :is(input, select, button, a, [tabindex]):focus-visible { outline: 3px solid var(--color-sequence); outline-offset: 2px; }
.campaigns-page__maker { min-width: 0; display: grid; gap: 1rem; border-top: 0.3rem solid var(--color-primary); border-radius: var(--radius-panel); background: var(--color-surface); padding: clamp(1rem, 3vw, 1.5rem); }
.campaigns-page__maker-intro { display: grid; grid-template-columns: minmax(7rem, 1fr) minmax(0, 3fr); gap: 1rem; }
.campaigns-page__maker-intro h2 { margin: 0; font-family: var(--font-display); font-size: 1.35rem; }
.campaigns-page__maker-intro p:last-child { margin: 0.35rem 0 0; color: color-mix(in srgb, var(--color-ink) 68%, transparent); }
.campaigns-page__maker-fields { min-width: 0; margin: 0; border: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem; align-items: end; }
.campaigns-page label { min-width: 0; display: grid; gap: 0.35rem; font-size: 0.8125rem; font-weight: 650; }
.campaigns-page label :is(input, select) { min-width: 0; width: 100%; }
.campaigns-page__create { border-color: var(--color-sequence) !important; background: var(--color-sequence) !important; color: var(--color-surface) !important; }
.campaigns-page__inline-error { margin: 0; color: var(--color-error); font-weight: 650; }
.campaigns-page__filters { min-width: 0; display: grid; grid-template-columns: minmax(0, 2fr) repeat(2, minmax(8rem, 1fr)); gap: 0.75rem; border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent); border-radius: var(--radius-panel); background: var(--color-surface); padding: 1rem; }
.campaigns-page__live { min-width: 0; display: flex; flex-wrap: wrap; gap: 0.4rem 1.25rem; color: color-mix(in srgb, var(--color-ink) 66%, transparent); font-family: var(--font-mono); font-size: 0.75rem; }
.campaigns-page__live p { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.campaigns-page__state { display: grid; justify-items: start; gap: 0.75rem; }
.campaigns-page__table-wrap { min-width: 0; overflow-x: auto; border: 1px solid color-mix(in srgb, var(--color-primary-strong) 14%, transparent); border-radius: var(--radius-panel); background: var(--color-surface); }
.campaigns-page table { width: 100%; min-width: 68rem; border-collapse: collapse; }
.campaigns-page :is(th, td) { border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 14%, transparent); padding: 0.85rem; text-align: left; vertical-align: top; }
.campaigns-page thead th { font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.04em; }
.campaigns-page tbody th { width: 19%; }
.campaigns-page tbody td:nth-child(2) { width: 26%; }
.campaigns-page tbody td:nth-child(3) { width: 35%; }
.campaigns-page tbody th > * { display: block; }
.campaigns-page tbody th strong { font-family: var(--font-display); font-size: 1rem; }
.campaigns-page tbody :is(code, time, small) { font-family: var(--font-mono); }
.campaigns-page code { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
.campaigns-page tbody th code { margin-top: 0.35rem; color: var(--color-sequence); }
.campaigns-page tbody th span,
.campaigns-page tbody th small { margin-top: 0.4rem; color: color-mix(in srgb, var(--color-ink) 64%, transparent); font-weight: 500; }
.campaigns-page__cell-label { display: block; margin-bottom: 0.35rem; font-size: 0.75rem; font-weight: 700; }
[data-campaign-url] { display: block; max-width: 100%; color: var(--color-resource); user-select: all; }
[data-action="copy-link"] { margin-top: 0.75rem; }
.campaigns-page dl { display: grid; gap: 0.35rem; margin: 0 0 0.75rem; }
.campaigns-page dl div { display: grid; grid-template-columns: 3rem minmax(0, 1fr); gap: 0.5rem; }
.campaigns-page dt { color: color-mix(in srgb, var(--color-ink) 60%, transparent); font-size: 0.75rem; }
.campaigns-page dd { min-width: 0; margin: 0; overflow-wrap: anywhere; font-size: 0.75rem; }
.campaigns-page__confirm { min-width: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; border: 1px solid color-mix(in srgb, var(--color-error) 28%, transparent); border-radius: var(--radius-card); background: color-mix(in srgb, var(--color-error) 6%, var(--color-surface)); padding: 0.65rem; }
.campaigns-page__confirm p { flex-basis: 100%; margin: 0; font-size: 0.75rem; }
[data-action="request-archive"],
[data-action="confirm-archive"] { border-color: var(--color-error) !important; color: var(--color-error) !important; }
[data-action="confirm-archive"] { background: var(--color-error) !important; color: var(--color-surface) !important; }
.campaigns-page__cards { display: none; }
.campaigns-page__pagination { display: flex; justify-content: flex-end; }
.campaigns-page__pagination a { min-height: var(--touch-target); display: inline-flex; align-items: center; border: 1px solid var(--color-sequence); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-sequence); padding: 0.625rem 1rem; font-weight: 700; text-decoration: none; }

@media (max-width: 63rem) {
  .campaigns-page__maker-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 44.99rem) {
  .campaigns-page__maker-intro,
  .campaigns-page__maker-fields,
  .campaigns-page__filters { grid-template-columns: minmax(0, 1fr); }
  .campaigns-page__table-wrap { display: none; }
  .campaigns-page__cards { min-width: 0; display: grid; gap: 0.9rem; }
  .campaigns-page__cards article { min-width: 0; display: grid; gap: 0; overflow: hidden; border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent); border-radius: var(--radius-card); background: var(--color-surface); }
  .campaigns-page__cards section { min-width: 0; border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent); padding: 1rem; }
  .campaigns-page__cards section:last-child { border-bottom: 0; }
  .campaigns-page__cards h2 { margin: 0.25rem 0; font-family: var(--font-display); font-size: 1.25rem; }
  .campaigns-page__cards h3 { margin: 0 0 0.6rem; font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.04em; }
  .campaigns-page__cards [data-card-section="identity"] > p { margin: 0; color: var(--color-sequence); font-size: 0.75rem; font-weight: 700; }
  .campaigns-page__cards [data-card-section="identity"] > * { display: block; }
  .campaigns-page__cards small { margin-top: 0.5rem; color: color-mix(in srgb, var(--color-ink) 64%, transparent); font-family: var(--font-mono); }
}

@media (prefers-reduced-motion: reduce) {
  .campaigns-page * { scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
}
</style>
