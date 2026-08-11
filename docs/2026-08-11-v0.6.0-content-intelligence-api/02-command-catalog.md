# v0.6.0 — Command 카탈로그 · AI 어시스턴트 도구 정의

> 설계서 §12 필수 산출물 2번의 나머지. v0.2.0 §11(Command 체계)이 부재하므로 여기서 새로 정의한다.
> AI 어시스턴트(`AssistantPanel`)는 화면 컨텍스트를 물려받아 아래 Command만 실행한다.

---

## 0. 원칙

1. **어시스턴트는 API를 우회하지 않는다.** 모든 Command는 v0.6.0 §1~11의 엔드포인트를 호출한다.
   어시스턴트 전용 DB 접근 경로를 만들지 않는다(권한 우회 방지).
2. **위험도에 따라 확인 절차가 달라진다.** 아래 3등급.
3. **컨텍스트 상속:** 현재 화면(route)과 선택 항목(selection)이 Command 인자의 기본값이 된다.
   사용자가 "이거"라고 말하면 selection을 가리킨다.
4. **추출/제안형 결과는 후보 체크리스트로 제시하고 사용자가 확정한다.** 자동 반영 금지
   (CLAUDE.md §5-3 AI 결과 UI 패턴 표준).

### 위험도 등급

| 등급 | 정의 | UI 처리 |
|---|---|---|
| `safe` | 읽기 전용, 부작용 없음 | 즉시 실행 |
| `write` | 데이터 생성·수정, 되돌리기 쉬움 | 즉시 실행 + 실행 취소 토스트 |
| `guarded` | 되돌리기 어렵거나 비용·외부 영향 발생 | **확인 다이얼로그 필수**, 어시스턴트 자동 실행 금지 |

---

## 1. 리서치 Command

| Command | 인자 | 등급 | 엔드포인트 |
|---|---|---|---|
| `ingest.add` | `urls[]`, `topicId?` | write | `POST /api/ci/ingest` |
| `ingest.retry` | `contentId` | write | `POST /api/ci/contents/:id/retry` |
| `content.setTopic` | `contentId`, `topicId` | write | `POST /api/ci/contents/:id/topic` |
| `content.exclude` | `contentId`, `reason` | write | `POST /api/ci/contents/:id/exclude` |
| `content.open` | `contentId` | safe | DetailSheet 열기(클라이언트) |
| `content.evidence` | `contentId` | safe | `GET …/evidence` |
| `channel.track` | `input`, `topicId?` | write | `POST /api/ci/channels` |
| `channel.untrack` | `channelId` | guarded | `DELETE /api/ci/channels/:id` — 추적 이력 단절 |
| `channel.refresh` | `channelId` | write | `POST …/refresh` (쿼터 소모) |
| `channelLink.decide` | `linkId`, `decision` | guarded | 채널 동일성 확정은 통계에 영향 |
| `trends.outliers` | `topicId?`, `platform?`, `format?`, `windowDays?`, `sort?` | safe | `GET /api/ci/trends/outliers` |
| `trends.patterns` | `topicId?` | safe | `GET …/patterns` |
| `trends.signals` | `topicId?` | safe | `GET …/signals` |
| `board.add` | `boardId?`, `itemType`, `itemId` | write | `POST /api/ci/boards/:id/items` |

자연어 예시 → Command 매핑
- "요리 주제에서 이번 주 떡상 보여줘" → `trends.outliers{topicId:요리, windowDays:7, sort:'outlier'}`
- "이 채널 관심 채널로 추가해" → `channel.track{input: selection.channelUrl}`
- "이거 보드에 담아" → `board.add{itemType:'content', itemId: selection.id}`

---

## 2. 제작 Command

| Command | 인자 | 등급 | 엔드포인트 |
|---|---|---|---|
| `idea.create` | `title`, `topicId?`, `evidence[]?` | write | `POST /api/ci/ideas` |
| `idea.move` | `ideaId`, `stage` | write | `PATCH …/stage` |
| `idea.archive` | `ideaId` | write | `PATCH /api/ci/ideas/:id` |
| `brief.generate` | `ideaId`, `platforms[]?`, `tone?` | guarded | AI 비용 발생 → 한도·예산 확인 후 |
| `brief.regenerate` | `briefId`, `fields[]` | guarded | 동일 |
| `brief.compare` | `briefId` | safe | `GET …/versions` |
| `editPlan.create` | `briefId`, `variantLabel?` | write | `POST /api/ci/edit-plans` |
| `editPlan.export` | `editPlanId` | guarded | 외부 파일 산출 |

`brief.generate`가 `guarded`인 이유: 설계서 §8.4가 AI 사용량을 과금 축으로 두므로
사용자 모르게 한도를 소모해선 안 된다. 실행 전 남은 한도를 사용자에게 보여준다.

---

## 3. 게시 Command

