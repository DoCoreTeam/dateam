# PLAN newAX: 차트 위에서는 페이지가 안 내려간다
플랜 ID: P0098
플랜 버전: v0.1.2
상태: 진행중
지시: ins_0154
목표 버전: v0.10.808
작성: 2026-09-30
시작 커밋: 4901583a

## 목표
- 차트 안에 커서가 있을 때 휠을 굴리면 **차트만 움직이고 페이지는 그 자리에 선다** (사용자 지적 2026-09-30 「차트안에 마우스커서가 있을때는 화면 스크롤이 안되야 하는데 자꾸 스크롤이 되네」)
- 같은 결함이 다음에 다른 화면에서 안 나게 **세는 자리**를 둔다 — 타입 검사도 lint 도 못 잡는 결함이다
- 지금 저장소가 **안 빌드되는 상태를 푼다** — `onWheel` 이 정의 없이 불린다

## 범위 밖
- 끌어서 미는 기능 (2026-09-29 에 넣었다 뺐다, 포인터를 붙잡아 화면이 먹통에 가까워졌다)
- 세로축 줌 — HTS 관례는 가로축이고 세로는 자동이다
- 차트 밖 다른 화면의 스크롤 거동

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 실브라우저에서 차트 **안**에서 휠 → 페이지 scrollY 안 변함, 차트 **밖**에서 휠 → scrollY 변함
- 가드를 일부러 깨면 빨갛다 (7절 S6)
- 새 사용자 노출 문자열 없음 (이 판은 거동만 고친다)
- 보안 5종 재측정 전부 0

## 참조
- LOOP.md 7절 보안 기준, 부록 「버전 규칙」
- node_modules/.pnpm/react-dom@19.2.0/.../react-dom-client.development.js:19251 — `wheel` 을 `{ passive: true }` 로 건다
- apps/web/app/admin/org-chart/OrgTree.tsx:116 — 이 저장소가 이미 쓰던 방식

## 항목

### I01 차트가 휠을 제 손으로 걸어 페이지를 붙잡는다
상태: 통과
모드: 경량
범위: apps/web/app/(trading)/trading/ChartPanel.tsx, apps/web/lib/policy/chart-wheel-guard.test.ts (신규), apps/web/lib/trading/chart/series.test.ts, apps/web/package.json
감사 기준:
- 고치기 **전에** `pnpm tsc --noEmit` 가 ChartPanel.tsx 의 `onWheel` 미정의로 실패하는 것을 먼저 확인하고, 고친 뒤 통과를 확인한다
- `node --test --experimental-strip-types lib/policy/chart-wheel-guard.test.ts` 3건 통과, `{ passive: false }` 를 지운 판으로 일부러 깨뜨려 빨간 것을 확인 (7절 S6)
- 가드가 apps/web/package.json 의 test 한 줄에 등재되고, 등재 뒤 `pnpm test` 총 시험 수가 실제로 늘어난다 (등재만 하고 안 도는 전례가 있다)
- 실브라우저: 차트 안에서 휠 → `window.scrollY` 그대로이고 봉 개수가 바뀜, 차트 밖에서 휠 → `window.scrollY` 변함
- 먼저 있던 가드 `series.test.ts` 의 「화면이 휠을 차트 안에서만 가로챈다」가 `onWheel={onWheel}` 을 **요구하고 있었다** — 고친 판을 빨갛게 만든다. 그 단정을 옳은 계약(상자에만 걸기·`zoomWindow`·프레임 묶기)으로 고쳐 쓰고 `pnpm test` 전체가 초록인 것을 확인
- 보안: 세 질문 전부 아니오 — 새 표·칼럼·버킷 없음, 새 라우트·서버 액션·공개 링크 없음, 밖에서 온 값 없음 (브라우저가 만든 WheelEvent 의 좌표와 delta 만 읽는다). 7절 「닿는 자리」 일곱 줄 어디에도 범위가 안 걸림
의존: 없음

### I02 이 판을 사용자가 본다
상태: 대기
모드: 경량
범위: apps/web/lib/changelog/entries.ts
감사 기준:
- `node --test --experimental-strip-types lib/policy/version-rule.test.ts lib/policy/policy-sync.test.ts` 통과
- entries.ts 맨 위 블록의 판 번호가 이 항목 커밋의 판 번호와 같다 (CLI 가 판 파일 다섯을 올리므로 여기서는 내역만 쓴다)
- 내역 문장이 거동을 말한다 — 「passive」 「리스너」 같은 만든 사람 말을 안 쓴다
- 보안: 해당 없음 — 화면에 뜨는 글 한 줄만 바뀐다. 저장도 창구도 외부 값도 없음
의존: I01

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-30) 최초 작성 (ins_0154)
- v0.1.1 (2026-09-30) I01 범위에 series.test.ts 추가 — 먼저 있던 가드가 고칠 대상인 `onWheel={onWheel}` 을 요구하고 있어 옳은 판이 빨갛다 (audit:I01)
- v0.1.1 (2026-09-30) I01 범위에 series.test.ts 추가 — 먼저 있던 가드가 onWheel={onWheel} 을 요구해 옳은 판을 빨갛게 만든다 (audit:I01)
- v0.1.2 (2026-10-01) 목표 버전 v0.10.803 -> v0.10.808 — 옆 세션(P0097)이 803~807 을 가져갔다. 버전은 뒤로 안 간다 (audit:I01)
- v0.1.2 (2026-09-30) 옆 세션이 v0.10.803~807 을 가져가 목표 버전을 808 로 다시 계산 (audit:I01)
