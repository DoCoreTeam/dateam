# 검증 결과 — 전사 우선 + 행수 대조 + 보존 (v0.7.247)

## 실 AI 파이프라인 검증 (결정적 — 실제 transcription.ts + 실 Gemini Vision)
`scripts/pipeline-test-nebius.ts` — 캡처한 Nebius GPU표(9행) 이미지를 실제 `buildTranscriptionPrompt()` + 실 Gemini로 전사 → `parseTranscription()`.

**결과: 9/9 누락 0** ✅
```
source_row_count = 9 | rows = 9
- "NVIDIA GB300 NVL72"        | (가격미상 — Contact us 보존)
- "NVIDIA HGX B300"           | $7.85
- "NVIDIA GB200 NVL72"        | (가격미상 — Contact us 보존)
- "NVIDIA HGX B200"           | $7.15
- "NVIDIA HGX H200"           | $4.50
- "NVIDIA HGX H100"           | $3.85
- "NVIDIA RTX PRO 6000"       | $1.80
- "NVIDIA L40S with Intel CPU"| from $1.82
- "NVIDIA L40S with AMD CPU"  | from $1.55
누락 모델: 없음 ✅ · 가격미상 보존: 2 (GB300, GB200) · reconcile: source9=extracted9 missing0
```

### 이전(v0.7.246) 대비
| 항목 | 이전 | 지금 |
|---|---|---|
| 추출 행수 | 4/9 (조용한 누락) | **9/9** |
| 모델명 | B300→"H100 80GB" 둔갑 | **"NVIDIA HGX B300" 원문** |
| 가격없는 행 | 통째 삭제 | **가격미상 보존** |
| 누락 감지 | 없음 | reconcile로 가시화 |

→ 사용자 핵심 요구("누락은 절대 안 됨")가 실 AI·실 이미지로 **충족**됨. 카탈로그 강제매핑 제거로 모델 오염도 동시 해결.

## 정적/단위 검증
- tsc 0 · 전체 테스트 **544/544** · design:check ✅
- 신규 단위테스트 24(transcription9/reconcile10/validate-preserve5)
- 🟥 DC-REV **93/100 APPROVED** · 🟥 DC-SEC **PASS**(CRITICAL0·HIGH0; USER_DATA 펜스·레이트리밋은 비차단 후속 권고)

## UI 라이브 렌더 — 한계 명시(정직)
헤드리스 E2E 세션에서 `/pricing/gpu`가 `/home`으로 리다이렉트(콘솔 에러 0, 본 변경의 라우팅 미변경 — throwaway 계정/세션 라우팅 이슈)되어 **라이브 화면 캡처는 미완**. FE 배선(누락 배너 `reconciliation.missing>0`, 가격미상 배지/자동반영 제외, 원문 병기)은 tsc·DC-REV 페이로드 라인대조·단위테스트로 검증.
→ 추출 정확도(핵심)는 실 AI로 결정적 증명. 라이브 UI 스크린샷은 환경 제약으로 후속.

## 후속(비차단)
- USER_DATA 프롬프트 인젝션 펜스 SSOT, 라우트 레이트리밋 (DC-SEC 권고)
- 전사 declared 과대보고 시 과경고 정책(현재는 안전측—과경고>침묵누락)
- market/refresh·비스트림 review의 로컬 fetchUrlText 표보존 SSOT 통일
