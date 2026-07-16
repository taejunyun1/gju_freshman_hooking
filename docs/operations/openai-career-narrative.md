# PHOTO:NEXT 진로 제안 문장 운영 가이드

검토 기준일: 2026-07-16

이 문서는 광주대학교 사진영상미디어학과 입시 플랫폼의 네 문장 진로 제안 기능을 운영하기 위한 기술·안전 절차다. 프로덕션 기본값: provider 비활성. `OPENAI_API_KEY`와 `OPENAI_SAFETY_HMAC_KEY`가 모두 없으면 제출은 실패하지 않고 서버의 결정론적 네 문장으로 완료된다.

이 문서는 법률 자문이 아니다. 실제 배포와 미성년자 개인정보 처리는 광주대학교의 개인정보·법무·안전 검토를 대체하지 않는다.

## 현재 출시 결정

- 프로덕션에서는 OpenAI provider를 켜지 않는다. 연령 확인과 디지털 동의 설계가 승인되기 전까지 under-14 or unknown 사용자는 항상 결정론적 경로만 사용한다.
- 두 OpenAI secret은 `wrangler.jsonc`의 `secrets.required`에 넣지 않는다. provider 없는 안전한 배포가 반드시 가능해야 한다.
- 기본 모델 설정은 `gpt-5.6-sol`이다. OpenAI의 미성년자 대상 지침은 최신 flagship 모델 사용을 권고하고, 현재 모델 가이드는 `sol`을 flagship, `luna`를 고효율 대량 작업 후보로 설명한다.
- `gpt-5.6-luna`는 합성 fixture 유료 평가와 사람 검토를 통과한 경우에도 환경변수만 바꿔 활성화할 수 없다. 별도의 날짜가 있는 개인정보·안전 책임자 승인과 배포 검토가 필요하다.
- 이 저장소에는 승인된 `docs/operations/evidence/openai-career-model-eval.md`가 없다. 따라서 production provider activation 검증은 의도적으로 실패한다.

근거:

- [OpenAI Under 18 API Guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)
- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [개인정보 보호법 제22조의2 — 만 14세 미만 아동의 개인정보 보호](https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=02&joNo=0022&lsiSeq=270351&urlMode=lsScJoRltInfoR)

## 데이터 경계

OpenAI로 보낼 수 있는 값은 서버가 검증한 다음 항목뿐이다.

- 슬롯별 template ID allowlist
- 슬롯별 connector ID allowlist
- 슬롯별 fact reference allowlist
- 승인된 관심사·네 전공 트랙·교과·프로젝트·진로·학생 작품·교수 역할의 fact label
- HMAC으로 만든 안정적이고 비가역적인 `safety_identifier`

보내지 않는 값:

- 이름, 닉네임, 전화번호, 학교, 지역, 세션, 계정 식별자
- 학생의 자유 입력과 `careerOther`
- 기자재·시설 이름, 수량, 예약 정보
- 실제 학생 평가 행, 실제 결과 snapshot, 상담 내용
- 관리자 신고 내용(신고는 category-only)

모델은 문장을 쓰지 않는다. strict Structured Outputs로 template ID, connector ID, fact reference만 선택하며, 최종 네 문장은 서버의 고정 템플릿이 렌더링한다. 알 수 없는 참조, extra key, `text`, `reason`, 거절, 불완전 응답, timeout, 429는 모두 결정론적 fallback으로 닫힌다.

