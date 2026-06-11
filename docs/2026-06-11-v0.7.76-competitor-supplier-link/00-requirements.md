# 00 Requirements — 경쟁사 공급사 연계
## 배경
경쟁사가 공급사이기도 함(시스템 연계로 그 가격을 원가로 공급받음). 현재 competitors/suppliers 완전 별개, 인입 경로 0, 경쟁사 일람·연결 수단 없음.
## 기능 요구
- FR1 competitors.supplier_id로 경쟁사↔공급사 연결
- FR2 시장비교 탭에서 경쟁사별 공급사 연결 + 시장가→원가 인입(승인)
- FR3 인입 시 supply_quotes cost 생성(스냅샷·출처·audit) → buildCatalog +마진 판매가 자동
- FR4 3탭 일관: 경쟁사(시장비교 경쟁가), 공급사(원가+판매가+배지), 가격결정(판매가+연계원가 출처배지)
## 비기능(가드레일)
- 자동 인입 금지(승인만). 인입 스냅샷 불변. 시장참고가↔실원가 출처 구분. 공개 API supplier_id 비노출. buildCatalog SSOT 불변. admin 게이트+audit.
## 제외
- 회사 통합 리팩터링, 경쟁사 전체 CRUD(연결만), 자동 인입.
