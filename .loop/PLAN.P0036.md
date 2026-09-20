# PLAN newAX: 설정 화면 한 벌: 카드를 늘리지 않고 같은 그릇에 담는다
플랜 ID: P0036
플랜 버전: v0.1.1
상태: 진행중
지시: iv_0081
목표 버전: v0.10.264
작성: 2026-09-20
시작 커밋: a5a3bbd7

## 목표
- 설정 네 화면(콘텐츠 인텔리전스, 관리자, 영업 CRM, RFP)이 같은 그릇 부품 하나에 담김
- 카드가 옆 카드 때문에 늘어나지 않음 (실측 2026-09-20 영업 CRM 설정은 카드 높이 합 8,634px 중 3,732px 이 빈 자리였음, 43%)
- 설정 화면마다 검색 한 칸과 분류 탭이 있고 한 번에 한 분류만 그림

## 범위 밖
- 설정 항목 자체를 더하거나 빼는 일 (이번 판은 배치와 껍데기만 바꿈)
- 배지 두 벌(.badge[data-status] 과 .status-pill)을 저장소 전체에서 하나로 합치는 일 (설정 표면에서만 좁힘)
- 페이지 폭 클램프 (전체폭 반응형 규칙은 그대로 둠)
- 모바일 레이아웃 (1023px 아래는 이미 한 열이라 이번 변경으로 안 바뀜)
- P0034 가 쥔 자리 (lib/ai/key-store*, app/admin/settings/actions.ts)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 설정 네 화면이 공용 그릇 부품 하나를 씀
- 계측 시험에서 네 화면 전부 카드 빈 자리 5% 이하
- 사용자 노출 문자열은 전부 lib/terms 상수 (화면에 한글 직접 금지)
- 보안 가드를 일부러 깨뜨려 실패를 확인한 사실이 pass --notes 에 남음

## 참조
- LOOP.md 7절 보안 세 질문: 이 플랜은 셋 다 아니오. 새 표도 새 창구도 없고 밖에서 온 값을 새로 다루지 않음. 범위가 7절 「닿는 자리」 일곱 곳 중 어디에도 걸리지 않음
- apps/web/lib/ui/settings-parity.test.ts (지금 가드, 부품만 보고 배치는 안 봄)
- apps/web/app/globals.css:9752 부터의 설정 공용 규칙 (두께와 여백의 단일 출처)
- apps/web/app/(ci)/ci/settings/SettingsView.tsx (표준이 될 골격)
- 실측 근거: 1440x900 격리 서버, 카드마다 차지한 높이와 내용 높이의 차

## 항목

### I01 설정 그릇을 공용 부품으로 뽑고 빈 자리를 재는 시험을 만든다
상태: 통과
모드: 경량
범위: apps/web/components/ui/settings/SettingsPanel.tsx (신규), apps/web/lib/terms/settings.ts (신규), apps/web/lib/terms/index.ts, apps/web/e2e/settings-whitespace.spec.ts (신규), apps/web/app/(ci)/ci/settings/SettingsView.tsx, apps/web/app/globals.css, apps/web/lib/ui/settings-parity.test.ts
감사 기준:
- pnpm tsc --noEmit 통과
- node --test lib/ui/settings-parity.test.ts 통과 (부품 목록 단정에 SettingsPanel 이 들어감)
- node --test lib/ui/glossary.test.ts 통과 (새 화면 문자열은 lib/terms 상수라 금지어 baseline 이 오르지 않음)
- 계측 시험을 실제로 돌려 콘텐츠 인텔리전스 설정이 빈 자리 5% 이하로 통과하고 영업 CRM 설정이 40% 넘게 실패함을 확인 (아직 안 고쳤으므로 실패가 정상)
- /ci/settings 실브라우저에서 탭을 바꾸면 그 분류만 그려지고 검색은 탭과 무관하게 전체에서 찾음
- grep -n "SegmentedTabs\|settings-list" apps/web/app/\(ci\)/ci/settings/SettingsView.tsx 결과 0건 (그릇 마크업을 화면이 다시 그리지 않음)
의존: 없음

### I02 관리자 설정이 카드를 늘리지 않는다
상태: 대기
모드: 경량
범위: apps/web/app/globals.css, apps/web/app/admin/settings/page.tsx
감사 기준:
- 계측 시험의 관리자 네 탭이 전부 빈 자리 5% 이하 (지금 AI 모델 탭은 15%)
- pnpm tsc --noEmit, pnpm lint 통과
- 설정 카드 안의 글자 입력칸이 화면 폭만큼 늘어나지 않음을 실브라우저 폭 측정으로 확인
- app/globals.css 에서 settings-grid 의 align-items stretch 와 height 100% 가 0건
의존: I01

