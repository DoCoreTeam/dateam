# 목록 심층분석 v2 — "명령 주도 확산 심층 + 완성형 취합" 설계 기획서
> 2026-07-15 · 🟦 DC-BIZ·DC-RES·DC-OSS(fable-5) 종합 · **기획 전용(구현 0)**
> 결론: 신규 구축 아님. 기존 `/ai-chat/analyze` 파이프라인의 **3개 개조 + 스키마 확장**으로 성립.

## 1. 사용자 요구 (원문 흐름)
문서(기획서/md/이미지/엑셀/ppt/html…) 투입 → **기획서 맥락 중심**으로 항목 발췌(단순 항목만 뽑으면 답 이상) → 각 항목을 **N개 개별 탭에서 병렬 심층 분석** → 완성되면 **생략 없이 하나로 취합**(흐름상 이상한 것만 수정, 완성형) → 오래 걸리므로 **진행상태를 실시간(상태값 하드코딩 금지)**으로 보여줘 사용자가 무슨 일 하는지 알게.
+ 보강: 항목별 "심층"은 고정 템플릿이 아니라 **사용자 명령 기반의 확산적 심층 전개**(지금 CEO가 명령받아 확장 사고하듯).

## 2. 현 구현의 실측 갭 (v1 → v2가 반드시 고칠 것)
| # | 갭(코드 위치) | v2 |
|---|---|---|
| G1 맥락 | `analyzeItem`이 원문 앞 8,000자만 슬라이스(actions.ts MAX_CONTEXT_CHARS) → 뒷부분 항목 무맥락 = "답 이상" | 문서 이해 패스 + 항목별 **맥락 팩**(원문앵커 발췌+의도) |
| G2 취합 | `synthesizeInsights`가 30,000자 **slice로 잘라** 요약형 종합(actions.ts:331) = 유실·요약, "완성형" 아님 | **결정론 조립 + 계층 collapse + 커버리지 게이트**(무손실) |
| G3 실시간 | 클라 4상태 배지, 탭 닫으면 중단·running 고아, DB반영 best-effort | **DB status=SSOT + 서버 오케스트레이터 SSE + 폴링 폴백** |
| G4 명령 | 사용자 명령(customInstruction)이 세션에 **미영속** → resume 시 유실 | 세션 `command` 컬럼 신설, 3단계 프롬프트 전체를 지배 |

## 3. 아키텍처 (명령 주도 파이프라인)
```
사용자 명령 + 문서
 → [추출] parseListItems(결정론 무손실) + AI보정 병합(유실0 계약 유지)
 → [맥락 주석] 2패스: (1)결정론 원문앵커(source_text.indexOf→감싸는 섹션) (2)AI 의도주석(idx참조 JSON만 = 항목 재출력 안 함 → 왜곡 구조적 불가)
 → [병렬 심층] 항목마다 (항목+맥락팩+명령)을 system+user로 확산 전개. 서버 워커풀 K개. 상태 전이 DB 즉시 기록
 → [취합] 항목 다이제스트 → (예산초과시 그룹 collapse) → 명령목적 완성형 통합 → 커버리지 검증(코드) → 패치식 흐름교정
```
- **명령 주입**: `callGemini`에 `system` 파라미터 추가(provider.ts가 이미 `system?` 지원, gemini `system_instruction` 매핑 — 최소변경). 명령/항목/원문 분리로 프롬프트 인젝션·희석 방지.
- **무손실 취합(G2 해법)**: 30k slice 제거. map(항목 다이제스트 `[#idx]` 강제) → reduce(전체 인벤토리 + 다이제스트, Gemini 1M라 비용이 실제 제약 → 예산 내 단일취합, 초과만 계층 collapse) → **커버리지 게이트**: 출력의 `[#idx]` 집합 vs 전체 idx 대조, 누락 시 보수 패스 1회 → 그래도 누락이면 **원문 다이제스트를 부록에 결정론 append**(어떤 경우에도 전 항목 물리적 존재). "이상한 것만 수정"=전면 재작성 금지, **idx 단위 패치 JSON만 받아 코드가 적용**(비패치=무왜곡 증명).
- **실시간(G3 해법)**: 진행률을 저장하지 않음 — `count(status)` 파생만이 "하드코딩 금지"의 정답(listAnalysisSessions가 이미 임베드 집계로 doneCount 파생 = 이 패턴 확장). 신규 `POST /api/admin/ai-chat/analyze/stream`(기존 stream/route.ts의 sse()·ReadableStream·runtime=nodejs 골격 복제)가 pending/error 항목 원자적 claim→워커풀 실행→상태전이 DB기록+SSE emit. 클라는 sse.ts 파서 공용 수신, 단절 시 getAnalysisSession 폴링 폴백. **드레인 루프**로 함수 시간예산 내 실행 후 미완은 재-POST(멱등 claim). 사내 선례: `pricing/gpu/review/stream`(진행 내레이션), `reports/aggregate-stream`(증분 결과).

