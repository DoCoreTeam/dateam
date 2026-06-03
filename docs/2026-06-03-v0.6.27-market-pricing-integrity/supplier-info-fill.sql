-- 공급사 회사정보 웹검색 채움 (2026-06-04) — 053 마이그레이션 후 실행
-- 출처: 각 공급사 공식 사이트 + Wikipedia/CB Insights/PitchBook 등 웹검색

BEGIN;
UPDATE suppliers SET country='미국', website='https://www.coreweave.com',
  description='미국(뉴저지 리빙스턴) AI 클라우드 컴퓨팅 기업. NVIDIA H100/H200 GPU 클라우드 전문, 2025 상장.', updated_at=now() WHERE name='CoreWeave';
UPDATE suppliers SET country='미국', website='https://www.equinix.com/products/digital-infrastructure-services/equinix-metal',
  description='Equinix(미국 레드우드시티) 베어메탈 클라우드. ※Equinix Metal 서비스 2026-06-30 종료 예정.', updated_at=now() WHERE name='Equinix Metal';
UPDATE suppliers SET country='한국', website='https://gcube.ai',
  description='한국 GPU 클라우드 (자사). gcube 판매 마진 기준 공급사.', location=COALESCE(location,'한국'), updated_at=now() WHERE name='gcube';
UPDATE suppliers SET country='일본', website='https://highreso.jp',
  description='일본(도쿄 신주쿠) GPU 클라우드 GPUSOROBAN 운영. NVIDIA NPN 클라우드 파트너, 이시카와/카가와 GPU 데이터센터.', updated_at=now() WHERE name='High Reso';
UPDATE suppliers SET country='대만', website='https://www.konsttech.ai',
  description='대만(타이중·타이베이) AI 인프라/데이터센터 기업. ISO 27001 데이터센터 3곳, GPU 컴퓨팅 리스.', updated_at=now() WHERE name='Konsttech';
UPDATE suppliers SET country='미국', website='https://www.tensordock.com',
  description='미국(보스턴) GPU 클라우드 마켓플레이스(2021 설립, 20+개국 100+ 로케이션). 2025 Voltage Park 인수.', updated_at=now() WHERE name='Tensordock';
UPDATE suppliers SET country='미국', website='https://www.voltagepark.com',
  description='미국(샌프란시스코/샌마테오) GPU 클라우드. NVIDIA H100 약 24,000장 운영, Tier3+ 데이터센터 6곳.', updated_at=now() WHERE name='Voltage Park';
COMMIT;
