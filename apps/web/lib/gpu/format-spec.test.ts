import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatSpec, scaleSpec } from './format-spec.ts'

test('formatSpec — 전체 필드 + 3자리 콤마', () => {
  assert.equal(
    formatSpec({ memory: '640GB', vcpu: 240, ram_gb: 1800, storage_gb: 20480 }),
    'VRAM 640GB · 240 vCPU · 1,800GB RAM · 20TB SSD'
  )
})

test('formatSpec — storage 1024 미만은 GB, 콤마 유지', () => {
  assert.equal(
    formatSpec({ memory: '40GB', vcpu: 30, ram_gb: 225, storage_gb: 512 }),
    'VRAM 40GB · 30 vCPU · 225GB RAM · 512GB SSD'
  )
})

test('formatSpec — storage 1.5TB는 소수 1자리', () => {
  assert.equal(formatSpec({ storage_gb: 1536 }), '1.5TB SSD')
})

test('formatSpec — 누락 필드는 생략', () => {
  assert.equal(formatSpec({ memory: '80GB' }), 'VRAM 80GB')
  assert.equal(formatSpec({}), '')
})

test('scaleSpec — 1장당 스펙 × N 환산', () => {
  const base = { gpu_count: 1, vcpu: 30, ram_gb: 225, storage_gb: 512, memory: '80GB' }
  const x8 = scaleSpec(base, 8)
  assert.equal(x8.vcpu, 240)
  assert.equal(x8.ram_gb, 1800)
  assert.equal(x8.storage_gb, 4096)
  assert.equal(x8.gpu_count, 8)
})

test('scaleSpec — base gpu_count가 1보다 클 때 비율 환산', () => {
  const base = { gpu_count: 2, vcpu: 60, ram_gb: 450, storage_gb: 1024 }
  const x8 = scaleSpec(base, 8) // ×4
  assert.equal(x8.vcpu, 240)
  assert.equal(x8.ram_gb, 1800)
})

test('scaleSpec — null 스펙은 null 유지', () => {
  const x4 = scaleSpec({ gpu_count: 1, vcpu: null, ram_gb: null, storage_gb: null }, 4)
  assert.equal(x4.vcpu, null)
  assert.equal(x4.ram_gb, null)
})
