# 02 · 태스크 분해 (의존성 순)

> MVP(v2.0)만. 각 태스크 = 담당 에이전트 · 산출 · 검증. 구현 GO 후 실행.

## 배치 A — 스키마 + 순수 코어 (의존성 없음, 병렬 가능)
| T | 내용 | 담당 | 검증 |
|---|---|---|---|
| A1 | 마이그 158: `ai_analysis_sessions` +(`command`,`phase`,`control`,`run_claimed_at`,`cron_managed`,`synth_status`,`synth_text`,`coverage`) · `ai_analysis_items` +(`context_excerpt`,`intent_note`,`span_start/end`,`digest_text`,`error_text`,`attempts`,`claimed_at`,`started_at`,`finished_at`,`prompt_tokens`,`output_tokens`). 157 RLS·트리거 패턴 유지 | 🟩 DC-DEV-DB | migrate.sh --status ✅, RLS owner-only |
| A2 | 맥락앵커 순수모듈 `lib/ai-chat/context-anchor.ts`(source_text.indexOf→감싸는 섹션 span) + 단위테스트 | 🟩 DC-DEV-BE | 앵커 span 정확·이미지 폴백 |
| A3 | 계층취합 순수모듈 `lib/ai-chat/synthesize-hierarchical.ts`(다이제스트 collapse + `[#idx]` 커버리지 게이트 + 부록 append) + 단위테스트 | 🟩 DC-DEV-BE | 누락 idx 탐지·부록 강제 |
| A4 | `runWithConcurrency` → `lib/ai-chat/concurrency.ts` 승격 + 지수 백오프 + 단위테스트 | 🟩 DC-DEV-BE | 순서보존·백오프·예외격리 |

## 배치 B — 오케스트레이터 + 크론 (A 의존)
| T | 내용 | 담당 | 검증 |
|---|---|---|---|
| B1 | `POST /api/admin/ai-chat/analyze/stream`: 원자 claim→워커풀→상태전이 DB+SSE→드레인 반환 | 🟩 DC-DEV-BE | claim 원자성·SSE emit·시간예산 |
| B2 | `GET /api/cron/analyze-drain` + `vercel.json` crons: 미완 세션 이어받기(멱등) | 🟩 DC-DEV-BE·OPS | 이탈 후 계속·중복실행0 |
| B3 | control 처리: pause(항목경계 중단)·cancel(AbortController 하향)·stall 재claim | 🟩 DC-DEV-BE | 즉시성·완료분 보존·고아0 |
| B4 | analyzeItem 개조: command+맥락팩 system 주입·항목 delta 스트리밍 | 🟩 DC-DEV-BE | 분리주입·delta |
| B5 | synthesizeInsights 개조: 30k slice 제거→A3 호출·패치 JSON 적용 | 🟩 DC-DEV-BE | 무손실·패치무왜곡 |

## 배치 C — UI (B 의존)
| T | 내용 | 담당 | 검증 |
|---|---|---|---|
| C1 | AnalyzeClient: command 입력·프리셋 버튼(lens 흡수)·SSE 수신·폴링 폴백 | 🟩 DC-DEV-FE | 상태 파생·단절복구 |
| C2 | 진행 UI: 항목 status 실시간·열람 항목 delta·취소/일시정지 버튼(1급) | 🟩 DC-DEV-FE | 하드코딩0·즉시반응 |
| C3 | 완성형 보고서 뷰 + export 4종(md/txt/pdf/docx) 연결·부분완료 즉시 열람 | 🟩 DC-DEV-FE | 커버리지 배지·부분활용 |
| C4 | 세션 List/CRUD/검색·정렬·필터·페이지네이션·완료 알림(activity 재사용) | 🟩 DC-DEV-FE | Feature Defaults 충족 |

## 배치 D — 평가 (병렬)
🟥 DC-QA(경계·유실0 시나리오) · 🟥 DC-SEC(인젝션·RLS·크론 인증) · 🟥 DC-REV(SSOT·무왜곡 게이트) → GATE 1-5.
