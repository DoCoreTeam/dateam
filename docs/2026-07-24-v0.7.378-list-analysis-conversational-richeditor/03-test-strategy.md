# 03 — 테스트 전략

## 단위 (node:test — package.json test 목록에 추가 필수)
- `html-to-markdown.test.ts`: HTML 표→파이프표, 헤딩, 리스트, 중첩, 빈 셀, `<br>`, XSS 태그 무해화. **기존 html-to-plain.test.ts 무변경 확인**(회귀 0).
- `cut-groups` 표 원자화: 표를 가로지르는 절단이 발생하지 않음(표 앞뒤로만 경계). 표+본문 혼합 fixture.
- RichText sanitize: table 태그 허용 + 속성(onclick/style) 제거 유지.
- 대화 서버액션(순수 부분): 메시지 seq 증가·revision 필터·확정 스냅샷 로직.

## 회귀 (유실0 계약 — 최우선)
- 원본 HTML 저장 실패 시나리오에서도 데이터 유실 0(원본 우선 저장).
- md 정규화 실패 → 원본 보존 확인.
- 재그룹 후 표 인식 일관(리비전 전환에도 표 유지).

## 통합/E2E (Playwright, 실브라우저 — 정적검증만으론 런타임버그 못잡음)
- 표 포함 문서 붙여넣기 → 그룹에 표 원자 유지 → 항목 대화 → 종합 문서에 표 렌더 → md/pdf 다운로드에 표 보존.
- 완료 세션 재열람 = AI 재호출 0(네트워크 관찰), 대화 이력 로드.
- 파일(xlsx) 업로드 → 표 md 확인.

## 게이트
tsc 0 · 전체 node:test green · design:check · next build(React18 런타임 검증) · 실브라우저 throwaway 데이터(운영 오염 금지).
