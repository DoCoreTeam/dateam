# 개발자센터 다국어 코드 예시 보강 (v0.7.117)

## 요구
개발자센터(`/develop`)가 curl 위주(인증만 JS·Python)였음. "누구나 이것만 보면 바로" 하도록 모든 엔드포인트에 언어별 예시 제공.

## 결정 (요즘 표준 개발자센터 기준)
- **언어 7종**: curl · JavaScript(Node) · Python · Go · PHP · Java · C#(.NET)
- **제외**: React/Vue(프레임워크 — JS 탭이 커버, 키 노출 위험으로 서버사이드 권장) · ASP(→C#) · JSP(→Java)

## 아키텍처 (SSOT)
- `lib/api-docs/snippets.ts` — `RequestSpec`(method/path/query/body) 1개 → 7개 언어 스니펫을 **결정적 생성**. 손코딩 복붙 없음(드리프트 방지). 순수 함수.
- `lib/api-docs/snippets.test.ts` — 생성기 단위테스트 10종(언어 존재·URL/인증헤더·결정성·언어별 핵심 토큰).
- `app/develop/CodeTabs.tsx` — 언어 탭 UI(client). spec+baseUrl 받아 7탭 렌더, 탭별 복사, `role=tablist/tab`.
- `app/develop/page.tsx` — 전 엔드포인트 요청 예시를 `CodeBlock(curl)` → `<CodeTabs spec=…>`로 교체(23곳). JSON 응답 예시는 언어무관이라 유지. 빠른시작·인증 메인 예시도 탭화, 중복 손코딩 JS/Python 제거.

## 변경 파일
- 신규: `lib/api-docs/snippets.ts`, `lib/api-docs/snippets.test.ts`, `app/develop/CodeTabs.tsx`
- 수정: `app/develop/page.tsx`(요청 예시 23곳 CodeTabs화), `apps/web/package.json`(test 목록에 snippets.test 추가)

## 완료 조건
- [x] 7개 언어 생성기 + 단위테스트 10종 PASS
- [x] 모든 주요 엔드포인트(제품·견적·재고·환율·공급사·시장·설정·풀재고·거래처·담당자·영업기회) 요청 예시 언어 탭화
- [x] 빠른시작·인증 언어 탭화
- [x] 키 노출 방지 안내(JS=서버사이드 Node, 브라우저 직접 호출 금지)
- [x] tsc(내 파일) 0 · design:check 통과 · DC-REV
- 제외: 백엔드 API 변경, Ralph 카탈로그(미관여), pagination 개념 예시(언어무관 2-step이라 curl 유지)

## 영향/회귀
- 표시 콘텐츠만. 백엔드/라우팅 불변. `CodeBlock`(JSON 응답·개념 예시)은 유지.
- 미사용이 된 `exampleKey` prop은 일부 섹션에 남으나 무해(tsc 통과). 후속 정리 가능.
