# PLAN newAX: CLI 실측에서 나온 CRM 창구 결함 넷 고침
플랜 ID: P0163
플랜 버전: v0.1.1
상태: 진행중
지시: ins_0339
목표 버전: v0.11.68
푸시: 모음
작성: 2026-10-23
시작 커밋: 5c63ef4d

## 목표
- 휴지통에 든 할 일을 회사 딜처럼 영구 삭제할 수 있음
- 파이프라인을 안 고르고 딜을 만들면 웹과 CLI 모두 기본 파이프라인의 첫 단계로 만들어짐
- teamda 종료 코드가 지시서 표(0 성공 1 알 수 없음 2 입력 3 인증 권한 4 없음 5 버전 충돌 6 한도 7 승인 대기 8 서버 9 저장값 불일치)와 같음
- 노트(활동) 고치기는 근거를 보고 정함, 빈자리면 서버 CLI 화면까지 이음

## 범위 밖
- docs/cli/발견.md 의 다른 줄(api_keys 마이그레이션 부재, CrmAuditLog actorType)
- newplan/set/ 아래 파일

## 완료 정의
- pnpm exec tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- packages/teamda-cli 에서 bun test 통과
- node scripts/cli-parity-check.mjs 종료 0
- 사용자 노출 문자열은 lib/terms 또는 기존 문구 파일 사용
- docs/cli/발견.md 의 넷 줄이 해결로 바뀜
- 운영 DB 에 「F10 P0158 검증」 「F10 P0163 검증」 기록과 시험 키가 남지 않음

## 참조
- docs/cli/발견.md, docs/cli/01-계획.md, .loop/archive/P0158-v0.11.61-teamda-의-모든-기능을-CLI-로.md
- 지시서 ins_0318 5-3절 종료 코드 표
- LOOP.md 7절 보안, 9절 U-N F-N

## 항목

### I01 휴지통에 든 할 일 영구 삭제가 404 를 내지 않음
상태: 통과
모드: 중량
범위: apps/web/app/api/crm/tasks/[id]/route.ts, apps/web/lib/crm/services/task.ts, apps/web/lib/crm/services/task-purge.test.ts (신규), apps/web/package.json
감사 기준:
- 보안: 영구 삭제는 휴지통에 든 행만 지우고 권한 판정(withCrmApi 와 기존 역할 확인)은 바뀌지 않음, 시험이 휴지통 밖 행 purge 거절과 권한 없는 호출 거절을 단정
- node --experimental-strip-types --test apps/web/lib/crm/services/task-purge.test.ts 통과, 단정을 일부러 깨면 실패 (S6)
- 휴지통에 든 할 일에 DELETE ?mode=purge 가 200 이고 행이 사라짐 (I06 실측)
- 웹 화면(할 일 목록 패널)은 영구 삭제를 부르지 않아 살아 있는 할 일 거절로 깨지는 화면 없음 (grep 근거)
의존: 없음

### I02 파이프라인 없이 만든 딜이 기본 파이프라인 첫 단계로 감
상태: 대기
모드: 경량
범위: apps/web/app/api/crm/deals/route.ts, apps/web/lib/crm/services/deal.ts, apps/web/lib/crm/services/deal-default-pipeline.test.ts (신규), apps/web/package.json
감사 기준:
- 보안: 기본 파이프라인은 호출자 워크스페이스 안에서만 고르고 다른 워크스페이스 파이프라인 id 는 그대로 400, 입력 검증 스키마 유지
- pipelineId 와 stageId 를 다 빼면 기본 파이프라인 첫 단계, stageId 만 주면 그 단계의 파이프라인, 맞지 않는 조합은 400 을 시험이 단정
- 웹 만들기 흐름과 서버 기본값이 같은 파이프라인을 고름 (코드 근거 한 줄)
- 단정을 일부러 깨면 실패 (S6)
의존: 없음

### I03 teamda 종료 코드를 지시서 표에 맞춤
상태: 대기
모드: 경량
범위: packages/teamda-cli/src/exit.ts, packages/teamda-cli/src/http.ts, packages/teamda-cli/src/main.ts, packages/teamda-cli/README.md, packages/teamda-cli/test/
감사 기준:
- cd packages/teamda-cli && bun test 통과, 400 은 2 409 는 5 401 403 은 3 404 는 4 429 는 6 202 는 7 5xx 는 8 저장값 불일치는 9 를 시험이 단정
- README 종료 코드 표가 exit.ts 와 같음
- packages/teamda-cli/package.json 은 안 바뀜
의존: 없음

### I04 노트 고치기 결정 기록 (의도된 불변)
상태: 대기
모드: 경량
범위: docs/cli/발견.md, apps/web/lib/ui/crm-update-standard.test.ts
감사 기준:
- 근거 확인: apps/web/lib/crm/services/activity.ts 머리 주석 「수정하지 않는다. 일어난 일은 바뀌지 않는다. 사람이 남긴 노트만 지울 수 있고(오타 오기), 그것도 휴지통을 거친다」
- 발견.md 에 의도된 불변과 사유, 고치는 길(지우고 다시 쓰기, 일어난 시각 지정)을 적음
- CRUD-U 가드에 활동을 사유와 함께 제외 목록으로 두고, 활동 창구에 PATCH PUT 이 생기면 가드가 실패해 사유를 다시 보게 함, 일부러 깨면 실패 (S6)
- node --experimental-strip-types --test apps/web/lib/ui/crm-update-standard.test.ts 통과
의존: 없음

### I05 노트 고치기 화면
상태: 취소 (I04 에서 의도된 불변으로 판정, 화면을 만들지 않음)
모드: 경량
범위: 없음
감사 기준:
- 해당 없음
의존: I04

### I06 실측과 발견 문서 해결 표시
상태: 대기
모드: 경량
범위: docs/cli/발견.md, apps/web/lib/changelog/entries.ts
감사 기준:
- 자기 dev 서버와 시험 계정 키로 teamda 실호출: task rm --mode purge 성공, deal create pipelineId 없이 성공, 400 종료 2
- 남아 있던 「F10 P0158 검증」 할 일 세 건이 고친 purge 창구 또는 id 로 지워져 0건
- 시험 키 폐기, 「F10 P0163 검증」 기록 id 로 삭제, 시험 계정 정리
- 발견.md 네 줄이 해결로 바뀜
의존: I01, I02, I03, I04

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-23) 최초 작성 (ins_0339)
- v0.1.1 (2026-10-23) I04 근거 확인 결과 활동은 의도된 불변(activity.ts 머리 주석), 화면 항목 I05 취소, 시험 기록 정리는 I06 실측으로 옮김 (audit:I01)
