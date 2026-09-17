# @ax/ai-gateway

The one way out. Everything that has to happen when text leaves for a vendor happens here, so
it cannot be skipped by forgetting it.

## Masking is reversible

```ts
import { maskPii, unmaskPii, hasUnmaskedPii, countByKind } from '@ax/ai-gateway'

const masked = maskPii(text, { knownNames: ['김도현', '이수진'] })
// masked.text  — '⟦PII_1⟧ 님께 010-⟦PII_2⟧ 로 연락'
if (hasUnmaskedPii(masked.text, { knownNames })) throw new Error('do not send this')

const answer = await callVendor(masked.text)
return unmaskPii(answer, masked.hits)      // the user sees their own words again
```

The placeholder shape `⟦PII_n⟧` is deliberately strange: a model leaves it alone, and a model
that rewrites it produces something obviously wrong rather than something subtly wrong. The
same value always gets the same placeholder, so a model can still reason that two mentions are
the same person.

**Names are not guessed.** There is no name pattern, and adding one would fail in both
directions at once — a missed name goes out, and a wrongly matched word breaks the sentence,
and neither is visible until a human reads the output. Instead the caller passes the names it
already owns: its directory, its meeting attendees, its staff list. `MIN_MASKABLE_NAME` drops
anything too short to mask safely.

`roundTrips()` is the property that matters: mask then unmask returns the original. If that
ever fails, masking is destroying user data rather than protecting it.

## Every call leaves a receipt

```ts
import { callWithFallback, recorded, isRecorded } from '@ax/ai-gateway'

const out = await callWithFallback(
  chain,                       // models in the order to try
  request,                     // what to send, and the document class it belongs to
  { store, call, gate },       // where to record, how to call, who may receive it
)
```

`callWithFallback` walks the chain in order, asking the injected `gate` **again for every
model** whether this document class may go to it — a fallback that skips the gate is a leak —
and writes two records through `store`: that a call happened, and that text left. `TransferBlockedError` means the gate refused — it is not a failure to retry.
`NoModelAvailableError` means the chain is exhausted, and it carries what was tried.

`Receipt` is a small type with a large point: `isRecorded` forces a caller to deal with the
case where nothing was written. A pipeline that treats "recorded" and "not recorded" as the
same shape reports a silent zero as success, which is exactly how this product lost three
sets of records once already.

## Storage is the caller's

```ts
interface GatewayStore {
  recordCall(row: LlmCallRecord): Promise<void>
  recordTransfer(row: TransferRecord): Promise<void>
}
```

There is **no default implementation**, and that is the design. A no-op store is
indistinguishable from a working one until someone goes looking for the records and finds none.

A real writer may swallow its own failures — a ledger that cannot write must not stop a user's
work — but it must not swallow them *silently*.

## Recovering JSON a model refused to format

```ts
import { recoverJson, JsonRecoverError, asJsonRecord } from '@ax/ai-gateway'
```

Models asked for JSON sometimes answer with prose around it, or a fenced block, or a trailing
comma. `recoverJson` digs the object out and throws `JsonRecoverError` with a sample when it
cannot — the sample is what lets you tell "the model ignored the instruction" from "our parser
is wrong", and those have different fixes.

## Cost

`costKrw` turns token counts into money using the rates the caller supplies. The rates are not
in here: what a model costs is a fact about a contract, and it changes without any code
changing.

## Tests

```bash
cd packages/ai-gateway && pnpm typecheck
```
