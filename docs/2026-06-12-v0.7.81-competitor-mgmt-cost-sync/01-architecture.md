# 01 아키텍처 (v0.7.81)
## 용어 SSOT
lib/gpu/terms.ts — GPU_TERMS 상수(공급사/경쟁사/공급원가/판매가/마진/시장가/공시가/추종가/실견적/검토대기/동기화/등록·수정·삭제·일괄/지정·해제 등). 변경 화면이 import. (전역 i18n 없음 → 도메인 SSOT)
## 경쟁사 관리
- 마이그087: competitors.deleted_at(소프트삭제). 기존 조회(is_active+deleted_at IS NULL) 필터.
- API /api/pricing/gpu/competitors: GET(목록+통계 매핑수/시장가수/연결공급사명), POST(등록), [id] PATCH(수정)/DELETE(소프트), bulk-delete(POST {ids[]}), bulk-promote(POST {ids[]} → promote-supplier 재사용).
- CompetitorsTab: 표(table-card)+검색+다중선택 체크박스 → 일괄삭제·일괄지정 액션바. 등록/수정 모달(useEscClose·tape-title). 겸업/공급사연결 배지.
## 가격 동기화(검토대기형)
- refresh 로직 lib/gpu/market-refresh.ts로 공용화. "경쟁사 가격 동기화" 버튼 → 저장 source_url 재수집 → market_prices 신규행.
- 동기화 반영: 매핑별 최신 market_price가 해당 공급사 최신 active market_link cost와 값 다르면 → status='pending' cost 견적 생성(미반영). 같으면 no-op. (083 source_market_price_id/competitor_id 추적)
- 검토대기: 기존 status='pending' + "검토 대기" 탭/review 라우트. 승인 시 confirmed + 이전 active market_link cost superseded(공급사·상품당 1 active).
## 실견적 우선
repository 견적 조립 단계: product+supplier별로 유효 실견적(source_format≠market_link, confirmed, valid) 존재 시 그 쌍의 market_link 견적을 입력에서 제외 → buildCatalog 본체 무수정. ConfirmedQuote에 출처 플래그 추가(배지).
