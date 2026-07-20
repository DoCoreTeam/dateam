import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NON_GPU_LABEL_FIXTURES, GPU_LABEL_PASS_FIXTURES, CURRENCY_OBS_FIXTURES } from './golden-set.ts'
import { looksLikeGpuModel } from './validate.ts'
import { toKrwPerGpuHour } from './observation-normalize.ts'

// 재설계 4대 사고 회귀 게이트 (확정 기획 P0). 이 사고들이 다시 재유입되면 즉시 실패.
//   사고A/D: 요금·메뉴 라벨 오통과, 사고B: 진짜 모델 유실, 사고C: 다통화·번들 오환산.

test('[사고A/D] 비-GPU 라벨(요금·서비스·메뉴명)은 전부 모델 아님 — 언어 불문', () => {
  for (const label of NON_GPU_LABEL_FIXTURES) {
    assert.equal(looksLikeGpuModel(label), false, `"${label}"는 모델이 아니어야 함`)
  }
})

test('[사고B] 진짜 GPU 모델은 언어·번들 무관하게 통과(유실 금지)', () => {
  for (const label of GPU_LABEL_PASS_FIXTURES) {
    assert.equal(looksLikeGpuModel(label), true, `"${label}"는 모델로 통과해야 함`)
  }
})

test('[사고C] 다통화·번들 관측 → per-GPU·hr 원화 결정론 환산(엔100단위·번들8장·분당)', () => {
  for (const f of CURRENCY_OBS_FIXTURES) {
    const r = toKrwPerGpuHour(f.obs, f.fx)
    assert.ok(r != null, `${f.obs.currency} ${f.obs.amount} 환산 실패`)
    assert.ok(Math.abs(r!.krw_per_gpu_hour - f.expectKrwPerGpuHour) < 0.5,
      `${f.obs.currency} ${f.obs.amount}/${f.obs.pricing_unit}×${f.obs.gpu_count}장 → 기대 ${f.expectKrwPerGpuHour}, 실제 ${r!.krw_per_gpu_hour}`)
  }
})
