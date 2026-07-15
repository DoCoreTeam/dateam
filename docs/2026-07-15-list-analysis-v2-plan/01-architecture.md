# 01 · 아키텍처 (명령 주도 파이프라인)

> 원칙: 신규 구축 아님 — v1 `/ai-chat/analyze`의 **3개 개조 + 스키마 확장 + 크론 드레인 1신규**.

## 1. 파이프라인
```
사용자 명령(command) + 문서
 → [추출]   parseListItems(결정론 무손실) + AI 보정 병합(유실0 계약)
 → [맥락]   2패스: (1)결정론 원문앵커 source_text.indexOf→감싸는 섹션
                    (2)AI 의도주석(idx 참조 JSON only = 항목 재출력 안 함 → 왜곡 구조 불가)
 → [심층]   항목마다 (항목+맥락팩+command) system+user 확산 전개. 서버 워커풀 K개.
             상태 전이 DB 즉시 기록(pending→running→done/error)
 → [취합]   항목 다이제스트 → (예산초과시 그룹 collapse) → 완성형 통합
             → 커버리지 게이트(코드) → idx 단위 패치 JSON 흐름교정
```

## 2. 실행 주체 = 서버 + DB (브라우저는 관전자)
- **오케스트레이터**: 신규 `POST /api/admin/ai-chat/analyze/stream` — 기존 `stream/route.ts`의 `sse()`·`ReadableStream`·`runtime=nodejs`·`maxDuration` 골격 복제. pending/error 항목을 원자적 claim → 워커풀 실행 → 상태전이 DB 기록 + SSE emit. 함수 시간예산 임박 시 `drained:false` 반환.
- **크론 드레인 워커**(Q1=Vercel): 신규 `GET /api/cron/analyze-drain` + `vercel.json` crons 등록. 미완 세션을 주기적으로 claim·진행 → **브라우저 이탈해도 계속**. (셀프호스트 전환 시 장수명 워커로 교체, 인터페이스 동일)
- **클라이언트**: `sse.ts` 파서 공용 수신. 단절 시 `getAnalysisSession` 폴링 폴백. 실행 주체 아님.

## 3. 무손실 취합 (G2 해법 — 핵심 안전장치)
- 30k slice **제거**. map: 항목별 다이제스트에 `[#idx]` 강제. reduce: 전체 인벤토리 + 다이제스트 단일 취합(Gemini 1M → 비용이 실제 제약). 예산 초과만 그룹 collapse.
- **커버리지 게이트(코드)**: 출력의 `[#idx]` 집합 vs 전체 idx 대조 → 누락 시 보수 패스 1회 → 그래도 누락이면 **원문 다이제스트를 부록에 결정론 append**(어떤 경우에도 전 항목 물리 존재).
- "이상한 것만 수정" = 전면 재작성 금지 → **idx 단위 패치 JSON만 받아 코드가 적용**(비패치 = 무왜곡 증명).

## 4. 실시간 (G3 해법)
- 진행률을 **저장하지 않음** — `count(status)` 파생만이 "하드코딩 금지"의 정답(`listAnalysisSessions` 임베드 집계 doneCount 파생 확장).
- 서버 전이 → SSE emit + DB 기록. 열람 항목만 text delta. 사내 선례: `pricing/gpu/review/stream`, `reports/aggregate-stream`.

## 5. 임의 중단 / 재개 (§9)
- 세션 `control`(running/paused/cancelled). UI 버튼 → DB 플래그 set(왕복 1회, 즉시 체감). 워커는 항목 착수 전 확인.
- pause=진행 항목 완료 후 착수 중단(토큰 낭비 방지). cancel=`AbortController` in-flight 중단(provider.streamChat `signal` 하향 전파), 완료분 보존.
- resume=DB done/error 복원 + 미완 크론/재-POST 이어감(멱등 claim). stall: `running & claimed_at<now-10m` → 재claim.

## 6. 프롬프트 계약
- command/항목/원문 **분리 주입**: `callGemini` `system` 파라미터(provider.ts `system?` 기지원, gemini `system_instruction` 매핑). 인젝션·희석 방지.
- lens 5종 → command 프리셋 버튼으로 흡수(별도 분기 제거).

## 7. 모듈 재사용 / 개조 / 신규
- **그대로**: list-extract·provider/gemini·sse.ts·document-extract·export 4종·token-logger·requireAdminApi·157 RLS.
- **개조**: synthesizeInsights(계층화)·analyzeItem(스트리밍/맥락)·runWithConcurrency(lib 승격+백오프).
- **신규**: analyze/stream 라우트·cron/analyze-drain·맥락앵커 순수모듈·계층취합 순수모듈(둘 다 단위테스트).
