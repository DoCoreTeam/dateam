# 04 완료 기준 — v0.7.167 프로젝트 고도화 + 성능

## ① projects 고도화
- [ ] mig111: projects에 year/quarter/half/month/start_date/end_date/budget/currency/status 추가(additive nullable) + project_members 테이블 + RLS(default-deny) — 실DB 적용
- [ ] projects CRUD가 신규 필드 전부 처리(생성/수정/조회), 멤버 add/remove
- [ ] 기존 name-only 프로젝트·work_entity_links 무회귀
## ② AI 예상 프로젝트
- [ ] /api/work/projects/suggest: 업무 분석 기반 후보(name·근거·업무수) 반환, 자동생성 금지(제안만), 본인 RLS
- [ ] UI: 후보 체크리스트→확정 생성(§5-3 추출형), 콜드스타트 빈상태
## ③ 메뉴
- [ ] WorkTabBar에 '프로젝트' 탭(/work/projects), projects 페이지 WorkPageShell 골격(4화면과 동일)
## ④ 성능
- [ ] loading.tsx: member 주요 라우트 스켈레톤
- [ ] 미들웨어 role 캐시(DB왕복 제거, 실패시 폴백)
- [ ] weekly/dept 서버쿼리 병렬화
- [ ] layout 배지 캐시 + profiles 중복조회 제거
## 공통
- [ ] 프로젝트 폼: 날짜(연도/분기/상하반기/월)·기간·예산·인원 입력 + input-field/label·모달표준
- [ ] 검색·정렬·필터·페이지네이션·URL상태·로딩/빈/에러 유지
- [ ] tsc0 · design · DC-QA/SEC/REV · GATE1-5 · additive(공개 안전)
