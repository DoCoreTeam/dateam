# PLAN newAX: 원문 수정 버튼을 저장·취소로, 수정 자리 하나로
플랜 ID: P0018
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0019
목표 버전: v0.10.97
작성: 2026-09-17
시작 커밋: 8ecafccc

## 목표
- 원문을 고치는 중이면 「저장」과 「취소」가 보이고, 한 화면에 둘이던 「수정」이 뜻이 다른 둘로 갈림
- 회의노트 화면에서 언제든 회사·딜을 붙이고 바꿀 수 있음, 붙이면 영업 CRM 미팅에 그대로 나옴
- 회의에서 뽑은 할 일이 개인 일일업무와 딜 양쪽에 보임

## 범위 밖
- 정리(요약·결정사항) 패널 개편
- 녹음·전사 흐름
- 새 회의노트 작성 화면의 본문 칸 (거기엔 작업대가 없어 그대로 둠)
- 이미 쌓인 할 일 40건 소급 이관 (앞으로 만드는 것부터 적용)

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 lib/terms 상수 사용
- 설정값 추가 없음
- 딜이 붙은 회의에서 할 일을 뽑으면 딜 상세 TaskPanel 에 그 할 일이 보임

## 참조
- lib/terms/action.ts (ACTION.save, ACTION.cancel, ACTION.edit)
- lib/meeting/memo-mode.ts (읽기·쓰기 판정 SSOT)
- app/api/crm/meetings/[id]/route.ts (PATCH 회사·딜)
- lib/crm/services/task.ts (crm_task 생성 SSOT)

## 항목

### I01 원문 편집기에 저장·취소
상태: 통과
모드: 경량
범위: apps/web/components/meeting/MeetingMemoEditor.tsx, apps/web/components/meeting/workbench.module.css
감사 기준:
- 쓰기 모드 버튼 줄이 [취소][저장] 두 개, 「닫기」 문자열 없음
- 취소는 수정 진입 시점 글로 되돌리는 PATCH 를 보냄
- 저장은 push() 를 즉시 부르고 성공 시 읽기 모드로 돌아감
- pnpm test 통과
의존: 없음

### I02 상단 수정은 노트 정보만
상태: 통과
모드: 경량
범위: apps/web/app/(member)/meeting-notes/MeetingDetailClient.tsx, apps/web/app/(member)/meeting-notes/MeetingEditor.tsx
감사 기준:
- 상단 버튼 라벨이 「정보 수정」, 편집 폼 mode=edit 에 본문 TiptapEditor 없음
- mode=edit 저장 payload 에 body_html 없음
- 참석자 카드 안내 문구가 새 라벨을 가리킴
의존: I01

### I03 회의노트에서 회사·딜을 언제든 붙이고 바꾼다
상태: 통과
모드: 경량
범위: apps/web/app/(member)/meeting-notes/CrmPublishCard.tsx, apps/web/app/api/meeting-notes/[id]/share/route.ts
감사 기준:
- 이미 올린 회의(state=TEAM/RECORD_ONLY)에서도 팝오버에 회사·딜 선택칸이 보임
- 고르면 PATCH 로 crm_meeting.companyId/dealId 가 바뀌고 회의노트 메타 줄에 이름이 뜸
- CRM 멤버가 아니면 칸 자체가 안 보임
의존: 없음

### I04 뽑은 할 일이 딜로도 간다
상태: 대기
모드: 중량
범위: apps/web/app/(member)/meeting-notes/actions.ts, apps/web/lib/crm/services/task.ts, apps/web/prisma/schema.prisma, supabase/migrations 신규
감사 기준:
- 딜이 붙은 회의에서 할 일을 뽑아 확정하면 daily_logs 와 crm_task 양쪽에 생김
- crm_task 에 dealId, companyId, 출처 회의 id 가 실림
- 같은 회의에서 같은 제목을 두 번 뽑아도 crm_task 는 하나 (멱등)
- 딜이 안 붙었거나 CRM 멤버가 아니면 daily_logs 만 생기고 오류 없음
의존: I03

### I05 제안으로 만든 할 일에도 딜이 붙는다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/services/suggestion.ts
감사 기준:
- NEXT 제안 수락으로 만든 crm_task 에 그 미팅의 dealId, companyId 가 실림
- 미팅에 딜이 없으면 종전대로 null 이고 오류 없음
의존: 없음

### I06 가드와 업데이트 내역
상태: 대기
모드: 경량
범위: apps/web/lib/meeting/workbench-wiring.test.ts, apps/web/lib/crm/wired.test.ts, apps/web/lib/changelog/entries.ts, package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- 가드가 ① 쓰기 모드 저장·취소 ② 편집 폼이 body_html 을 안 보냄 ③ 뽑기가 crm_task 경로를 부름 ④ 제안 할 일이 dealId 를 실음 을 잠금
- 가드를 일부러 깨면 실패함을 확인
- pnpm test, tsc, build 통과
의존: I05

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-17) 최초 작성 (ins_0019)
