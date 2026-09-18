# PLAN newAX: 퇴사자는 별도 탭으로 뺀다
플랜 ID: P0021
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0023
목표 버전: v0.10.132
작성: 2026-09-18
시작 커밋: e7f28047

## 목표
- 사용자 관리 목록에 재직자만 보임, 이름순으로 훑을 때 퇴사자가 사이사이 끼지 않음
- 퇴사자는 「퇴사자」 탭에서 따로 봄, 탭에 몇 명인지 숫자가 붙음
- 퇴사자 탭에는 퇴사일이 보이고 되돌리기를 거기서 함

## 범위 밖
- 퇴사자 목록에서의 일괄 작업
- 퇴사 사유별 분류나 통계
- 조직도 관리 직급 직책 탭

## 완료 정의
- pnpm tsc --noEmit, pnpm test 통과
- 사용자 노출 문자열은 lib/terms 상수 사용
- 브라우저 실측: 사용자 관리 탭에 퇴사자 0명, 퇴사자 탭에 그 사람이 있음
- 같은 뜻의 조작이 두 벌이 되지 않음 (탭이 거르개를 대신하므로 재직 여부 거르개는 없앰)

## 참조
- .loop/archive/P0019-v0.10.98-퇴사-처리와-구성원-상세.md 의 I04 (거르개로 만들었던 항목)
- apps/web/lib/terms/badge.ts 배지 규칙 넷

## 항목

### I01 퇴사자 탭 신설
상태: 통과
모드: 경량
범위: apps/web/app/admin/members/page.tsx, apps/web/app/admin/users/UserTable.tsx, apps/web/lib/terms/member.ts, apps/web/e2e/member-resign.spec.ts
감사 기준:
- 구성원 관리에 탭이 넷이 되고 둘째가 퇴사자임
- 사용자 관리 탭 목록에 퇴사자가 한 명도 없음 (브라우저 실측)
- 퇴사자 탭에 그 사람이 있고 퇴사일 칸이 보임
- 재직 여부 거르개가 도구줄에서 사라짐 (탭과 뜻이 겹침)
- 퇴사자 0명이면 탭 배지를 그리지 않음 (배지 규칙 2)
의존: 없음

### I02 판 번호
상태: 대기
모드: 경량
범위: package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- 다섯 파일의 판 번호가 같고 커밋 직전 다시 계산한 다음 패치임
- node --test lib/policy/policy-sync.test.ts lib/policy/version-rule.test.ts 통과
- 관리자 전용 화면이라 업데이트 내역은 건너뜀, 사유를 요약에 적음
의존: I01

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-18) 최초 작성 (ins_0023)
