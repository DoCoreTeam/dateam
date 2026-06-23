# 공급원가 전파 격리 — 장당 메모리 단위 (48GB≠96GB) v0.7.255 (FAST)

## 문제
RTX Pro 6000 48GB와 96GB가 같은 판매가(₩4,607). 48GB만 Akamai 견적($2.5)이 있고 96GB는 견적 0건인데,
자동 per-GPU 전파(bestPerGpuByModel)가 모델키(tier|model_name, 메모리 무시)로 집계돼 96GB가 48GB값을 빌림.

## 근본
lib/gpu/pricing.ts: 자동 전파 키 = modelKeyOf(tier|model_name). 메모리 변형(48/96GB)을 구분 못함.
주의: memory 컬럼은 '총 메모리'라 장수 비례(×1 180GB, ×2 360GB) → 단순 memory 키는 장수 전파를 깸.

## 수정 (A안 — 사용자 승인)
- `propKeyOf(p)` 신설: modelKey + **장당 메모리(memory ÷ gpu_count)**. 자동 전파 맵(bestPerGpuByModel)만 이 키로 격리.
  - 48GB(장당48)·96GB(장당96): 키 달라 전파 X → 96GB는 자기 견적 없으면 '공급원가 미정'(effective null).
  - B200 ×1(장당180)·×2(장당180): 키 같아 전파 O(장수 변형 정상).
- modelKeyOf(공급사목록·list가·모델지정)은 그대로. selection_scope='model' 명시 지정도 그대로(사용자 의도).

## 검증
- 실데이터 buildCatalog: 96GB effective=null·sell=null(전파차단), 48GB effective=2.5 유지.
- pricing.test 회귀 2개(48→96 차단 / ×1→×2 전파 유지) + 전체 562·tsc0·design·next build.
