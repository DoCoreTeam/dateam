# Requirements — KakaoCloud 시장 데이터 삽입 + 통합입력 spec 매핑 개선

## 배경
KakaoCloud는 GPU 인스턴스를 자사 명칭(gn1i, p2i, p2a.baremetal 등)으로 판매.
스펙(vCPU/RAM/vRAM)으로 우리 gpu_products 카탈로그의 T4/A100/V100과 매핑 필요.

## KakaoCloud GPU 인스턴스 (수집 데이터)

### gn1i 시리즈 — NVIDIA T4 (16GB vRAM)
| SKU | vCPU | RAM | GPU수 | 시간요금(KRW) | GPU당 KRW | GPU당 USD |
|-----|------|-----|-------|--------------|----------|----------|
| gn1i.xlarge | 4 | 16GB | 1 | 648 | 648 | 0.463 |
| gn1i.2xlarge | 8 | 32GB | 1 | 856 | 856 | 0.611 |
| gn1i.4xlarge | 16 | 64GB | 1 | 1,272 | 1,272 | 0.909 |
| gn1i.8xlarge | 32 | 128GB | 1 | 2,104 | 2,104 | 1.503 |
| gn1i.12xlarge | 48 | 192GB | 4 | 4,256 | 1,064 | 0.760 |
| gn1i.16xlarge | 64 | 256GB | 1 | 3,768 | 3,768 | 2.691 |

### p2i 시리즈 — NVIDIA A100 (80GB vRAM)
| SKU | vCPU | RAM | GPU수 | 시간요금(KRW) | GPU당 KRW | GPU당 USD |
|-----|------|-----|-------|--------------|----------|----------|
| p2i.6xlarge | 24 | 192GB | 1 | 5,334 | 5,334 | 3.810 |
| p2i.12xlarge | 48 | 384GB | 2 | 10,668 | 5,334 | 3.810 |
| p2i.24xlarge | 96 | 768GB | 4 | 21,590 | 5,398 | 3.856 |

### Bare Metal — A100/V100
| SKU | vCPU | RAM | GPU | GPU수 | 시간요금(KRW) | GPU당 KRW | GPU당 USD |
|-----|------|-----|-----|-------|--------------|----------|----------|
| p2a.baremetal | 128 | 1,536GB | A100 | 8 | 51,296 | 6,412 | 4.580 |
| p1i.baremetal | 56 | 512GB | V100 | 4 | 16,996 | 4,249 | 3.035 |

## 요구 사항

### R1. DB 데이터 삽입
- competitors: KakaoCloud 추가
- gpu_products: T4/A100/V100 product_id 확인
- competitor_product_mapping: 각 인스턴스 타입 매핑 (복수 인스턴스 → 같은 GPU 제품)
- market_prices: GPU당 USD 단가 삽입

### R2. 통합입력 memory 정규화
- "80 GB", "80gb", "80 GB" → "80GB" 로 정규화
- gpu_products 조회 전 처리

### R3. CLASSIFY_PROMPT spec 추출 (선택적 개선)
- vcpu, ram_gb 필드 추가 (없으면 null)
- 추출 시 gpu_products 신규 생성 더미값 개선에 활용
