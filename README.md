# Log-Structured Storage Study Project

This is a small TypeScript project for practicing the concepts behind append-only logs, hash indexes, SSTables, memtables, tombstones, Bloom filters, and compaction.

## Setup

```sh
npm install
```

## Run The Lessons

```sh
npm run demo
```

Run one concept at a time:

```sh
npm run demo:01
npm run demo:02
npm run demo:03
npm run demo:04
npm run demo:05
npm run demo:06
```

## Lesson Map

| Lesson | Concept | What To Notice |
| --- | --- | --- |
| `01` | Append-only log | Writes only append, so older values remain on disk. |
| `02` | In-memory hash index | Reads jump straight to the newest byte offset. |
| `03` | SSTable + sparse index | Sorted keys allow sparse indexing and short scans. |
| `04` | Memtable + flush | Random-order writes become sorted immutable SSTables. |
| `05` | Tombstones + Bloom filter | Deletes are records, and absent keys can skip files quickly. |
| `06` | Compaction | Multiple immutable segments merge into one smaller segment. |

## Verify

```sh
npm run check
npm test
```

The tests are intentionally small. Read them alongside `src/lsm.ts` to connect each behavior with the storage concept.