| Command | 인자 | 등급 | 비고 |
|---|---|---|---|
| `publish.prepare` | `briefId`, `channelIds[]`, `scheduledAt?` | write | 대기열 등록 |
| `publish.specCheck` | `publicationId` | safe | 경고만, 차단 아님 |
| `publish.export` | `publicationId` | write | 수동 경로 산출물 |
| `publish.now` | `publicationId` | **guarded** | **외부 플랫폼에 실제 게시. 어시스턴트 자동 실행 절대 금지** |
| `publish.schedule` | `publicationId`, `at` | guarded | 동일 |
| `publish.recordUrl` | `publicationId`, `url` | write | 추적 시작 |
| `connection.connect` | `platform` | guarded | OAuth 이동 |
| `connection.revoke` | `channelId` | guarded | 연결 해제 |

`publish.now`·`publish.schedule`은 되돌릴 수 없는 외부 영향이다.
어시스턴트는 **제안까지만** 하고 사용자가 화면에서 직접 확정한다.

---

## 4. 성과 · 학습 Command

| Command | 인자 | 등급 |
|---|---|---|
| `performance.mine` | 필터 | safe |
| `performance.market` | 필터 | safe |
| `performance.learning` | — | safe |
| `pattern.archive` | `patternId` | write |
| `rule.promote` | `suggestionId`, `decision` | **guarded** — 분류 동작이 바뀐다 |
| `performance.export` | 필터 | write |

---

## 5. 설정 · 운영 Command

| Command | 인자 | 등급 | 비고 |
|---|---|---|---|
| `setting.get` | `key`, `scope` | safe | 시크릿은 마스킹 |
| `setting.set` | `key`, `scope`, `value` | guarded | 즉시 반영되므로 확인 |
| `setting.history` | `key` | safe | |
| `topic.merge` | `sourceId`, `targetId` | **guarded** | 이력 보존하되 되돌리기 비용 큼 |
| `topic.reclassify` | `topicId` | **guarded** | 전체 재분류 = 대량 AI 비용 |
| `workspace.delete` | `workspaceId` | **guarded** | 유예 삭제. 설계서 §10.4가 대표 실패 신호로 지목 |
| `data.export` | — | write | |

`setting.set`은 어시스턴트가 값을 **제안**하고 사용자가 확인 버튼을 누를 때만 적용한다.
시크릿 계열 키는 어시스턴트 경로에서 아예 차단한다(`assistantBlocked: true`).

---

## 6. 도구 정의 (LLM function schema)

어시스턴트는 아래 형태로 도구를 받는다. `safe`는 전량 노출, `write`는 노출하되 결과에 실행 취소를 붙이고,
`guarded`는 **실행 도구가 아니라 제안 도구**로 노출한다(`propose_*` 접두).

```ts
interface CiTool {
  name: string                  // 'trends.outliers'
  risk: 'safe' | 'write' | 'guarded'
  description: string           // 한국어. 사용자 표현(떡상·관심 채널)을 그대로 씀
  parameters: JSONSchema
  contextDefaults?: string[]    // ['topicId','platform'] — 화면 필터에서 자동 주입
  assistantBlocked?: boolean    // true면 도구 목록에서 제외
}
```

```ts
// 예시
{
  name: 'trends.outliers',
  risk: 'safe',
  description: '지정한 주제에서 평소 대비 배수가 높은 콘텐츠(떡상)를 찾습니다.',
  parameters: { type:'object', properties: {
    topicId:{type:'string'}, platform:{enum:[...]}, format:{enum:[...]},
    windowDays:{type:'integer', default:28},
    sort:{enum:['outlier','recent','velocity'], default:'outlier'}
  }},
  contextDefaults: ['topicId','platform','format','windowDays']
}
```

### 실행 로그

모든 Command 실행은 `ci_job_runs`(비동기) 또는 `ci_setting_audits`(설정)에 남는다.
어시스턴트 경유 실행은 `actor_source='assistant'`를 함께 기록해
"AI가 뭘 했는지" 추적이 가능해야 한다. 사후 추적 불가능한 자동 실행을 만들지 않는다.

### 토큰 사용량

어시스턴트 호출은 기존 `logTokenUsage({feature:'ci-assistant', …})`로 `ai_token_logs`에 적재한다.
CI 전용 로깅 테이블을 새로 만들지 않는다(SSOT 유지).

---

## 7. `AiFeature` 추가값 (타입 전용 변경)

`apps/web/types/database.ts`의 `AiFeature` 유니온에 아래를 추가한다. DB 제약이 아니라 TS 유니온이므로
마이그레이션은 필요 없다.

```ts
| 'ci-classify'    // 주제 분류 (2차 LLM)
| 'ci-verify'      // 검증 루프 (3차 웹 검증)
| 'ci-brief'       // 기획안 생성·부분 재생성
| 'ci-assistant'   // AI 어시스턴트 대화
| 'ci-embedding'   // 1차 임베딩 유사도
```
