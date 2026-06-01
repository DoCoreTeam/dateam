# Architecture — AI 라우팅

## 플로우
```
통합입력 UI
  → POST /api/pricing/gpu/review
    → URL 감지 → fetch HTML → 텍스트 추출 (node-html-parser)
    → Gemini 분류 호출 (hardcoded classify prompt)
    → type=competitor → upsert competitors/gpu_products/mapping → insert market_prices → {type:'competitor', saved:[]}
    → type=supplier   → 기존 gpu.quote-extract 프롬프트 → review_items → {type:'supplier', item/items}
```

## 수정 파일
- `apps/web/app/api/pricing/gpu/review/route.ts` — URL fetch + 분류 + competitor DB 저장 추가
- `apps/web/app/(member)/pricing/gpu/tabs/QuoteRegisterTab.tsx` — competitor 결과 UI
