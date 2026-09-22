# PLAN newAX: 테스트가 심은 GLOBAL 설정이 운영 AI를 멈춰 세웠다
플랜 ID: P0050
플랜 버전: v0.2.0
상태: 진행중
지시: ins_0092
목표 버전: v0.10.388
작성: 2026-09-22
시작 커밋: 3ed35627

## 목표
- 견적 파일 가져오기에서 「설정된 AI(global-model)를 모르겠습니다」가 사라지고 AI 추출이 다시 돈다
- 테스트가 만든 설정 행이 운영 워크스페이스에 닿는 길을 구조로 끊는다 (정리 구문에 기대지 않는다)

## 범위 밖
- 테스트 전용 DB 분리 (운영 DB 를 그대로 쓰는 구조 자체는 이번에 안 바꿈)
- setSetting·clearSetting 의 트랜잭션 구조 변경
- 다른 표의 테스트 잔여물 점검 (crm_app_setting 만 본다)

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- crm_app_setting 에 scope=GLOBAL 행이 0개
- 견적 파일 가져오기 모달에 AI 오류 문구가 안 뜸 (종합 감사에서 실브라우저)
- 설정값은 env 추가 없이 DB 저장 + UI 관리 (해당 없음, 새 설정 없음)

## 참조
- LOOP.md 7절 보안 기준, 부록 버전 규칙
- apps/web/lib/crm/services/setting.ts (GLOBAL 이 WORKSPACE 의 밑값)
- apps/web/lib/crm/db/client.ts (워크스페이스 격리는 Prisma 확장이 함, GLOBAL 은 null 이라 안 걸린다)

## 항목

### I01 잔여 GLOBAL 행 제거 — 운영 복구
상태: 통과
모드: 경량
범위: DB 조작 (crm_app_setting 행 1개), apps/web/lib/changelog/entries.ts, 버전 파일 5
감사 기준:
- 지우기 전 행 전문을 PLAN.md 에 적어 되돌릴 INSERT 를 남김
- select count(*) from crm_app_setting where scope='GLOBAL' 결과 0
- resolveSetting(getCrmDb('ws_dataalliance'), 'ai.model.extract').source 가 FALLBACK
- 운영 META 로 resolveProvider(meta,'auto') 가 실제 공급자를 돌려줌 (오류 문구를 만든 그 함수)
의존: 없음

### I02 테스트가 GLOBAL 행을 커밋하지 못하게
상태: 통과
모드: 경량
범위: apps/web/tests/crm/services/setting.test.ts
감사 기준:
- GLOBAL 행을 만드는 자리가 롤백되는 트랜잭션 안에만 있음
- pnpm test setting 통과
- 테스트 직후 select count(*) from crm_app_setting where scope='GLOBAL' 이 0
- 일부러 깨기: 롤백을 커밋으로 바꾸면 I03 가드가 실패하는 것을 확인하고 되돌림
의존: I01

### I03 커밋되는 GLOBAL 생성을 정적으로 막는 가드
상태: 통과
모드: 경량
범위: apps/web/lib/policy/test-db-safety.test.ts
감사 기준:
- 가드가 tests 트리에서 crm_app_setting GLOBAL 생성을 찾아 롤백 헬퍼 안인지 대조
- 일부러 깨기: 롤백 밖으로 옮긴 판에서 가드가 실패하는 것을 확인하고 되돌림
- 이미 pnpm test 에 등재된 파일이므로 등재는 그대로, 총 테스트 수가 늘어난 것을 확인
의존: I02

### I04 고르는 설정은 등록된 값만 저장된다 — 쓰기에서 막는다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/services/setting.ts, apps/web/lib/crm/services/setting.test.ts (신규 또는 기존)
감사 기준:
- 보안: 밖에서 온 값을 다루므로, 허용 집합 밖의 값은 API 를 직접 불러도 VALIDATION_FAILED 로 거절
- 허용 집합의 원본은 lib/ai/provider-catalog (읽는 쪽 resolveProvider 가 이해하는 것과 같은 집합), 손으로 또 적지 않음
- setSetting(ws,'mb','ai.model.extract','global-model') 이 던짐, 'auto'·'mock'·등록된 공급자는 통과
- choice 설정 셋 전부에 적용(ai.model.extract, quoteImport 둘)
의존: I03

