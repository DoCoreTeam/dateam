# PLAN newAX: 운영 설정을 지운 테스트를 막고, 오래 걸리는 일이 무엇을 하는지 말하게 한다
플랜 ID: P0035
플랜 버전: v0.2.2
상태: 진행중
지시: ins_0045
목표 버전: v0.10.253
작성: 2026-09-20
시작 커밋: 3248ad97

## 목표
- 테스트가 운영 워크스페이스의 실사용 데이터를 지우지 못하게 막음 (견적서 공급자 정보가 이 경로로 사라졌음)
- 사라진 공급자 정보를 되살리고, 되살린 뒤 같은 일이 또 나면 화면이 아니라 가드가 먼저 셈
- 몇 초를 넘는 일은 화면이 무엇을 하는 중인지와 경과 시간을 말함 (지금 견적 파일 읽기는 「읽는 중…」 한 마디로 수 분을 덮음)

## 범위 밖
- Supabase 시점 복구(PITR)로 표를 되돌리는 일 — 표 하나만 되돌릴 수 없고 오늘 만든 견적까지 같이 돌아감
- 테스트 전용 워크스페이스에 시드를 새로 까는 일 (deal·gmail-sync 는 운영 시드에 기대고 있어 별도 판)
- 짧은 저장 단추(1초 안쪽)의 문구 — 초를 세면 그게 더 불안함
- 설정 표에 감사 트리거를 다는 일 (audit_log 트리거 여섯 표 확장은 별도 판)

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- tests/ 아래에서 운영 워크스페이스의 행을 넓은 조건으로 지우는 구문이 0건
- 가드를 일부러 깨뜨려 실패를 확인한 사실이 pass --notes 에 남음
- 사용자 노출 문자열은 전부 lib/terms 상수 (화면에 한글 직접 금지)
- crm_app_setting 에 quote.supplier.* 8줄이 실제로 들어가 있고, 견적 미리보기의 「공급자 정보가 아직 없어요」가 사라짐

## 참조
- LOOP.md 7절 보안 기준 (세 질문, 규칙 S6 안 깨 본 가드는 가드가 아님)
- apps/web/lib/meeting/digest-progress.ts — 진행 표시 SSOT (무엇을 하는 중인지 · 경과 시간 · 오래 걸릴 때 덧말)
- apps/web/lib/crm/ui/finish-progress.ts — 그 SSOT 를 옆 화면이 위임해 쓰는 본보기
- apps/web/tests/crm/integrity/_helpers.ts 머리주석 — 「운영 DB 라서 테스트가 만든 행이 남아 있다가 곧 사고다」
- apps/web/tests/crm/integrity/DI-12.test.ts — 전용 워크스페이스(ws_di12_test)로 이미 옮긴 본보기
- 2026-08-16 세션 방송 「CRM 테스트가 운영 워크스페이스에 직접 쓰고 지웁니다 — 실사용 데이터가 실제로 사라졌습니다」 (같은 사고가 한 달 전에 보고됐고 설정 쪽만 안 고쳐졌음)

## 항목

### I01 설정 테스트가 운영 설정을 지우지 않게 한다
상태: 통과
모드: 경량
범위: apps/web/tests/crm/services/setting.test.ts, apps/web/lib/crm/services/setting.ts
감사 기준:
- cleanup 이 SETTING_DEFS 전체 키를 조건으로 지우는 구문이 파일에서 사라짐 (grep "SETTING_DEFS.map" 이 코드 줄에 0건)
- 이 파일에 원래 있던 실패 1건(quote.supplier.address 설명이 10자라 「설명이 있다」 가드가 떨어짐)을 함께 고침 — 파일이 pnpm test 목록 밖이라 아무도 못 보고 있었음
- crmAuditLog 를 targetType 만으로 지우는 구문이 사라짐 (grep "targetType: 'setting'" 가 deleteMany 인자에 0건)
- 테스트가 쓰는 워크스페이스가 ws_dataalliance 가 아님 (파일 안 getCrmDb 인자가 /test/ 를 포함)
- node --test tests/crm/services/setting.test.ts 가 통과하고, 돌린 뒤 psql 로 센 crm_app_setting 의 quote.supplier 행 수가 돌리기 전과 같음
의존: 없음

