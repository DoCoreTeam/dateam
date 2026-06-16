# v0.7.144 — 일일업무 이월 Triage UI 개선 (스크롤 지옥 해소)

## 작업 (1줄)
일일업무 우측 "이월된 미완료 업무"가 무한 세로 적층되는 스크롤 지옥을, 패널 상위 N건 격리 + 반응형 Triage 집중모드(한 건씩 처리) + "전부 오늘로" 일괄로 해소.

## 배경
- 직전 분석(🟦 DC-ANA/BIZ/RES/OSS): 원인 = limit=100 전량을 접힘·격리 없이 카드 적층(19건≈1600px), 우측 컬럼 max-height/overflow 부재.
- 해법 = ①패널 격리+상위N → ②Triage 1건집중. 신규 의존성 0(기존 토큰/모달표준 재사용).

## 격리 전략 (동시 작업 조율)
- **별도 git worktree**: `feature/daily-triage` (`../newAX-daily-triage`). 사용자 main 병렬 작업과 물리 격리.
- 커밋만 수행. **push/npm publish 금지**(메모리 정책 + 이 앱은 npm 패키지 아님).
- 사용자 병렬 작업물 `docs/2026-06-16-work-grouping-dashboard-plan/` 절대 미접촉.

## 수정 파일
1. `apps/web/app/(member)/daily/actions.ts` — 신규 서버액션 2개:
   - `moveAllCarryoverToToday(ids: string[], today: string)` — 일괄 오늘로 (본인 소유 행만, in('id', ids) + eq user_id).
   - `unignoreCarryoverLog(id: string)` — 무시 되돌리기 (is_resolved→false).
2. `apps/web/app/(member)/daily/CarryoverTriageModal.tsx` — **신규** 반응형 Triage 컴포넌트(<300줄). 1건집중 + 3액션 + 진척바 + 일괄 + 무시 되돌리기 토스트.
3. `apps/web/app/globals.css` — `.triage-overlay`/`.triage-sheet`(데스크탑 중앙모달 ↔ 모바일 바텀시트 미디어쿼리), `.triage-*` 보조클래스. 인라인 하드코딩 금지·토큰 사용.
4. `apps/web/app/(member)/daily/page.tsx` — 우측 이월 위젯: 상위 5건 인라인 + "이월 N건 정리하기" 버튼 → Triage 모달 open. 일괄/되돌리기 핸들러 + SWR mutate.

## 이유
- 부수행동(이월 적층)이 주행동(작성)을 화면 밖으로 밀어냄 → 시각 우선순위 복원.
- 무한 리스트(끝 안 보임) → 회피 → 완료율 0% 악순환을, "1건씩 비우기 + 진척 카운트다운"으로 전환.

## 영향 범위
- 직접: daily 일간 뷰 우측 패널. carryover API/데이터 모델 변경 **없음**(읽기 동일, 액션만 추가).
- 무영향: 메모 위젯(이미 6건 제한), 현황요약, 주간/메모 뷰, 부서업무, 주간보고.
- 모바일: 우측 패널이 메인 아래로 쌓이던 문제 → 상위5건+버튼으로 짧아짐, 처리는 바텀시트.

## 완료 조건 (검증)
- [ ] `pnpm exec tsc --noEmit` 0 에러
- [ ] `pnpm design:check` 통과 (hex/치수 하드코딩 0, 토큰 사용)
- [ ] 이월 19건 가정 시 우측 패널 무한 적층 없음(상위5 + 버튼)
- [ ] Triage: 1건씩 [완료][오늘로][무시] 처리 → 다음 카드 + 남은건수 감소
- [ ] "전부 오늘로" 1탭 → 전체 이동 + 토스트
- [ ] "무시" → 되돌리기 토스트로 복구 가능 (데이터 오염 가드)
- [ ] 모바일(<768px) 바텀시트, 데스크탑 중앙 모달
- [ ] 모달 표준: useEscClose · X버튼 · tape-title · --modal-backdrop · --shadow-modal
- [ ] 신규 npm 의존성 0
- [ ] 각 파일 변경 300줄 이내, worktree 커밋(push 없음)

## 데이터 정합 가드 (DC-BIZ 지적)
- "무시"=is_resolved 변경(가역). 되돌리기 미제공 시 무지성 dismiss로 KPI 거짓 정화 위험 → **되돌리기 토스트 필수**.
- "전부 오늘로"=log_date 변경(가역, 수동 복구 가능) → 토스트 안내로 충분.
- 모든 액션 본인 소유 행만(eq user_id) — 기존 패턴 유지.