### I05 모르는 값이 와도 멈추지 않는다 — 기본 AI로 넘어가고 그 사실을 남긴다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/ai/adapters/host.ts, apps/web/lib/crm/services/quick-create.ts, apps/web/lib/crm/ai/adapters/host.test.ts
감사 기준:
- 보안: 폴백이 조용하지 않음 — 시스템 로그에 남고, 어떤 값이 무엇으로 바뀌었는지 적힘
- resolveProvider 가 모르는 값에 던지지 않고 기본 공급자를 돌려주며 무엇을 버렸는지 함께 돌려줌
- 키가 하나도 없을 때는 지금처럼 그대로 던짐 (넘어갈 데가 없는 것과 값이 틀린 것은 다름)
- host.test.ts 통과, 기존 「모르는 값은 조용히 넘어가지 않는다」 단정은 «로그에 남는다»로 옮김
의존: I04

### I06 화면이 이상값을 숨기지 않는다
상태: 통과
모드: 경량
범위: apps/web/app/(crm)/crm/settings/SettingsCard.tsx, apps/web/lib/crm/domain/settings-tab.test.ts 또는 신규 가드
감사 기준:
- 저장된 값이 선택지에 없으면 화면이 그 사실을 말함 (지금은 select 가 첫 항목을 그려 「자동」으로 보임 — 실측)
- 드롭다운에 그 값이 선택된 상태로 남고, 고르면 정상값으로 바뀜
- 일부러 깨기: 이상값을 넣은 목록으로 렌더해 경고가 뜨는 것을 확인
의존: I05

## 되돌리는 법 (I01 이 지운 행)

지운 행 전문 (2026-09-22 실측, 삭제 1건)

```sql
INSERT INTO crm_app_setting (id, scope, "workspaceId", key, "valueJson", "isSecret", description, "updatedById", "updatedAt")
VALUES ('st_test_global_0', 'GLOBAL', NULL, 'ai.model.extract', '"global-model"'::jsonb, false, NULL, NULL, '2026-09-20T10:26:41.848Z');
```

되살릴 이유는 없음 — 테스트가 심은 값이고 운영 추출 AI 를 전부 막고 있었음

## 종합 감사

검사 넷 (2026-09-22)

- pnpm tsc --noEmit: 통과 (exit 0)
- pnpm lint: 통과 (exit 0, 기존 경고 2건은 내 범위 밖 useFormCore·useTour)
- pnpm test: 6661/6661 통과, 실패 0
- pnpm build: 통과 (Compiled successfully 39.2s, 정적 294/294)
  - 첫 시도는 힙 부족으로 죽었음 — 격리 dev 서버와 동시에 돌린 탓, NODE_OPTIONS=--max-old-space-size=8192 로 재실행하여 통과

보안 다섯 줄 (docs/policy/security-count.sql 실행)

- rls_off_tables 0
- anon_write_tables 0
- public_using_true_policies 0
- unpinned_secdef_functions 0
- anon_readable_secdef_views 0

완료 정의 대조

- 검사 넷 통과: 충족
- crm_app_setting 에 scope=GLOBAL 행 0개: 충족 (테스트 전체 실행 직후 재측정도 0)
- 견적 파일 가져오기 모달에 AI 오류 문구 없음 (실브라우저): **못 함**
  - 저장된 세션(apps/web/e2e/auth-state.json, 9/21)이 만료돼 401, auth.setup.ts 는 사람이 직접 로그인해야 갱신됨
  - 크롬 확장도 연결돼 있지 않아 사용자 브라우저를 쓸 수 없었음
  - 대신 오류 문구를 만들던 함수를 운영 데이터로 직접 확인: resolveSetting -> FALLBACK/'auto', resolveProvider(운영 META,'auto') -> 'gemini'
  - 갱신 방법: rm apps/web/e2e/auth-state.json && npx playwright test --project=setup --headed 로 한 번 로그인
- 새 설정 없음(env 추가 없음): 충족

전체 diff (git diff 3ed35627..HEAD --stat)

