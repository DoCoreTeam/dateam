# 04 Completion Criteria
## 기능
- [x] C1 competitors.supplier_id FK(마이그083)
- [x] C2 시장비교 탭 공급사 연결 UI 동작
- [x] C3 시장가→원가 인입(승인) → supply_quotes cost 생성(스냅샷·출처·audit)
- [x] C4 인입원가→buildCatalog +마진 판매가 자동형성
- [x] C5 3탭 일관: 공급사 "경쟁사 연계" 배지 / 가격결정 "연계 원가" 출처 배지 / 시장비교 경쟁가↔우리가
- [x] C6 공개 API supplier_id/연계 비노출
## 가드레일
- [x] G1 자동 인입 없음(명시 승인만)  G2 인입 스냅샷 불변  G3 admin 게이트  G4 audit 'market_cost_ingested'
## 품질
- [x] Q1 tsc0 Q2 design Q3 test Q4 E2E Q5 DC-QA Q6 DC-SEC Q7 DC-REV80+ Q8 회귀0(buildCatalog/기존 견적 불변)
## 마무리
- [x] M1 v0.7.76(4파일) M2 docs M3 commit(push금지)
