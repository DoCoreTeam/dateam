import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recorded, notRecorded, isRecorded, type Receipt } from './store.ts'
import { callWithFallback, type GatewayStore, type CallableModel } from './gateway.ts'

const MODEL: CallableModel = { id: 'm1', modelName: 'vendor-m1', inputKrwPerMTok: 10, outputKrwPerMTok: 20 }

const REQ = {
  orgId: 'o', caseId: null, docClass: 'public', purpose: 'test', prompt: 'hello',
}

function storeThat(call: Receipt, transfer: Receipt): GatewayStore & { calls: number; transfers: number } {
  const s = {
    calls: 0,
    transfers: 0,
    async recordCall() { s.calls++; return call },
    async recordTransfer() { s.transfers++; return transfer },
  }
  return s
}

const ok = async () => ({ text: 'answer', inputTokens: 1000, outputTokens: 500 })
const openGate = () => ({ allowed: true as const, internal: false })

test('a skipped recording must state a reason', () => {
  assert.throws(() => notRecorded(''), /must state a reason/)
  assert.throws(() => notRecorded('   '), /must state a reason/)
  assert.equal(notRecorded('public grade, nothing to log').recorded, false)
})

test('the result carries what each ledger said', async () => {
  const store = storeThat(recorded('call-1'), recorded('transfer-1'))
  const out = await callWithFallback([MODEL], REQ, { store, call: ok, gate: openGate })
  assert.deepEqual(out.meta.callReceipt, { recorded: true, id: 'call-1' })
  assert.deepEqual(out.meta.transferReceipt, { recorded: true, id: 'transfer-1' })
})

test('declining to record comes back with the reason, not as silence', async () => {
  const store = storeThat(recorded('call-1'), notRecorded('public grade, nothing to log'))
  const out = await callWithFallback([MODEL], REQ, { store, call: ok, gate: openGate })
  assert.equal(isRecorded(out.meta.transferReceipt), false)
  assert.equal(out.meta.transferReceipt && !out.meta.transferReceipt.recorded
    ? out.meta.transferReceipt.reason : null, 'public grade, nothing to log')
})

test('an internal model produces no transfer receipt at all, which is not the same as declining', async () => {
  const store = storeThat(recorded('call-1'), recorded('transfer-1'))
  const internalGate = () => ({ allowed: true as const, internal: true })
  const out = await callWithFallback([MODEL], REQ, { store, call: ok, gate: internalGate })
  assert.equal(out.meta.transferReceipt, null)
  assert.equal(store.transfers, 0, 'nothing left our side, so the transfer desk is never asked')
})

test('the recording desk is required, so there is no path where nobody is asked', async () => {
  const store = storeThat(recorded('call-1'), recorded('transfer-1'))
  await callWithFallback([MODEL], REQ, { store, call: ok, gate: openGate })
  assert.equal(store.calls, 1)
  assert.equal(store.transfers, 1)
})

test('a failed call still reaches the call ledger', async () => {
  const store = storeThat(recorded('call-1'), recorded('transfer-1'))
  const boom = async () => { throw new Error('vendor down') }
  await assert.rejects(
    callWithFallback([MODEL], REQ, { store, call: boom, gate: openGate }),
    /no usable model/,
  )
  assert.equal(store.calls, 1)
  assert.equal(store.transfers, 0, 'nothing went out, so nothing is written to the transfer ledger')
})
