<script setup lang="ts">
import { ref } from 'vue'
import { publicCounselingSchema, PUBLIC_COUNSELING_RECIPIENT, type PublicExploreInput } from '../../../shared/schemas/public-explore'
import { formatStudentPhoneInput } from '../../utils/student-phone-input'

const props = defineProps<{ assessment: PublicExploreInput, sent: boolean }>()
const emit = defineEmits<{ sent: [] }>()
const name = ref('')
const phone = ref('')
const question = ref('')
const consent = ref(false)
const website = ref('')
const pending = ref(false)
const error = ref('')
const submit = async () => {
  if (pending.value || props.sent) return
  error.value = ''
  const body = { ...props.assessment, name: name.value, phone: phone.value, question: question.value, consent: consent.value, website: website.value }
  if (!publicCounselingSchema.safeParse(body).success) {
    error.value = '이름, 010으로 시작하는 휴대전화 번호와 개인정보 전달 동의를 확인해 주세요.'
    return
  }
  pending.value = true
  try {
    const response = await $fetch<{ data: { sent: boolean } }>('/api/public-explore/counseling', { method: 'POST', body, retry: 0 })
    if (!response.data.sent) throw new Error('NOT_SENT')
    name.value = ''; phone.value = ''; question.value = ''; consent.value = false
    emit('sent')
  }
  catch (failure) {
    error.value = (failure as { data?: { error?: { message?: string } } }).data?.error?.message
      ?? '전송 결과를 확인하지 못했습니다. 자동 재전송하지 않았습니다. 잠시 후 다시 시도하거나 학과 이메일로 문의해 주세요.'
  }
  finally { pending.value = false }
}
const phoneInput = (event: Event) => {
  const input = event.target as HTMLInputElement
  input.value = formatStudentPhoneInput(input.value)
  phone.value = input.value
}
</script>

<template>
  <div id="public-counseling" class="public-counseling">
    <p class="public-counseling__eyebrow">NEXT / TALK TO US</p>
    <h2 id="counseling-title">내 관심 분야로 상담받기</h2>
    <p>수업, 포트폴리오, 입학 준비가 궁금한가요? 연락처를 남기면 학과에서 상담을 이어갑니다. 회원가입은 필요하지 않아요.</p>
    <div v-if="sent" role="status" class="public-counseling__success">
      상담 요청을 학과 이메일로 전달했습니다. 남겨주신 연락처로 상담을 이어갈 예정입니다.
    </div>
    <form v-else @submit.prevent="submit">
      <fieldset :disabled="pending">
        <div class="public-counseling__row">
          <label>이름 <input v-model="name" name="name" autocomplete="name" maxlength="40" required></label>
          <label>휴대전화 번호 <input :value="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="010-0000-0000" maxlength="13" required @input="phoneInput"></label>
        </div>
        <label>궁금한 점 <span>(선택)</span><textarea v-model="question" name="question" maxlength="1000" rows="3" placeholder="수업이나 포트폴리오, 입학 준비에 대해 자유롭게 남겨주세요." /></label>
        <label class="public-counseling__trap" aria-hidden="true">웹사이트<input v-model="website" tabindex="-1" autocomplete="off" name="website"></label>
        <p class="public-counseling__privacy">이름·연락처·질문·관심 분야와 추천 요약을 학과 상담 담당자({{ PUBLIC_COUNSELING_RECIPIENT }})에게 이메일로 전달합니다. 앱의 학생 DB나 브라우저 저장소에는 연락처를 저장하지 않지만, 수신 메일함에는 상담 요청이 남습니다. 삭제 요청은 학과 이메일로 문의해 주세요. 동의하지 않아도 설문과 결과를 이용할 수 있습니다.</p>
        <label class="public-counseling__consent"><input v-model="consent" type="checkbox" required>상담을 위한 위 개인정보의 학과 이메일 전달에 동의합니다.</label>
        <p v-if="error" role="alert" class="public-counseling__error">{{ error }}</p>
        <button type="submit">{{ pending ? '전송 중…' : '학과에 상담 요청 보내기' }}</button>
      </fieldset>
    </form>
    <a :href="`mailto:${PUBLIC_COUNSELING_RECIPIENT}`" class="public-counseling__email">이메일로 직접 문의하기 ↗</a>
  </div>
</template>

<style scoped>
.public-counseling { padding: clamp(1.25rem, 4vw, 2.5rem); border: 1px solid var(--color-primary); border-radius: var(--radius-panel); background: white; scroll-margin-top: 1rem; }
.public-counseling__eyebrow { color: var(--color-primary); font: 700 .7rem var(--font-mono); letter-spacing: .08em; }
h2 { font-size: clamp(1.4rem, 3vw, 2rem); margin: .8rem 0; }
p { line-height: 1.7; color: var(--color-muted); }
fieldset { border: 0; margin: 1.5rem 0 0; padding: 0; display: grid; gap: 1.2rem; min-width: 0; }
.public-counseling__row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
label { display: grid; gap: .6rem; font-size: .9rem; font-weight: 650; }
label span { display: inline; font-weight: 400; color: var(--color-muted); }
input:not([type=checkbox]), textarea { width: 100%; min-width: 0; border: 1px solid #bfc9df; border-radius: 14px; padding: .9rem 1rem; background: white; color: var(--color-ink); font: inherit; }
textarea { resize: vertical; }
.public-counseling__privacy { margin: 0; font-size: .78rem; }
.public-counseling__consent { display: flex; align-items: flex-start; line-height: 1.5; }
.public-counseling__consent input { width: 1.1rem; height: 1.1rem; flex-shrink: 0; accent-color: var(--color-primary); }
button { justify-self: start; padding: 1rem 1.4rem; color: white; background: var(--color-primary); border: 0; border-radius: 16px; font: inherit; font-weight: 750; cursor: pointer; }
button:disabled { opacity: .5; }
.public-counseling__error { color: #a3212d; margin: 0; }
.public-counseling__success { border-radius: 16px; padding: 1.2rem; background: var(--color-primary-soft); line-height: 1.6; }
.public-counseling__email { display: inline-block; margin-top: 1rem; color: var(--color-primary); font-size: .85rem; }
.public-counseling__trap { display: none; }
@media(max-width: 600px) { .public-counseling__row { grid-template-columns: 1fr; } }
</style>