### I03 영업 CRM 설정을 공용 그릇으로 옮기고 넷으로 묶는다
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/settings/page.tsx, apps/web/app/(crm)/crm/settings/settings.module.css, apps/web/lib/crm/domain/settings-tab.ts (신규), apps/web/lib/crm/domain/settings-tab.test.ts (신규)
감사 기준:
- 계측 시험의 영업 CRM 설정이 빈 자리 5% 이하 (지금 43%)
- node --test lib/crm/domain/settings-tab.test.ts 가 카드 12개가 빠짐없이 한 탭에 정확히 한 번씩 들어감을 단정하고 통과
- 그 시험을 apps/web/package.json 의 test 한 줄에 등재하고 등재 전후 총 시험 수가 실제로 늘어남을 확인
- pnpm tsc --noEmit, pnpm lint 통과
의존: I01

### I04 RFP 설정 카드 넷이 공용 카드와 공용 배지를 쓴다
상태: 대기
모드: 경량
범위: apps/web/components/rfp/VendorSettings.tsx, apps/web/components/rfp/RuleSettings.tsx, apps/web/app/(rfp)/rfp/admin/G2bServices.tsx, apps/web/app/(rfp)/rfp/admin/NotificationSettings.tsx
감사 기준:
- 이 넷에서 className="card" 가 0건이고 SettingsCard 를 씀
- 이 넷에서 NbBadge 가 0건이고 StatusPill 을 씀 (뜻 변환은 이미 있는 toneFromStatusKey 를 씀, 새 색을 만들지 않음)
- pnpm tsc --noEmit, pnpm lint 통과
- /rfp/admin 실브라우저에서 규칙 스위치를 눌러 저장이 되고 실패 시 되돌아오는 기존 동작이 그대로임
의존: I01

### I05 RFP 관리자 화면이 공용 그릇에 담긴다
상태: 대기
모드: 경량
범위: apps/web/app/(rfp)/rfp/admin/page.tsx, apps/web/components/rfp/TransferLog.tsx, apps/web/components/rfp/UsageDashboard.tsx
감사 기준:
- 계측 시험에 RFP 관리자가 들어가고 빈 자리 5% 이하로 통과
- /rfp/admin 에 검색 한 칸과 분류 탭이 있고 한 번에 한 분류만 그려짐 (실브라우저 확인)
- 이 셋에서 className="card" 가 0건
- pnpm tsc --noEmit, pnpm lint 통과
의존: I04

### I06 가드가 부품만이 아니라 배치까지 본다
상태: 대기
모드: 경량
범위: apps/web/lib/ui/settings-parity.test.ts
감사 기준:
- 검사 대상이 손으로 적은 디렉터리 셋이 아니라 공용 설정 부품을 쓰는 파일 전체이고, RFP 화면이 실제로 그 목록에 들어옴을 단정
- 설정 화면이 자기 그리드를 짜지 않음(grid-template-columns 직접 선언 0건)과 stretch 로 카드를 늘리지 않음을 단정
- 두 단정을 각각 일부러 깨뜨려 실패를 확인하고 그 사실을 pass --notes 에 적음
- node --test lib/ui/settings-parity.test.ts 통과
의존: I02, I03, I05

### I07 죽은 별칭을 지운다
상태: 대기
모드: 경량
범위: apps/web/app/globals.css, apps/web/lib/ui/settings-class-guard.test.ts
감사 기준:
- globals.css 에서 ci-setting-card, ci-setting-list, ci-setting-head, ci-integration-row, ci-toggle 계열이 0건 (실사용처는 이미 0건임을 확인하고 지움)
- 그 이름이 다시 들어오면 실패하는 단정을 settings-class-guard 에 더하고 일부러 깨뜨려 실패를 확인
- node --test lib/ui/settings-class-guard.test.ts 통과
- pnpm build 통과
의존: I06

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-20) 최초 작성 (iv_0081)
- v0.1.1 (2026-09-20) I01 범위에 용어 상수 파일과 부품 목록 가드를 더함, 새 부품이 기존 단정을 깨뜨리고 새 화면 문자열은 용어집을 거쳐야 함 (audit:I01)
