# v0.5.0 — UCM · 커넥터 · 분석 방법론 (v0.2.0 부재분 흡수)

> 설계서 §9는 v0.2.0(md)의 커넥터(8절), 분석 방법론(9절), 게시 어댑터(12절)가 "유효하다"고
> 전제하지만 해당 문서는 저장소에 존재하지 않는다. 여기서 새로 정의해 참조를 닫는다.
> 이후 v0.2.0 원본이 나타나면 **본 문서가 우선**하고 차이는 정정 이력으로 기록한다.

---

## 1. UCM (통합 콘텐츠 모델)

플랫폼 6종의 서로 다른 응답을 하나의 형태로 정규화한 결과가 `ci_contents` + `ci_content_metrics`다.
정규화기는 `lib/ci/ucm/normalize.ts` 단일 구현이며 플랫폼별 어댑터가 이 인터페이스를 채운다.

```ts
export interface UcmContent {
  platform: CiPlatform
  externalId: string
  canonicalUrl: string
  channel: UcmChannelRef
  format: 'short' | 'long' | 'image' | 'text' | 'live'
  title: string | null
  caption: string | null          // plain text. HTML 유입 시 html-to-plain 경유
  publishedAt: string | null      // +09:00 앵커 ISO (kstWallToIso 규약)
  durationSec: number | null
  language: string | null
  thumbnailUrl: string | null
  metrics: UcmMetrics             // 아래
  provenance: UcmProvenance       // 아래
}

export interface UcmMetrics {
  views: number | null; likes: number | null; comments: number | null
  shares: number | null; saves: number | null
  capturedAt: string              // 관측 시각 (추정 금지)
}

export interface UcmProvenance {
  method: 'official_api' | 'oembed' | 'meta_tags' | 'render'
  attemptedMethods: string[]      // 방법 체인에서 실제로 시도한 순서
  fetchedAt: string
  verified: 'platform' | 'web_verified' | 'estimated'
  missingFields: string[]
  notes?: string
}
```

### 1-1. 완전도(completeness) 산출

플랫폼별 **필수 필드 집합**에 대한 확보 비율. 필수 집합은 `ci_platform_profiles.metric_definitions`에
플랫폼마다 정의한다(플랫폼이 원래 제공하지 않는 필드는 분모에서 제외 — 없는 것을 결손으로 세지 않는다).

```
completeness = 확보한 필수 필드 수 / 해당 플랫폼의 필수 필드 수
```
`< 0.8`이면 화면에 `일부만 수집됨` 배지와 `missing_fields` 목록.
**추정값으로 빈칸을 메우고 정상인 척하는 것을 금지한다**(설계서 §6.6 부분 데이터 규칙).

### 1-2. 포맷 판정

| 조건 | format |
|---|---|
| 세로 영상 & 길이 ≤ 180초 | `short` |
| 영상 & 그 외 | `long` |
| 정지 이미지·캐러셀 | `image` |
| 텍스트 전용(X, Threads) | `text` |
| 라이브 아카이브 | `live` |

배수·백분위 비교는 **같은 포맷끼리만** 성립한다(§2-1).

---

## 2. 분석 방법론

### 2-1. 평소 대비 배수 (outlier_index)

```
baseline = median(같은 채널 & 같은 포맷 & 최근 20개의 동일 나이 시점 조회수)
outlier_index = 해당 콘텐츠 조회수 / baseline
```

불변조건
- `baseline` 표본 8개 미만이면 **산출하지 않는다**(`outlier_baseline_n < 8` → 화면 미표시).
- 나이 보정: 게시 후 경과 시간이 다르면 직접 비교 불가. 스냅샷이 있으면 동일 나이 시점으로 보정하고,
  없으면 `is_estimated=true`로 표시하되 배수는 게시 후 7일 이상 경과분에만 부여한다.
- `source='inbox'` 단건은 baseline 계산과 통계 집계에 **모두 제외**(설계서 §7.3).
- 표시는 소수 1자리, 문장형 `평소 대비 8.4배`.

### 2-2. 같은 주제 상위 % (topic_percentile)

같은 `workspace_id` · `topic_id` · `platform` · `format` · 기간 창(`analysis.window_days`, 기본 28일)
안에서 조회수 백분위. 모집단 30건 미만이면 산출하지 않는다.

### 2-3. 비교 가능성 (comparability_class)

| 등급 | 의미 | 화면 표기 |
|---|---|---|
| A | 조회수 정의가 호환 (같은 플랫폼 내부) | `조회수 비교 가능` |
| B | 조회수 정의 상이, 참여 지표만 호환 | `참여로만 비교` |
| C | 정의 불명 또는 결손 과다 | `비교 불가` |

플랫폼 간 조회수 직접 비교는 **B 이하로 강등**한다. 정의 차이를 숨기지 않는 것이 원칙이다.

### 2-4. 신뢰도 (confidence)

| 값 | 조건 | 화면 |
|---|---|---|
| `high` | baseline ≥ 20 & completeness ≥ 0.9 & class A | `근거 충분` |
| `medium` | baseline ≥ 8 & completeness ≥ 0.7 | `관찰 중` |
| `insufficient` | 그 외 | `데이터 부족` |

`insufficient`면 AI 서술(왜 잘됐나)에 **단정 문구 생성 금지** — 설계서 §7.4 규칙.

### 2-5. 성공 공식 (pattern_lift)

