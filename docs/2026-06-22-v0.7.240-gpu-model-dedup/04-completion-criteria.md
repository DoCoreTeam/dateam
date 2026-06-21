# 04 Completion Criteria

## 사용자 종료조건
- [ ] 앞으로 같은 모델(캐노니컬)+세부데이터 중복 0 — 같은공급사 재견적=최신화, 동일 재입력=멱등
- [ ] 기존 유령 219행 안전 정리(소프트삭제+백업, 롤백 가능), 시드/gcube/견적행 보존
- [ ] 보수적 캐노니컬 — 오병합 0(Ada/Pro/Quadro/숫자차 분리)
- [ ] 완전 자동 — 신규 화면 0, 사용자 추가 작업 0
- [ ] 브라우저 E2E 확인

## 기능
- [ ] canonicalizeModel SSOT + 테스트
- [ ] confirm 매칭 (canonical,memory,gpu_count) 하드-dedup + 최신화
- [ ] ensureStandardConfigs 유령생성 차단
- [ ] 마이그 129: 백업 + 유령 소프트삭제 + 검증

## 시스템
- [ ] DC-QA / DC-SEC(CRIT 0) / DC-REV 80+
- [ ] GATE 1-5: tsc 0 / lint 0 / test 그린 / next build ✅ / design ✅
- [ ] 가격 회귀 0(confirmed 단가 불변 실측)
- [ ] 버전 0.7.240(4파일) + commit(push 금지)
