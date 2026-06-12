# 04 완료 기준 (v0.7.81)
- [ ] lib/gpu/terms.ts 용어 SSOT + 변경화면 import
- [ ] 마이그087 competitors.deleted_at 적용
- [ ] api/competitors: 목록(+통계)/등록/수정/소프트삭제/일괄삭제/일괄 공급사지정 (admin·audit·RLS)
- [ ] CompetitorsTab: 목록·검색·다중선택 일괄삭제·일괄지정·등록/수정 모달·겸업배지·탭등록
- [ ] "원가 인입" 항목버튼 제거 + "경쟁사 가격 동기화" 1버튼
- [ ] 값 변경 시 status='pending' 생성(미반영)·동일값 no-op·검토대기 노출·승인 시 confirmed+supersede
- [ ] 실견적 우선(market_link 제외)·만료 폴백·출처배지(추종가/실견적)
- [ ] 공개 API 비노출 / Playwright 실증·원복 / tsc0·design·test / DC-QA·SEC·REV 80+ / GATE1-5 / 버전4파일·commit
## 제외
전역 i18n 전환, 경쟁사별 사이트 파서 신규개발(저장 URL 재수집은 기존 refresh 재사용 범위), 크론 자동화(다음).
