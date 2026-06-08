# 04 Completion Criteria

라인별 ✅/❌ 게이트. 전부 ✅여야 EXIT_SIGNAL.

## 기능
- [ ] C1 1·2·4·8 정규화가 review confirm / quotes POST / 직접 CRUD 3경로 모두 적용
- [ ] C2 비표준(x3 등) → 다음 표준단 올림 + 1장환산 가격 (단위테스트 통과)
- [ ] C3 가격표 비표준 노출 0 (E2E 확인)
- [ ] C4 4탭 전부 CRUD 동작 (각 엔티티 C/U/D)
- [ ] C5 한 곳 수정 → 4탭+파생 자동 반영, settings/fx stale 0
- [ ] C6 통합입력 데이터 사후 편집/삭제 가능

## 가드레일
- [ ] G1 소프트삭제(deleted_at) + 참조검사 동작
- [ ] G2 admin 게이트 — member 쓰기 차단
- [ ] G3 audit log 기록(actor/action/before/after)
- [ ] G4 변경 영향 프리뷰 표시

## 품질
- [ ] Q1 typecheck 0
- [ ] Q2 design:check PASS
- [ ] Q3 단위 테스트 PASS
- [ ] Q4 E2E PASS
- [ ] Q5 DC-QA PASS (CRITICAL/HIGH 0)
- [ ] Q6 DC-SEC PASS
- [ ] Q7 DC-REV 80+
- [ ] Q8 반응형/디자인토큰/테이블카드 준수

## 마무리
- [ ] M1 버전 v0.7.63 (package.json·apps/web/package.json·CLAUDE.md·AGENTS.md)
- [ ] M2 docs 갱신
- [ ] M3 commit (push 금지)
