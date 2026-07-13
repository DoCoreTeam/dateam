# 세션2 완료기준 (설계서 §8 매핑 + 검증방법 + 상태)

각 항목: [구현대상] · [검증방법] · [상태]. net-new=이 브랜치 구현/검증, integ=integration-spec 명세.

| # | §8 항목 | 구현대상 | 검증방법 | 상태 |
|---|---|---|---|---|
| 1 | 업로드 3경로(버튼/드래그/붙여넣기)+Storage+ai_attachments+칩/썸네일+전송전삭제 | upload route(net-new) + Composer(integ) | 코드리뷰 + 수동 | ⬜ |
| 2 | office(docx/xlsx/pptx) ZIP시그니처 검증 → 텍스트추출(officeparser,100k절단) | attachments.ts(net-new) | 단위테스트+수동 | ⬜ |
| 3 | 멀티모달 Claude/Gemini/OpenAI 매핑 | attachments.ts(net-new)+providers(integ) | 단위테스트 | ⬜ |
| 4 | 복원 getMessages 첨부(신규 서명URL) | actions.ts(integ) | 코드리뷰 | ⬜ |
| 5 | 미지원 프로바이더 3중방어(UI/API400/히스토리 폴백) | attachments.fallback(net-new)+Composer/stream(integ) | 단위테스트+리뷰 | ⬜ |
| 6 | 재생성: 마지막 assistant update치환+현재 provider재스트림+feedback리셋 | stream/route(integ) | 리뷰 | ⬜ |
| 7 | 편집분기: parent_message_id+buildActiveThread 재구성+원본보존 | thread.ts(net-new)+stream/actions(integ) | 단위테스트+리뷰 | ⬜ |
| 8 | 검색: sanitize+제목/본문 2쿼리 병합+{ok,items}봉투+사이드바 UI | search.ts(net-new)+actions/sidebar(integ) | 단위테스트+리뷰 | ⬜ |
| 9 | pin: 고정됨/최근 2섹션 | sidebar(integ) | 리뷰 | ⬜ |
| 10 | 시스템프롬프트: 모달(5체크)+streamChat system 주입 | SystemPromptModal(net-new)+actions/stream(integ) | design대조+리뷰 | ⬜ |
| 11 | thinking: 접이식+영속복원 재표시+미지원 미렌더 | MessageBubble(integ) | 리뷰 | ⬜ |
| 12 | 피드백 👍/👎 토글 저장/해제 | actions.setMessageFeedback(integ) | 리뷰 | ⬜ |
| 13 | RLS: ai_attachments admin+owner default-deny + Storage 정책 | migration 151(net-new) | SQL리뷰+DC-SEC | ⬜ |
| 14 | 보안: mime화이트리스트+kind별용량+매직바이트+파일명sanitize+서명URL 1h+5개/20MB상한+고아24h | attachments.ts+upload route(net-new) | 단위테스트+DC-SEC | ⬜ |
| 15 | 품질게이트: tsc 0 · 단위테스트 3파일(package.json 등재) · design:check | 전체 | 격리:단위테스트 / 머지후:tsc·design | ⬜(부분) |
| 16 | 리뷰: DC-REV + DC-SEC(업로드 취약점) | — | 에이전트 | ⬜ |
| 17 | 산출물: migration 151 파일 생성(적용=사용자) · 로컬커밋(push=사용자) | — | 수동확인 | ⬜ |

## EXEC-001 준수
완료 선언 = 위 표 전항목 상태 확정 후에만. net-new 항목은 실제 통과, integ 항목은 spec 완결 + 리뷰 통과로 정의.
격리로 검증 불가한 항목(tsc 전체·수동 멀티모달)은 "세션1 머지 후 확정"으로 명시(허위 완료 금지).
