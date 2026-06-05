# 리드인테이크 3개 버그픽스
작업: ①오버레이 브랜드 SSOT(getBranding) ②저장후 완료배너+초기화 ③도구버튼 별도행(오버랩 제거)
대상: lead-intake/page.tsx, LeadIntakeForm.tsx
이유: 옛 org_content META(AX사업본부) 읽음 / 저장후 미초기화·무안내 / 📎 절대오버레이가 클릭 가림
영향: 프론트 2파일 / 백엔드 무변경
검증: 오버레이=데이터얼라이언스, 도구버튼 별도행·클릭최상단, 저장→입력초기화 true+완료배너. DC-REV: created 좀비분기 제거+handleFileCreate 가드 반영.
