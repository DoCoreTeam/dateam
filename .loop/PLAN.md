# PLAN newAX: 테스트가 심은 GLOBAL 설정이 운영 AI를 멈춰 세웠다
플랜 ID: P0050
플랜 버전: v0.1.1
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
상태: 대기
모드: 경량
범위: apps/web/lib/policy/test-db-safety.test.ts
감사 기준:
- 가드가 tests 트리에서 crm_app_setting GLOBAL 생성을 찾아 롤백 헬퍼 안인지 대조
- 일부러 깨기: 롤백 밖으로 옮긴 판에서 가드가 실패하는 것을 확인하고 되돌림
- 이미 pnpm test 에 등재된 파일이므로 등재는 그대로, 총 테스트 수가 늘어난 것을 확인
의존: I02

## 되돌리는 법 (I01 이 지운 행)

지운 행 전문 (2026-09-22 실측, 삭제 1건)

```sql
INSERT INTO crm_app_setting (id, scope, "workspaceId", key, "valueJson", "isSecret", description, "updatedById", "updatedAt")
VALUES ('st_test_global_0', 'GLOBAL', NULL, 'ai.model.extract', '"global-model"'::jsonb, false, NULL, NULL, '2026-09-20T10:26:41.848Z');
```

되살릴 이유는 없음 — 테스트가 심은 값이고 운영 추출 AI 를 전부 막고 있었음

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-22) 최초 작성 (ins_0092)
- v0.1.1 (2026-09-22) I01 실브라우저 확인을 종합 감사로 옮기고 그 자리에 오류를 만든 함수 직접 확인을 넣음, I03 는 새 파일 대신 이미 등재된 lib/policy/test-db-safety.test.ts 를 늘림 (audit:I01)
