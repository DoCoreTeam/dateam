# 아키텍처
- DB: accounts(+is_supplier,is_customer,color), supply_quotes/availability(account_id 이관), gpu_specs 신설, gpu_products.storage_gb nullable
- SSOT pricing.ts: suppliers→accounts(is_supplier)
- 서버 프리페치: page.tsx에서 settings 조회→props
- 뷰영속: URL searchParams + sessionStorage
- AI: Gemini 재사용(specs/generate)
