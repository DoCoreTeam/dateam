# Architecture — GPU 견적 다중 모델

## AS-IS
입력 → Gemini(단일 객체) → review_items 1건 → 단일 카드 UI

## TO-BE
입력 → Gemini({ items: [...] }) → review_items N건(batch) → 탭 UI

## DB 변경
review_items:
  + source_batch_id uuid (nullable) — 같은 입력에서 나온 묶음 키
  + batch_index smallint default 0 — 배치 내 순서

## API 변경
POST /api/pricing/gpu/review:
  - 응답: { items: ReviewItemResult[], batch_id: string, count: number }
  - 하위 호환: AI 응답이 단일 객체면 [단일] 배열로 래핑

## UI 변경
analysisResult: ReviewItemResult | null → analysisResults: ReviewItemResult[]
탭: 모델별 탭 라벨 = "${model_name} ${memory}"
