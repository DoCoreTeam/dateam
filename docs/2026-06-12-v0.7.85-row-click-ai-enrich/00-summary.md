# v0.7.85 — 행클릭 통일 + AI 회사정보 자동채움
## 작업
①경쟁사 표 행클릭→정보·수정 모달(공급사와 통일). ②공급사·경쟁사 등록/수정 모달에 AI 회사정보 자동채움(Gemini).
## 변경
- lib/gpu/company-enrich.ts(신규): Gemini로 회사명·URL→설명/국가코드/유형/위치/웹사이트/가격URL 추정. responseMimeType json·temp 0.1.
- api/pricing/gpu/company-enrich(신규): admin·org_content META(gemini key)·token 로깅. 제안만 반환(DB 자동쓰기 없음, §5-3).
- types/database.ts: AiFeature += 'gpu-company-enrich'.
- CompetitorsTab: 행 onClick→setEditRow(통일), 체크박스/관리셀 stopPropagation. CompetitorModal+CreateModal(공급사) "AI로 채우기" 버튼 + 이름 blur 자동제안(빈 필드만 채움, 편집 가능).
## 검증
Playwright: company-enrich(RunPod→설명·US·specialist·URL 정확) / 경쟁사 행클릭→수정모달+AI버튼. tsc0/design/test72. AI는 읽기전용 제안(원복 불요).
