# 04 — 완료 기준

## 기능 완료 (전부 ✅ 필요)
- [ ] C1 Stage1~7 모듈 전부 존재 + 계약대로 동작
- [ ] C2 9개 실패모드(F1~F9) 각각 골든 케이스로 해소 입증
- [ ] C3 타겟 xlsx → 검토대기: T4 ≈ 0.81 USD/hr(1장 시간당), 업체≠명부, target=own_target
- [ ] C4 gcube 정상 카탈로그 회귀 0
- [ ] C5 변형 fixture 2종(미지 형식) 정상 흡수
- [ ] C6 저신뢰/정합위반 → needs_human 플래그로 사람 게이트行 (조용한 오답 0)

## 품질 게이트
- [ ] C7 단위테스트 전부 통과 (package.json test 목록 등재)
- [ ] C8 DC-QA 통과(CRITICAL/HIGH 0)
- [ ] C9 DC-SEC 통과(수식인젝션·키노출·입력검증)
- [ ] C10 DC-REV 80+ 점
- [ ] C11 GATE 1-5: tsc / lint / test / build / design:check 통과

## 실UI 검증 (사용자 필수 지침)
- [ ] C12 Playwright로 throwaway 계정 실UI에서 타겟 xlsx 업로드→검토대기 정상 표시 스크린샷
- [ ] C13 is_test 행만 사용, 검증 후 정리(운영 오염 0)

## 마무리
- [ ] C14 버전 0.7.223 — package.json(root+apps/web)·CLAUDE.md·AGENTS.md 동기화
- [ ] C15 git commit (메시지 끝 'claude'). **push/publish 안 함**(사용자 지침)
- [ ] C16 DOC-FIRST 5종 + .ralph/decisions 결정 내역

## EXIT_SIGNAL 조건
C1~C16 전부 ✅ → .ralph/status.json exit_signal:true + active:false.
그 전 멈춤은 엔진이 자동 재개(Circuit Breaker 제외).
