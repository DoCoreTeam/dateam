# 헤드리스 URL 렌더링 (JS 사이트 URL 추출) — v0.7.250

## 작업
JS 렌더 사이트(Nebius 등) URL을 통합입력에 넣어도 가격표가 추출되게 — 서버에서 Chromium으로 JS 실행 후 렌더된 HTML 확보 → 기존 표보존/전사 파이프라인 연결.

## 결정 (사용자 선택)
- 방식: **Vercel 내 Chromium** = `@sparticuz/chromium` + `puppeteer-core` (유료 외부서비스 안 씀)
- 환경 제약 방어: **하이브리드**(평소 일반 fetch, 빈손=JS사이트일 때만 렌더) + **우아한 폴백**(렌더 실패 시 기존 안내, 회귀0)

## 수정 파일
- 신규 `lib/security/headless-fetch.ts` — renderUrlHtml(url): SSRF 가드(assertSafeUrl) → puppeteer-core+@sparticuz Chromium → 렌더 HTML. 로컬은 로컬 chromium, Vercel은 @sparticuz executablePath. 엄격 타임아웃·예외 폴백.
- `lib/gpu/extract-helpers.ts` fetchUrlText: 일반 fetch 결과가 빈손/tiny면 renderUrlHtml 폴백 → htmlToStructuredText.
- `app/api/pricing/gpu/review/stream/route.ts`: `maxDuration`·`runtime='nodejs'` 명시(렌더 시간 확보).
- `package.json` 의존성 2개 추가.

## 이유
nebius.com/prices 서버 fetch=1484B 빈 껍데기(JS렌더). 헤드리스 렌더 없이는 URL 추출 불가.

## 영향/한계
- 함수 용량↑(@sparticuz ~50MB, Vercel Pro 250MB 내)·콜드스타트 +3~5s. **Vercel 런타임 실동작은 배포 후 확인 필요**(로컬은 로컬 chromium으로 렌더 실측).
- SSRF: 초기 URL은 assertSafeUrl 게이트. 하위 리소스 사설망 차단은 v1 범위 외(노트).

## 보안 (DC-SEC HIGH 반영)
- **SSRF 하위리소스 방어**: page.setRequestInterception + 매 요청 assertSafeUrl 재검증 → 사설망/메타데이터(169.254.169.254)·DNS rebinding·리다이렉트 abort. (실측: Nebius 렌더 시 abort 0, 8/8 모델 정상)
- **운영 비-서버리스 차단**: NODE_ENV=production && !isServerless() → throw(--no-sandbox 로컬바이너리 오인 실행 방지)
- 후속(비차단): 레이트리밋·다중URL 직렬 상한·LOCAL_CHROME_PATH 문서화(linux)

## 검증
- 로컬 실측: 렌더 8/8 모델, URL 전체체인(렌더→전사→items) 8모델 원문·둔갑0, SSRF 인터셉션 후도 8/8
- 559 테스트 · tsc 0 · next build 통과 · DC-REV 89.4 APPROVED · DC-SEC CRITICAL0(HIGH 1건 수정완료)
