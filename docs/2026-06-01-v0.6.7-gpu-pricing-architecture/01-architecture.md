# 아키텍처
## DB
- supply_quotes += gpu_count int (입력 수량), status += 'superseded'
- UNIQUE partial (product_id, supplier_id, term_months) WHERE status='confirmed'
- unit_price_usd = per-GPU 정규화값, original_price/unit = 원본 보존
- v_gpu_master: gpu_products LEFT JOIN 최저견적/가용량/풀재고/시장가
## 정규화 공식
per_gpu = original_price ÷ gpu_count (입력이 박스면 나눔, per-GPU면 ÷1)
표시: x1=per_gpu, x4=per_gpu×4, x8=×8
## tier 사전
H100/H200/B200/B300/GB200→T1, L40/L40S/A40/A30→T2, RTX 소비자→T3
## 멱등 confirm
parse qty → per-GPU 환산 → supplier normalize find-or-create
→ 동일 키 기존 confirmed 있으면 superseded 처리 후 신규 insert
## API 통일
products/inventory/market → v_gpu_master 단일 소스
