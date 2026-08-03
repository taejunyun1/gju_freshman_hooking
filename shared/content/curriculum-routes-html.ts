import {
  curriculumRoutes,
  curriculumTrackOrder,
  type CurriculumRoute,
} from './curriculum-routes'

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const standaloneExternalResourcePattern = /<(?:link|script|img)\b[^>]*\b(?:href|src)\s*=/iu

export const hasStandaloneExternalResource = (html: string): boolean => standaloneExternalResourcePattern.test(html)

const renderStage = (
  stage: CurriculumRoute['stages'][number],
): string => {
  const items = stage.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')
  const kind = stage.kind === 'common'
    ? '공통 기반'
    : stage.kind === 'outcome'
      ? '제작 단계'
      : '심화 교과'

  return `
    <article class="stage stage--${stage.kind}">
      <p class="stage__year">${stage.year}Y · ${escapeHtml(stage.phase)}</p>
      <p class="stage__kind">${kind}</p>
      <ul>${items}</ul>
      <p class="stage__outcome">${escapeHtml(stage.outcome)}</p>
    </article>
  `
}

const renderTrack = (key: typeof curriculumTrackOrder[number]): string => {
  const route = curriculumRoutes[key]
  return `
    <section class="route" data-route="${key}" aria-labelledby="route-${key}">
      <header class="route__header">
        <p class="eyebrow">CURRICULUM ROUTE</p>
        <h2 id="route-${key}">${escapeHtml(route.label)}</h2>
        <p>${escapeHtml(route.summary)}</p>
      </header>
      <div class="stages">${route.stages.map(renderStage).join('')}</div>
    </section>
  `
}

const serializableRoutes = Object.fromEntries(curriculumTrackOrder.map((key) => {
  const route = curriculumRoutes[key]
  return [key, {
    label: route.label,
    summary: route.summary,
    stages: route.stages.map(stage => ({
      phase: stage.phase,
      kind: stage.kind,
      items: stage.items,
      outcome: stage.outcome,
    })),
  }]
}))

export const renderCurriculumRoutesHtml = (): string => {
  const routeData = JSON.stringify(serializableRoutes).replaceAll('</', '<\\/')
  const buttons = curriculumTrackOrder.map((key, index) => {
    const label = curriculumRoutes[key].label
    return `<button type="button" data-track-button="${key}" aria-pressed="${index === 0 ? 'true' : 'false'}">${escapeHtml(label)}<span>${index === 0 ? '선택됨' : '경로 보기'}</span></button>`
  }).join('')

  const document = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <title>PHOTO:NEXT | 1~4학년 커리큘럼 루트</title>
  <style>
    :root { color-scheme: light; --blue: #2863eb; --navy: #17284b; --canvas: #f4f7ff; --surface: #fff; --line: #ccdaff; --muted: #5c6d8d; --radius: 24px; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--canvas); color: var(--navy); font-family: Pretendard, Apple SD Gothic Neo, Arial, sans-serif; }
    main { width: min(1160px, calc(100% - 32px)); margin: 40px auto; padding: clamp(24px, 5vw, 56px); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
    .eyebrow, .stage__year, .stage__kind { margin: 0; color: var(--blue); font: 700 0.78rem/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .07em; }
    h1 { max-width: 850px; margin: 14px 0; font-size: clamp(2rem, 5vw, 3.75rem); line-height: 1.12; letter-spacing: -.055em; }
    .intro { max-width: 760px; margin: 0; color: var(--muted); font-size: 1.05rem; line-height: 1.65; }
    .tracks { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 32px 0; }
    button { min-height: 70px; padding: 14px; border: 1px solid var(--blue); border-radius: 16px; background: white; color: var(--blue); cursor: pointer; font: 700 1rem/1.2 inherit; text-align: left; }
    button span { display: block; margin-top: 5px; font-size: .75rem; font-weight: 500; }
    button[aria-pressed="true"] { background: var(--blue); color: white; }
    .route { display: none; }
    [data-active-track="video"] [data-route="video"], [data-active-track="art_photo"] [data-route="art_photo"], [data-active-track="documentary"] [data-route="documentary"], [data-active-track="commercial"] [data-route="commercial"] { display: block; }
    .route__header { padding: 28px; border-radius: 20px 20px 0 0; background: #edf3ff; }
    h2 { margin: 8px 0; font-size: clamp(1.6rem, 3vw, 2.35rem); letter-spacing: -.04em; }
    .route__header > p:last-child { margin: 0; color: var(--muted); line-height: 1.65; }
    .stages { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 16px 0 0; }
    .stage { min-height: 250px; padding: 20px; border: 1px solid var(--line); border-radius: 18px; background: white; }
    .stage--common { background: #fafcff; }
    .stage--outcome { border-color: var(--blue); background: #f1f5ff; }
    .stage__kind { margin-top: 20px; color: var(--muted); }
    ul { min-height: 90px; margin: 12px 0; padding-left: 18px; font-size: .96rem; font-weight: 700; line-height: 1.55; }
    .stage__outcome { margin: 0; color: var(--muted); font-size: .9rem; line-height: 1.55; }
    footer { margin-top: 34px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: .88rem; line-height: 1.55; }
    @media (max-width: 760px) { main { width: min(100% - 20px, 1160px); margin: 10px auto; border-radius: 18px; } .tracks, .stages { grid-template-columns: 1fr; } .tracks { gap: 8px; } button { min-height: 58px; } .stage { min-height: auto; } ul { min-height: 0; } }
  </style>
</head>
<body>
  <main data-active-track="video">
    <p class="eyebrow">PHOTO:NEXT / FOUR-YEAR CURRICULUM</p>
    <h1>관심 분야에서 시작하는 1~4학년 제작 루트</h1>
    <p class="intro">1·2학년에는 사진·영상 제작의 공통 기반을 익히고, 3·4학년에는 관심 분야에 맞춰 프로젝트와 포트폴리오를 확장합니다.</p>
    <nav class="tracks" aria-label="관심 분야별 커리큘럼 선택">${buttons}</nav>
    ${curriculumTrackOrder.map(renderTrack).join('')}
    <footer>이 루트는 진로 탐색을 위한 안내이며, 실제 개설 교과와 수강신청 여부는 학과 안내를 확인해 주세요.</footer>
  </main>
  <script id="curriculum-route-data" type="application/json">${routeData}</script>
  <script>
    (() => {
      const root = document.querySelector('[data-active-track]');
      const buttons = document.querySelectorAll('[data-track-button]');
      if (!root || !buttons.length) return;
      buttons.forEach((button) => {
        button.addEventListener('click', () => {
          const track = button.dataset.trackButton;
          if (!track) return;
          root.dataset.activeTrack = track;
          buttons.forEach((candidate) => {
            const selected = candidate.dataset.trackButton === track;
            candidate.setAttribute('aria-pressed', String(selected));
            const status = candidate.querySelector('span');
            if (status) status.textContent = selected ? '선택됨' : '경로 보기';
          });
        });
      });
    })();
  </script>
</body>
</html>
`
  const normalizedDocument = document.replace(/[ \t]+$/gmu, '').trim()

  if (hasStandaloneExternalResource(normalizedDocument)) {
    throw new Error('Standalone curriculum HTML must not reference external resources.')
  }

  return normalizedDocument
}
