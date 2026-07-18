# 200명 참여자 무료 티어 운영 검증

검증일: **2026-07-18 KST**. 이 문서는 1회 연간 모집 200명을 위한 용량·운영 경계이며, 제공자 SLA나 실제 백업의 존재를 주장하지 않는다.

## 결론

**200명의 연간 참여자는 무료 티어의 집계 요청·DB·기본 결과 egress 한도 안에 들어간다.** 아래 읽기 전용 버스트도 통과했으므로 요청 수 기준으로 유료 전환은 필요하지 않다. 다만 Worker의 CPU 한도는 집계 쿼터가 아니라 **호출 한 번당** 한도이므로, 인증·SSR·매칭·명단 처리의 `exceededCpu`를 계속 확인해야 한다.

Workers Paid와 Supabase 유료 플랜은 이 규모에서 요청 수를 위한 필수 조건이 아니라, 문서화된 전환 신호가 나타날 때 선택하는 신뢰성 대안이다.

## 공식 한도 (2026-07-18 확인)

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/): Free는 동적 Worker 요청 **100,000/day**, HTTP 요청당 CPU **10 ms**, 외부 subrequest **50/request**이다. 네트워크 대기(예: Supabase `fetch`)는 Worker CPU에 포함되지 않는다.
- [Cloudflare Static Assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/): Static Assets 요청은 무료이고 무제한이다. 따라서 정적 JS/CSS/폰트는 위 동적 요청 계산에 넣지 않는다.
- [Supabase pricing](https://supabase.com/pricing): Free는 API 요청 무제한, 데이터베이스 **500 MB**, egress **5 GB**, Storage **1 GB**, **50,000 MAU**를 제공한다.
- [Supabase database size](https://supabase.com/docs/guides/platform/database-size): Free 데이터베이스 한도에 도달하면 쓰기가 제한될 수 있으므로 단순한 요청 수와 별도로 크기를 관찰한다.
- [Supabase free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing): 활동이 낮은 Free 프로젝트는 일시 중지될 수 있다.
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod): Free에는 다운로드 가능한 자동 백업을 보장하지 않으므로, 독립 논리 백업과 복구 검증이 필요하다.

## 보수적 용량 모델

학생의 한 여정은 동적 요청 25회로 계획한다. 다음은 최대치 모델이며, 일반적인 snapshot과 작은 API 응답은 이보다 훨씬 작다.

```text
base dynamic requests = 200 students × 25 requests = 5,000/day (5% of Workers Free)
retry/refresh stress = 5,000 × 3 = 15,000/day (15% of Workers Free)
one max-size result snapshot = 200 × 256 KiB = 50 MiB
three retained max-size results = 200 × 3 × 256 KiB = 150 MiB
extreme result egress = 200 × 3 × 256 KiB = 150 MiB, before small API responses
```

결과 응답 행, 이벤트, 세션, 상담, 감사 행, 인덱스 및 TOAST 오버헤드까지 넣은 한 코호트 보수적 DB envelope은 약 **205 MiB**다. 이는 500 MB Free DB 안에 여유가 있지만, 장기 보관 코호트를 무한히 누적해도 된다는 뜻은 아니다.

남은 위험은 집계량이 아닌 호출 단위다. **10 ms Worker CPU는 200명에 곱하는 값이 아니다.** 인증, SSR, 매칭, 명단 preview/apply endpoint의 `exceededCpu`를 배포 로그로 점검한다. Supabase 응답을 기다리는 시간은 Worker CPU 시간이 아니다. 한 번의 200행 명단 import가 Free CPU를 넘는다면, queue나 chunk-state 구조를 새로 만들지 말고 그 import/캠페인 월에 Workers Paid를 우선 사용한다. 전체 교체 import를 임의로 나누면 누락된 지원자가 비활성화될 수 있으므로 chunking은 나중의 별도 설계 선택이다.

## 읽기 전용 staging 버스트 증거

- 실행 시각: **2026-07-18T04:21:48Z**
- 대상: `GET https://photo-next-mvp-staging.taejunyun.workers.dev/api/assessment/options`
- 방식: 총 **200**회, 동시성 **20**, cookie와 요청 body 없음, mutation 없음.
- 검증: 모든 응답이 HTTP 200이며 JSON의 `catalogRevision`이 비어 있지 않은 문자열인지 확인.
- 결과: **total=200; status={200: 200}; p95=1546.66 ms**.

이 단발성 read-only probe은 options 읽기 경로의 현재 가용성 증거일 뿐, CPU·백업·지속적인 SLO를 측정하거나 보장하지 않는다.

## 보안 경계: 로그인 하드닝 유지

`202607180024_roster_login_free_tier_hardening.sql` 적용 후에도 HMAC, PostgreSQL **bcrypt cost 10**, RLS 및 세션 설계를 유지한다. 비용 절감을 위해 평문, 더 약한 hash, 클라이언트 전용 검사 또는 로그인당 추가 네트워크 호출로 바꾸지 않는다.

로그인 RPC 하나가 token hash로 고른 **네 shard**를 사용한다. shard마다 10분 동안 global **256**, IP **128**을 허용하므로 전체 상한은 각각 **1,024 global / 512 IP per 10 minutes**다. 허용된 시도는 실제 credential hash 또는 dummy hash를 사용해 유효한 cost-10 bcrypt를 정확히 한 번 수행한다. 연속 실패 **5회**는 credential을 **30분** 잠그며, 잠긴 동안 정답 비밀번호도 인증되지 않는다. 이 제한과 lock은 Worker 밖에서 추가 호출하지 않고 같은 login RPC 안에서 원자적으로 수행한다.

## 신뢰성 런북과 복구 검증

Free Supabase는 무활동 후 pause될 수 있고, 관리형 다운로드 자동 백업을 보장하지 않는다. **현재 생성·복원된 백업은 이 문서에서 주장하지 않는다.** 실제 모집 전 다음을 완료하고 기록한다.

1. 행사 **48시간 전** Free 프로젝트를 restore/warm하고 health, login, options smoke test를 실행한다.
2. 명단 apply 전과 캠페인 후에 암호화한 off-platform logical backup을 만든다.
3. disposable local 또는 staging DB에 backup을 복원한다.
4. 복원본에서 schema/migration 버전, roster 행 수, 결과·세션·상담 표본, login/options smoke test를 확인한다.
5. 복원 시각, 담당자, 암호화 키 보관 책임자, 결과와 삭제/보관 기간을 운영 기록에 남긴다.

## 유료 전환 신호

다음 중 하나가 관측되면 유료 서비스를 선택한다: Worker `exceededCpu`가 반복됨, DB가 **400 MB**에 접근함, egress가 **4 GB**에 접근함, 또는 pause 없는 가용성·관리형 백업이 요구됨. 이들은 운영 신뢰성/호출 단위의 신호이며, 200명 요청 수 자체는 전환 사유가 아니다.