## 4. 데이터모델 (마이그 157 확장)
- `ai_analysis_sessions` +: `command text`(명령·resume복원) · `phase text`(extracting/analyzing/synthesizing/done — 서버전이만) · `run_claimed_at`(이중실행 락, weekly draft_gen 선례) · `synth_status/synth_text`(**현재 종합 미영속=유실0 사각 해소**) · `coverage jsonb`(누락/복구 리포트)
- `ai_analysis_items` +: `context_excerpt/intent_note/span_start/span_end`(맥락) · `digest_text`(취합 캐시) · `error_text/attempts` · `claimed_at/started_at/finished_at`(stall 감지: running & claimed_at<now-10m → 재claim) · `prompt_tokens/output_tokens`(항목별 비용)
- RLS·트리거는 157 패턴 그대로. `fn_aiai_touch_session` 기존 트리거가 폴링 변경감지 저렴하게 함.

## 5. 재사용(신규 최소·npm 의존성 0)
그대로: list-extract(무손실)·provider/gemini(system 파라미터)·sse.ts·document-extract·export 4종·token-logger·requireAdminApi·157 RLS. 개조: synthesizeInsights(계층화)·analyzeItem(스트리밍/맥락)·runWithConcurrency(lib 승격+백오프). 신규: analyze/stream 라우트·맥락앵커 순수모듈·계층취합 순수모듈(둘 다 단위테스트).

## 6. 우선순위
- **MVP(v2.0)**: G4 명령영속 → G1 맥락팩 → G2 무손실취합(커버리지 게이트) → G3 실시간(DB SSOT+SSE)
- **v2.1**: 항목별 lens 오버라이드·개별 재분석(지시수정)·일시정지·취합본 버전(append)·교정 승인 체크리스트·비용/시간 예측
- **v2.2+**: 근거추적(문장 앵커)·취합본→채팅·대량(50+) 계층취합·세션 검색·member 개방·멀티프로바이더

## 7. 착수 전 결정 필요 (Q&A — 세 플래너 공통)
1. **배포 타깃**: Vercel? → maxDuration/드레인 전략 확정 (셀프호스트면 제약 없음)
2. **취합 산출 형태**: 인사이트 요약 vs **완성형 문서(원문 개정판/별도 분석보고서)** vs 둘 다 — 프롬프트 계약이 달라짐
3. **실시간 깊이**: status 전이만 vs 항목 텍스트 delta 스트리밍(열람 항목만) 어디까지
4. **lens 5종 거취**: 자유 명령이 상위 → lens를 "명령 프리셋 버튼"으로 흡수?
5. **권한**: admin 유지 vs member 개방(비용정책 트레이드오프) / K(동시성) 설정 위치(META vs 고정)

## 8. TRADEOFF·리스크
- 서버 병렬화 시 서버리스 시간예산(항목수×응답시간) → 드레인 루프 필수(1번 결정 선행)
- 취합 무손실은 **AI 신뢰 금지, 코드 게이트가 최종** — 이게 핵심 안전장치
- 대량 항목 비용 폭주 → 사전 예측+상한. 이미지 소스는 오프셋 매칭 불가 → 맥락은 전체 OCR 폴백
- **구현 미착수**(사용자 지시 "절대구현하지마").