### I02 운영 워크스페이스를 넓은 조건으로 지우는 나머지 구문을 좁힌다
상태: 통과
모드: 경량
범위: apps/web/tests/crm/services/gmail-sync.test.ts, apps/web/lib/crm/db/workspace-guard.ts, apps/web/lib/crm/db/workspace-guard.test.ts
감사 기준:
- 감사 로그를 action 만으로 지우는 구문이 사라지고, 테스트가 만든 targetId 로만 지움 (gmail-sync.test.ts)
- DI-14 와 budget 은 전수 확인 결과 이미 안전함을 근거와 함께 기록 (DI-14 는 MONTH='2099-11' 로 실사용 월과 안 겹치고, budget 은 dbB=ws_integrity_b 전용 워크스페이스이며 워크스페이스 가드가 deleteMany 의 where 에 workspaceId 를 주입함)
- 워크스페이스 가드가 CrmAppSetting 같은 nullable 모델의 지우기에 GLOBAL(workspaceId=null) 행을 끼워 넣지 않음 — 읽기는 「내 것 + GLOBAL」이 맞지만 지우기에 같은 규칙을 쓰면 한 워크스페이스가 공용 설정을 지운다
- workspace-guard.test.ts 가 그 차이를 단정하고, 옛 규칙으로 되돌리면 실패함을 확인
- node --test 로 gmail-sync 를 돌린 뒤 crm_audit_log 총 행 수가 돌리기 전과 같음
의존: I01

### I03 테스트가 운영 데이터를 지우지 못하게 가드로 잠근다
상태: 통과
모드: 경량
범위: apps/web/lib/policy/test-db-safety.test.ts (신규), apps/web/package.json
감사 기준:
- tests/ 아래 모든 파일을 훑어 운영 워크스페이스에 묶인 db 손잡이의 deleteMany 와 원시 DELETE 를 찾아내고, 조건이 테스트가 만든 id 목록이 아니면 실패시킴
- 이 가드가 pnpm test 목록에 등재되고, 등재 후 전체 테스트 수가 실제로 늘어난 것을 확인
- 가드를 일부러 깨뜨려(I01 의 옛 구문을 되돌려) 실패하는 것을 확인하고 그 사실을 기록
- pnpm test 통과
의존: I02

### I04 견적 파일 읽기와 가져오기가 무엇을 하는 중인지 말한다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/ui/quote-read-progress.ts (신규), apps/web/lib/crm/ui/quote-read-progress.test.ts (신규), apps/web/lib/terms/quote.ts, apps/web/components/ui/crm/QuoteFromFileModal.tsx
감사 기준:
- 진행 문구를 컴포넌트 밖 순수 함수로 두고 digest-progress 의 formatElapsed 를 그대로 위임해 씀 (문구가 두 벌이 되지 않음)
- 파일 이름과 크기를 넣으면 「OOO.pdf 를 읽고 있어요 · 12초」 꼴의 한 줄이 나오고, 45초를 넘으면 덧말이 붙는 것을 단정하는 시험이 통과
- QuoteFromFileModal 의 읽는 중 · 가져오는 중 두 자리가 그 한 줄을 화면에 그림 (grep 으로 함수 호출이 두 자리 모두에 있음)
- 화면 문자열이 전부 lib/terms 상수 (컴포넌트에 한글 리터럴 0건)
의존: 없음

### I05 같은 AI 대기 자리를 전수로 맞춘다
상태: 대기
모드: 경량
범위: apps/web/components/ui/crm/QuoteFillPanel.tsx, apps/web/lib/policy/wait-progress-guard.test.ts (신규), apps/web/package.json
감사 기준:
- 말로 채우기 · 파일로 채우기 두 자리가 I04 의 같은 함수를 씀
- 가드가 AI 를 부르며 기다리는 단추 목록을 훑어 진행 한 줄이 없는 자리를 실패시킴 (목록은 손으로 적지 않고 AI 호출 경로에서 뽑음)
- 가드를 일부러 깨뜨려 실패를 확인하고 기록
- pnpm test 목록 등재 후 전체 테스트 수가 늘어난 것을 확인
의존: I04

### I06 오래 걸리는 일의 규칙을 정책 세 파일에 적는다
상태: 대기
모드: 경량
범위: .claude/heavy/CEO.md, AGENTS.md, GEMINI.md, apps/web/lib/policy/policy-sync.test.ts
감사 기준:
- 세 파일의 같은 자리에 같은 문장으로 규칙이 들어감 (몇 초를 넘는 일은 무엇을 하는 중인지와 경과 시간을 말한다, SSOT 는 digest-progress)
- policy-sync 가 그 문장의 동일성을 실제로 세고, 한 파일만 고치면 실패함을 확인
- pnpm test 통과
의존: I05

