# FAST PATH Summary — v0.7.306 모델 카탈로그 능력·출시일 추론

작업: "모델 새로고침"으로 받아온 라이브 모델(gemini-2.5-flash 등)이 능력·출시일 빈칸으로 뜨던 것 수정 — 모델ID 휴리스틱 추론 fallback + 비채팅 모델 필터.

대상:
- `lib/ai-chat/model-catalog.ts` — `inferModelMeta`(ID로 능력/라벨/출시일/컨텍스트 유추), `isChatModel`(tts·embedding·imagen 등 제외). `mergeModelCatalogEntry`가 큐레이션 없으면 추론값으로 보완.
- `app/admin/ai-chat/actions.ts` — `listModelCatalog` 표시 시점 추론 fallback(이미 저장된 빈칸 행도 즉시 능력·출시일 표시) + isChatModel 필터, `refreshModelCatalog` 비채팅 모델 필터.
- `lib/ai-chat/model-catalog.test.ts` — 추론·필터 4케이스 추가(총 9).

이유: 큐레이션 맵(model-catalog.ts CURATED_MODELS)이 특정 ID만 커버 → 정확 ID 매칭이라 라이브 refresh로 온 신모델(2.5-flash·2.0-flash-001 등)은 매칭 실패 → capabilities 전부 false·released_at null → 설명 빈칸(멀티모달 여부 포함). 휴리스틱 추론으로 모든 Gemini=vision+long-context, pro/2.5=reasoning, 버전별 출시일 근사 채움.

영향: 표시 전용(DB 스키마 무변경). 추론은 근사치(정확값은 큐레이션이 우선). 비채팅 모델 목록에서 제외.

검증: 실브라우저 — 모델 모달의 모든 Gemini 모델이 vision·long-context·reasoning·컨텍스트·출시일 표시 확인, TTS 제외 확인. tsc 0 · 모델카탈로그 테스트 9/9 · design 통과.

⚠️ 배포 필요: 커밋만. 푸시 후 라이브 반영.
