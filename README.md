# Log-Structured Storage Study Project

This is a small TypeScript project for practicing the concepts behind append-only logs, hash indexes, SSTables, memtables, tombstones, Bloom filters, and compaction.

## Setup

```sh
npm install
```

## Run The Interactive Lessons

The demos are guided CLI lessons. Each lesson presents a concept, shows the next operation, asks you to predict the result, waits for Enter, then prints the storage state as tables.

```sh
npm run demo
```

`npm run demo` opens a lesson menu. Choose `01` through `06`, or choose `all` to run every lesson in sequence.

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
| `01` | Append-only log | Predict byte offsets and see overwritten values remain physically present. |
| `02` | In-memory hash index | Watch keys move to newer offsets and rebuild the volatile index after restart. |
| `03` | SSTable + sparse index | See sorted rows, sparse index blocks, lookup scan paths, and range scans. |
| `04` | Memtable + WAL + flush | Compare WAL order, memtable state, flushed SSTable rows, and read tracing. |
| `05` | Tombstones + Bloom filter | Follow deleted reads and absent-key Bloom filter skips. |
| `06` | Compaction | Merge segments and see stale values and tombstones disappear physically. |

## Practice Style

When a prediction prompt appears, pause before pressing Enter and answer it yourself. The next table shows whether your mental model matches the storage engine state.

## Verify

```sh
npm run check
npm test
```

The tests are intentionally small. Read them alongside `src/lsm.ts` to connect each behavior with the storage concept.