```
lift = median(공식 적용 콘텐츠의 outlier_index) / median(같은 주제 전체의 outlier_index)
```
`evidence_count ≥ 20` 그리고 `channel_count ≥ 5`가 아니면 화면에 공식으로 승격하지 않는다
(한 채널의 우연을 공식으로 파는 것 방지). 표기 시 근거 개수·채널 수 병기 필수.

---

## 3. 커넥터 계약

### 3-1. 인터페이스

```ts
export interface Connector {
  platform: CiPlatform
  match(url: string): boolean
  fetchContent(url: string, ctx: ConnectorCtx): Promise<UcmContent>
  fetchChannel(ref: string, ctx: ConnectorCtx): Promise<UcmChannel>
  listChannelContents(ch: UcmChannelRef, since: string, ctx: ConnectorCtx): Promise<UcmContent[]>
  capabilities: ConnectorCapabilities   // publish 가능 여부, 쿼터 단가 등
}
```

### 3-2. 방법 체인 (폴백 순서)

각 플랫폼은 아래 순서로 시도하고, 성공한 방법을 `provenance.method`에 기록한다.
앞 단계가 실패해야만 다음으로 내려간다.

| 플랫폼 | 체인 |
|---|---|
| youtube | `official_api` → `oembed` → `meta_tags` |
| tiktok | `oembed` → `meta_tags` → `render` |
| instagram | `official_api`(연결된 내 채널 한정) → `oembed` → `meta_tags` → `render` |
| facebook | `official_api`(내 채널) → `meta_tags` → `render` |
| x | `meta_tags` → `render` |
| threads | `meta_tags` → `render` |

### 3-3. 쿼터 회계 (YouTube, 설계서 §13)

일 10,000 유닛 기준. `search.list`는 100유닛 이상이라 **검색형 기능은 기본 비활성**이며
채널 업로드 목록은 `playlistItems.list`(1유닛) 경로만 사용한다.
소모량은 `ci_job_runs`에 기록하고 일 한도의 80% 도달 시 잡 스케줄러가 자동 감속한다.

### 3-4. 커넥터 헬스와 회귀 URL

`ci_platform_profiles.regression_urls`에 플랫폼별 대표 URL 5개 이상을 보관하고,
정기 잡이 이 세트를 재수집해 성공률·필드 확보율을 `health`에 기록한다.
운영자 콘솔이 이 값을 노출하며, 성공률 급락이 구조 변경 감지 신호다.

---

## 4. 게시 어댑터

### 4-1. 두 경로 (설계서 §7.6)

| 경로 | 조건 | 흐름 |
|---|---|---|
| `manual` (기본) | 전 플랫폼 | 규격 검사 → 파일 내보내기 → 캡션 복사 → 업로드 바로가기 → **게시 URL 입력** → 추적 시작 |
| `api` (선택) | `ci_platform_profiles.supports_api_publish=true` 이고 OAuth 연결됨 | 규격 검사 → 즉시 게시 또는 예약 → `external_content_id` 수신 → 추적 시작 |

`manual`이 기본인 이유는 정직하다: Instagram·TikTok·Threads의 API 게시는 제약이 크고,
수동 경로만으로도 URL 입력 시점에 루프가 닫히기 때문이다.

### 4-2. 규격 검사

플랫폼별 길이·비율·용량·해시태그 수 제한을 `ci_platform_profiles`에 두고 게시 전 검사한다.
위반은 게시를 막지 않고 경고로 표시한다(사용자가 최종 판단).

### 4-3. 소급 추적

과거 게시물도 URL만 입력하면 `ingest` 잡이 생성되고 `ci_publications.tracked_content_id`가 연결된다.
게시 경로와 무관하게 성과 루프가 닫히는 것이 이 설계의 핵심이다.

---

## 5. AI 파이프라인 계약 (설계서 §11.5 깔때기)

| 단계 | 방법 | 대상 비율(목표) | 비용 |
|---|---|---|---|
| 1차 | 규칙 + 임베딩 유사도 | 100% | 저 (대량) |
| 2차 | LLM 판정 | 저확신 구간만 ~15% | 중 |
| 3차 | 웹 검증 | 2차 중 일부 ~3% | 고 |

- 임베딩은 기존 `lib/gemini-embedding.ts` 재사용.
- LLM 호출은 기존 `lib/ai-chat/registry.ts`가 해석한 프로바이더·키를 사용하고,
  사용량은 `logTokenUsage({feature:'ci-classify'|'ci-brief'|'ci-verify', …})`로 기존 `ai_token_logs`에 적재.
- 단계별 통과율·단가는 `ci_job_runs.tokens_used`/`cost_krw` 집계로 운영자 콘솔에 노출.
- 예산 상한(`llm.budget_cap`) 도달 시 2·3차를 중단하고 1차 결과 + `insufficient` 신뢰도로 처리한다.
  **작업을 침묵으로 실패시키지 않는다** — 화면에 예산 소진 상태를 표시한다.

### 5-1. 검증 루프 (설계서 §11.3)

`verify` 단계 잡이 담당한다. 검토 큐로 보낼 때는 반드시 `payload.ai_attempts`에
"AI가 이미 시도한 것과 판단 근거"를 첨부한다 — 사용자는 최종 심판이지 분류 노동자가 아니다.

### 5-2. 자동 확정 임계

`topic.autoconfirm_threshold` (기본 0.85) 이상이면 `topic_source='auto'`로 확정.
2차 검증 통과분은 `ai_verified`. 미달분만 `review_state='pending'`으로 검토 큐 진입.
목표 SLO는 자동 확정률 85% 이상, 검토 큐 유입 15% 이하(설계서 §11.6).