[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)와 [safety identifier 지침](https://developers.openai.com/api/docs/guides/safety-best-practices#implement-safety-identifiers)을 구현 기준으로 사용한다.

## OpenAI 보존 문구

요청은 `store:false`를 사용해 Responses 객체를 애플리케이션 상태로 남기지 않도록 요청한다. 다만 이 표현은 “아무것도 저장되지 않는다”는 뜻이 아니며, 공식 문서의 endpoint·기능별 예외와 prompt caching 동작이 적용될 수 있다.

OpenAI API 데이터는 기본적으로 모델 학습에 사용되지 않지만, 명시적으로 데이터 공유를 선택한 경우는 별도다. 기본 abuse monitoring 로그에는 customer content나 파생 metadata가 포함될 수 있고 최대 30일 보존될 수 있으며, 법적 의무나 중대한 위해 방지를 위해 더 길게 보존될 수 있다.

이 프로젝트는 현재 OpenAI 조직에 ZDR이 승인·설정되었다고 주장하지 않는다. ZDR 또는 Modified Abuse Monitoring은 OpenAI의 사전 승인과 조직/프로젝트 설정을 실제로 확인한 뒤에만 운영 문서에 기록한다.

근거: [OpenAI Data Controls](https://developers.openai.com/api/docs/guides/your-data)

## Secret 설정

값은 Wrangler의 대화형 프롬프트에 직접 입력한다. 비밀 값을 대화창, Git, 명령 인자, shell history, 스크린샷 또는 이 문서에 붙여 넣지 않는다.

스테이징:

```bash
pnpm wrangler secret put OPENAI_API_KEY --env staging
pnpm wrangler secret put OPENAI_SAFETY_HMAC_KEY --env staging
```

프로덕션(승인 전 실행 금지):

```bash
pnpm wrangler secret put OPENAI_API_KEY
pnpm wrangler secret put OPENAI_SAFETY_HMAC_KEY
```

HMAC secret은 정확히 32바이트를 unpadded base64url로 인코딩한 값이다. 두 secret은 반드시 함께 추가·교체·삭제한다. API key와 HMAC key는 서로 다른 비밀 값이어야 한다.

Cloudflare는 비밀 값에 plaintext variable이 아니라 Secret을 사용한다. 이 Worker는 `nodejs_compat`와 `compatibility_date: 2026-07-14`를 유지하며, 현재 Cloudflare 런타임은 Worker variable과 secret을 `process.env`에 처음 접근할 때 lazy population한다.

근거:

- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Workers environment variables and `process.env`](https://developers.cloudflare.com/workers/configuration/environment-variables/#environment-variables-and-nodejs-compatibility)

## 설정 범위와 즉시 중지

- 모델: `gpt-5.6-sol` 또는 평가 후보 `gpt-5.6-luna`
- provider timeout: 기본 5,000ms, 허용 2,000–8,000ms
- UTC 일일 외부 호출 cap: 기본 500, 허용 1–10,000
- 학생별 24시간 cap: 정확히 5
- 출력 token cap: 512
- 외부 호출: 소유자 한 번, retry 없음

즉시 중지는 두 단계로 한다.

1. `pnpm wrangler secret delete OPENAI_API_KEY`로 API key를 삭제한다.
2. 배포 환경에서 HMAC secret도 삭제하고 `scripts/verify-env.mjs`를 다시 실행한다.

키가 없으면 신규 평가 제출은 저장 snapshot을 다시 쓰지 않고 결정론적 fallback으로 완료된다. 이미 완료된 결과는 immutable snapshot이므로 rollback 과정에서 문장을 재생성하거나 덮어쓰지 않는다.

## 유료 평가

유료 평가는 자동 또는 일반 테스트에서 실행하지 않는다.

```bash
read -rs "PHOTO_NEXT_OPENAI_EVAL_API_KEY?Staging-only eval key: "
echo
export PHOTO_NEXT_OPENAI_EVAL_API_KEY
PHOTO_NEXT_RUN_PAID_OPENAI_EVAL=1 pnpm exec tsx scripts/eval-openai-career-narrative.mjs
unset PHOTO_NEXT_OPENAI_EVAL_API_KEY
```

`read -s`는 zsh 대화형 입력을 화면과 shell history에 남기지 않는다. 중단된 실행에서도 `unset PHOTO_NEXT_OPENAI_EVAL_API_KEY`를 수행한다. CI에서는 승인된 secret store가 process environment로 직접 주입하고 값을 출력하지 않아야 한다. key 값을 명령 인자나 inline assignment 값으로 쓰지 않는다. 스크립트는 documentary-social, documentary-archive, art-photo, commercial, video-ai-drone 합성 fixture를 `sol`과 `luna`에서 각 20회 실행한다. 실제 학생 행·닉네임·전화·학교·자유 입력·기자재·시설·프로덕션 key는 사용하지 않는다.

기본 실행은 provider를 0회 호출하고 artifact도 만들지 않는다. 명시적으로 연 유료 실행만 ignored `.artifacts/openai-career-eval-local.json`에 aggregate count, latency, token totals, template/connector ID, pass/fail을 기록하며 prompt, fact label, output 문장은 기록하지 않는다.

`luna` 출시 조건:

- 100/100 strict schema 성공
- unknown ref와 extra key 0
- 네 트랙·교수·윤태준의 예술사진·영상·AI·기술적 이미지 범위 오류 0
- `sol`보다 나쁜 refusal rate가 아님
- median/p95 latency와 token cost 기록
- 사람 검토, 승인 ID, 만료일을 포함한 별도 aggregate evidence 승인

개선이 결정론적 selector보다 명확하지 않으면 provider를 켜지 않는다. 비용 절감만으로 미성년자 대상 외부 모델을 활성화하지 않는다.

## 미성년자 안전 운영

- 모든 학생에게 AI 선택이 개입할 수 있다는 연령 적합 고지와 신고 제어를 제공한다.
- 모든 출력은 저장 전에 strict choice decode와 고정 템플릿 로컬 필터를 통과한다.
- `unsafe` 신고를 먼저 검토하고 같은 영업일 내 확인을 목표로 한다.
- 고위험 또는 반복 이슈는 사진영상미디어학과 개인정보·안전 책임자에게 에스컬레이션한다.
- 관리자는 `resolved_inaccurate`, `resolved_unsafe`, `resolved_copy`, `dismissed` 중 하나로 처리한다.
- 처리 RPC는 CAS와 audit event를 한 트랜잭션에서 기록하며 학생의 immutable 결과를 조용히 삭제하거나 수정하지 않는다.
- OpenAI 기준에서는 13세 미만 또는 적용 가능한 digital-consent age 미만 아동의 personal data를 approved ZDR 없이 OpenAI로 전송하면 안 된다.
- 한국 개인정보 보호법의 만 14세 미만 법정대리인 동의는 위 OpenAI 기준과 별개의 국내 기준이다. 본 제품은 두 기준 중 더 엄격하게 under-14 or unknown → 결정론적 전용으로 운영한다.
- 승인된 연령 확인·법정대리인 동의·기관 개인정보 검토가 없으므로 production provider는 계속 꺼 둔다.

## 신고 대기열

관리자 목록은 AAL2 세션을 요구하고 report ID, category, priority, created time, status, assessment public ID, 별도 결과 검토 API 경로만 반환한다. 목록에는 학생 연락정보나 생성 문장이 없다.

결과 확인은 별도 AAL2 Bearer 요청으로 immutable snapshot을 legacy-aware decode한 뒤 다음 최소 검토 정보만 반환한다.

- 선택 관심사
- 네 전공 트랙 순서
- 공개 교과 제목
- 총괄교수와 전문 연계 교수의 이름·직함·전문분야
- 학생에게 표시된 네 문장

detail DTO에는 연락처, evidence ID, provider source/model/token/failure metadata가 없다. 처리 mutation은 15분 이내 recent AAL2를 추가로 요구한다.

## 관측·비용·회전

- OpenAI dashboard에 월 예산과 사용량 경보를 설정한다. cap은 앱 내부의 추가 방어선이지 provider 예산 경보를 대체하지 않는다.
- failure code, model, input/output token count는 service-role 전용 private admin SQL에서 집계만 확인한다. 학생 행이나 prompt/output 원문을 운영 로그에 남기지 않는다.
- key 회전은 스테이징 합성 smoke → 새 API/HMAC secret pair → `scripts/verify-env.mjs` → 배포 → provider-off fallback smoke 순서로 수행한다.
- 장애 시 API key를 삭제하고 no-key 배포를 검증한다. 저장 snapshot을 다시 쓰지 않는다.

## 출시 전 확인

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:sql
pnpm test:local-integration
pnpm playwright test tests/e2e/results.spec.ts --project=chromium
pnpm build
! rg -n "OPENAI_API_KEY|server-test-key" .output/public
git diff --check
```

provider-disabled assessment submit p95 목표는 2,000ms다. 이 경로의 부하 테스트는 `api.openai.com`을 한 번도 호출하지 않아야 한다.