- 9 files, 317 insertions, 34 deletions
- 범위 밖 변경 없음, 비밀 없음, 하드코딩 문자열 없음
- 작업 트리에 남은 apps/web/tsconfig.json 변경은 옆 세션 것(.next-e2e-p0042·p0044·p0045), 내가 더한 두 줄은 되돌림

항목 대 결과 대조

- I01 -> apps/web/lib/changelog/entries.ts 에 0.10.388 블록, DB GLOBAL 행 0
- I02 -> apps/web/tests/crm/services/setting.test.ts 17/17 (이전 15/17)
- I03 -> apps/web/lib/policy/test-db-safety.test.ts 4 -> 6 테스트

## 종합 감사 2차 — 개입 iv_0103 이후 (2026-09-22)

왜 2차인가: 1차 뒤 사용자가 「키를 이렇게 많이 넣었는데 AI 를 못 읽는 이슈라니」라고 지적함
1차는 이번 행 하나를 치웠을 뿐, **설정 한 줄이 AI 전체를 멈출 수 있는 구조**는 그대로였음

검사 넷

- pnpm tsc --noEmit: 통과
- pnpm lint: 통과 (Error 0)
- pnpm test: 6676/6676 통과, 실패 0 (1차 6661 에서 15 늘어남)
- pnpm build: 통과 (Compiled successfully 69s, 정적 294/294)

보안 다섯 줄: rls_off_tables 0 · anon_write_tables 0 · public_using_true_policies 0 ·
unpinned_secdef_functions 0 · anon_readable_secdef_views 0 · (덧) GLOBAL 행 0

세 겹으로 막음

- 들어오는 쪽: setSetting 이 고르는 설정의 목록 밖 값을 거절 (허용 집합 원본 = lib/ai/provider-catalog)
- 읽는 쪽: resolveProvider 가 던지지 않고 쓸 수 있는 공급자로 넘어가며 버린 값을 돌려줌,
  quick-create 가 시스템 로그에 남김 (키가 0개일 때만 여전히 던짐)
- 보이는 쪽: 설정 화면이 목록 밖 값을 그대로 보여 주고 다시 고르라고 말함

가드는 전부 일부러 깨서 빨강 확인함 (검증 제거 · 통지 제거 · 기록 제거 · 다시 throw · 화면 경고 제거)

항목 대 결과 대조 2차

- I04 -> apps/web/lib/crm/services/setting.ts + setting-choice.test.ts(5단정, 등재)
- I05 -> apps/web/lib/crm/ai/adapters/host.ts + quick-create.ts, host.test.ts 14 -> 20
- I06 -> SettingsCard.tsx + lib/crm/domain/setting-value.ts + 그 가드(5단정, 등재), 문구는 lib/terms

부수 발견

- 기존 가드 lib/system-log/narrate.test.ts 가 「기록하면서 webSearch 를 알면 그 값을 실어라」로
  내 새 기록 호출을 잡음 — context 에 webSearch 추가함
- git checkout 으로 일부러 깨기를 되돌리면 미커밋 작업까지 지워짐 (I04 에서 한 번 당함),
  이후로는 백업 파일로 되돌림

여전히 못 한 것

- 견적 모달 실브라우저 확인 1건 (1차와 같은 이유: E2E 세션 만료, 갱신에 사람 로그인 필요)
- 새 코드는 아직 배포 전임 — 운영은 DB 행을 지운 것으로 이미 풀려 있고, 세 겹 방어는 배포 뒤부터 돔

## 변경 이력
- v0.1.0 (2026-09-22) 최초 작성 (ins_0092)
- v0.1.1 (2026-09-22) I01 실브라우저 확인을 종합 감사로 옮기고 그 자리에 오류를 만든 함수 직접 확인을 넣음, I03 는 새 파일 대신 이미 등재된 lib/policy/test-db-safety.test.ts 를 늘림 (audit:I01)
- v0.2.0 (2026-09-22) 사용자 개입: 키를 넷 넣었는데 설정 한 줄로 AI 전체가 멈춘 구조 자체를 고칠 것, 쓰기 차단·읽기 폴백·화면 경고 세 항목 추가 (iv_0103)
