# PLAN newAX: C레벨이 있으면 본부가 한 줄 내려간다
플랜 ID: P0020
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0022
목표 버전: v0.10.130
작성: 2026-09-18
시작 커밋: 61611c5c

## 목표
- C레벨(CTO 같은 역할 노드)이 형제에 있으면 본부들이 그 줄이 아니라 한 줄 아래에 놓임
- 그래서 본부가 CTO 의 하위(연구소 개발본부)와 같은 줄에 서고, CTO 는 그 위 줄을 혼자 씀
- 미는 것은 여백이 아니라 트리 레벨임, 접기 드래그 연결선이 그 레벨을 따라감

## 범위 밖
- C레벨 판정 규칙 바꾸기 (지금처럼 노드 종류가 role 인 것을 C레벨로 봄)
- 사람 카드 세로 칸의 배치
- 조직도 확대 축소 조작

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 브라우저에서 CTO 윗변이 성장지원본부 윗변보다 위에 있고, 성장지원본부 윗변이 연구소 윗변과 같음
- 앞 판에서 만든 org-tree-grid 가드가 새 규칙에 맞게 고쳐져 통과함

## 참조
- .loop/archive/P0019-v0.10.98-퇴사-처리와-구성원-상세.md 의 I08a (같은 자리를 반대로 고쳤던 항목)
- apps/web/app/admin/org-chart/OrgTree.tsx

## 항목

### I01 C레벨 아래로 본부를 한 레벨 내린다
상태: 통과
모드: 경량
범위: apps/web/app/admin/org-chart/OrgTree.tsx, apps/web/e2e/org-tree-grid.spec.ts
감사 기준:
- 형제에 role 이 있으면 department 는 빈 칸 한 레벨을 거쳐 그 아래 줄에 그려짐
- 브라우저 실측: CTO 윗변 < 성장지원본부 윗변, 성장지원본부 윗변 == 연구소 윗변 (1px 이내)
- 같은 줄에 놓인 카드끼리는 윗변과 높이가 여전히 1px 이내로 맞음
- 가드를 일부러 깨면 실패함
의존: 없음

### I02 판 번호와 업데이트 내역
상태: 대기
모드: 경량
범위: package.json, apps/web/package.json, .claude/heavy/CEO.md, AGENTS.md, GEMINI.md
감사 기준:
- 다섯 파일의 판 번호가 같고 커밋 직전 다시 계산한 다음 패치임
- node --test lib/policy/policy-sync.test.ts lib/policy/version-rule.test.ts 통과
- 어드민 전용 화면이라 업데이트 내역은 건너뜀, 사유를 요약에 적음
의존: I01

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-18) 최초 작성 (ins_0022)
