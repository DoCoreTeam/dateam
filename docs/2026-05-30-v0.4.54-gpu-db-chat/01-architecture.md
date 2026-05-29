# Architecture — GPU DB Chat

## 컴포넌트 구조
DbChatTab.tsx (FE)
  └ POST /api/pricing/gpu/db-chat (BE)
       ├ DB 스냅샷 조립 (supply_quotes, gpu_products, gpu_audit_logs, suppliers, fx_rates)
       ├ ai_prompts(gpu.db-chat) 로드
       ├ Gemini API 호출 (getGeminiConfig 재사용)
       └ logTokenUsage(feature='gpu-db-chat')

## 신규 파일
- app/api/pricing/gpu/db-chat/route.ts
- app/(member)/pricing/gpu/tabs/DbChatTab.tsx
- [수정] GpuPricingClient.tsx (TabId + 탭 추가)

## DB 변경
- ai_prompts INSERT: prompt_key='gpu.db-chat', version='1.0'