### I07 공급자 정보를 되살린다
상태: 통과
모드: 경량
범위: 운영 DB crm_app_setting (코드 변경 없음)
감사 기준:
- 사용자 캡처의 값으로 quote.supplier 일곱 키와 quote.numberFormat 이 WORKSPACE 범위에 들어감
- psql 로 센 quote.% 행 수가 9 (로고와 상호는 사용자가 직접 넣은 것을 덮지 않음, ON CONFLICT DO NOTHING)
- 견적번호 형식이 DA-{YYYY}-{MMDD}-{SEQ:2} 로 돌아옴 (오늘 04:13 이후 만든 DA-20260920-01·02 가 옛 형식과 다른 것이 이 설정이 사라진 증거)
- 견적 상세의 미리보기에서 「견적서에 우리 회사 정보가 비어 있어요」 띠가 사라지는 것을 확인
의존: 없음

### I08 설정 카드가 저장된 뒤에도 「저장」이라고만 말하지 않는다
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/settings/, apps/web/lib/terms/, apps/web/lib/ui/settings-parity.test.ts
감사 기준:
- 값이 들어 있는 칸의 단추가 「저장」이 아니라 무엇을 하는 단추인지 말함 (사용자 지적 2026-09-20 「상호 넣고 저장 눌렀으면 저장이라는 버튼이 아니라 수정이 되던가 해야지」)
- 저장 직후 그 칸의 「기본값」 표가 사라지고 지금 값이 보임 (되살린 값이 화면에 안 비치면 사용자는 또 지워진 줄로 읽음)
- 단추 문구는 lib/terms 상수 (화면에 한글 직접 금지)
- 같은 골격을 쓰는 설정 카드 전수에 같이 적용되고 settings-parity 가 그것을 셈
의존: I04

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-20) 최초 작성 (ins_0045)
- v0.2.2 (2026-09-20) I02 범위 조정 — DI-14·budget 은 전수 확인 결과 이미 안전(근거 기록으로 대체)하고, 대신 워크스페이스 가드가 nullable 모델의 지우기에 GLOBAL 행을 끼워 넣던 구멍을 같은 항목에서 막음 (--ref audit:I02)
- v0.2.1 (2026-09-20) I01 범위에 lib/crm/services/setting.ts 추가 — 전용 워크스페이스로 옮기고 나서야 드러난 선재 실패 1건(설명 10자)을 같은 항목에서 고침 (--ref audit:I01)
- v0.2.0 (2026-09-20) I07 을 선행으로 돌리고(의존 없음) 되살릴 값을 캡처 실측값으로 확정, quote.numberFormat 유실을 범위에 추가, 설정 카드 단추 문구 I08 추가 (--ref iv_0082)
- v0.2.2 (2026-09-20) I02 범위 조정 — DI-14·budget 은 전수 확인 결과 이미 안전(근거 기록으로 대체)하고, 대신 워크스페이스 가드가 nullable 모델의 지우기에 GLOBAL 행을 끼워 넣던 구멍을 같은 항목에서 막음 (--ref audit:I02)
- v0.2.1 (2026-09-20) I01 범위에 lib/crm/services/setting.ts 추가 — 전용 워크스페이스로 옮기고 나서야 드러난 선재 실패 1건(설명 10자)을 같은 항목에서 고침 (--ref audit:I01)
- v0.2.0 (2026-09-20) I07 선행 전환, numberFormat 유실 추가, 설정 카드 단추 I08 추가 (iv_0082)
- v0.2.2 (2026-09-20) I02 범위 조정 — DI-14·budget 은 전수 확인 결과 이미 안전(근거 기록으로 대체)하고, 대신 워크스페이스 가드가 nullable 모델의 지우기에 GLOBAL 행을 끼워 넣던 구멍을 같은 항목에서 막음 (--ref audit:I02)
- v0.2.1 (2026-09-20) I01 범위에 setting.ts 추가, 선재 실패 1건 동반 수정 (audit:I01)
- v0.2.2 (2026-09-20) I02 범위 조정: DI-14·budget 은 이미 안전, 워크스페이스 가드의 GLOBAL 지우기 구멍 추가 (audit:I02)
