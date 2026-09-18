# PLAN newAX: 탭 배지는 기다리는 것만 센다
플랜 ID: P0025
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0025
목표 버전: v0.10.146
작성: 2026-09-19
시작 커밋: 465a3a93

## 목표
- 퇴사자 탭에서 숫자 배지가 사라짐, 한 번 보고 나면 계속 따라다니지 않음
- 퇴사자가 몇 명인지는 그 탭에 들어가면 제목 옆에서 봄
- 배지 규칙에 「분류의 크기는 배지가 아니다」가 글로 남아 같은 실수가 다시 안 남

## 범위 밖
- 다른 배지(루틴 미점검, 오늘 일정, 내 미완료 업무, CRM 확인 대기, 콘텐츠 검토 대기) 건드리기
  — 전수로 봤더니 그것들은 전부 기다리는 것이라 규칙에 맞음
- 배지 모양이나 색

## 완료 정의
- pnpm tsc --noEmit, pnpm test 통과
- 브라우저 실측: 구성원 관리 탭줄에 숫자 배지 0개, 퇴사자 탭 안에는 인원수가 보임
- lib/terms/badge.ts 에 규칙이 글로 있음

## 참조
- apps/web/lib/terms/badge.ts 배지 규칙 넷

## 항목

### I01 퇴사자 탭 배지를 뗀다
상태: 통과
모드: 경량
범위: apps/web/app/admin/members/page.tsx, apps/web/lib/terms/member.ts, apps/web/lib/terms/badge.ts, apps/web/e2e/member-resign.spec.ts
감사 기준:
- 구성원 관리 탭줄에 숫자 배지가 0개 (브라우저 실측)
- 퇴사자 탭에 들어가면 제목 옆에 인원수가 보임
- badge.ts 에 다섯째 규칙이 적혀 있음
- 안 쓰게 된 RESIGNED_TAB.badgeMeaning 이 남아 있지 않음
의존: 없음

### I02 판 번호
상태: 대기
모드: 경량
범위: package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- 다섯 파일의 판 번호가 같고 커밋 직전 다시 계산한 다음 패치임
- node --test lib/policy/policy-sync.test.ts lib/policy/version-rule.test.ts 통과
의존: I01

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-19) 최초 작성 (ins_0025)
