# 04 완료 기준 (v0.7.77)

- [x] 마이그084: suppliers.source CHECK에 'competitor_link' 추가·적용
- [x] promote-supplier API: 1클릭 자동생성/재사용·연결·멱등·audit·admin·revalidate
- [x] suppliers GET: is_competitor/linked_competitor_name
- [x] MarketTab "공급사로 지정" 1클릭 버튼(미연결 시) + 기존 드롭다운 병존
- [x] SuppliersTab "경쟁사 겸업" 뱃지 + 자동 등장(통합 노출)
- [x] 콕핏/시장비교 경쟁가↔판매가 동시 + 연계원가 출처 배지(기존 유지)
- [x] 공개 API supplier_id·경쟁사연계 비노출
- [x] Playwright E2E 실증(지정→겸업뱃지→인입→판매가→원복) + 콘솔0
- [x] tsc0 / design:check / test 통과
- [x] DC-QA PASS / DC-SEC PASS / DC-REV 80+
- [x] GATE 1-5 / 버전 v0.7.77(4파일) / commit(push 금지)

## 제외(이번 범위 아님)
- 모델B 회사 통합 테이블, 회사 수백 규모 리팩터링, 자동 원가 인입.
