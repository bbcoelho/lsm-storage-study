import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HashIndexedLog, LSMTree, SSTableSegment } from "../src/lsm.js";

function tempDirectory(t: test.TestContext): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lsm-study-"));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	return directory;
}

// Verifies that the hash index returns the newest value and can be rebuilt from the append-only log.
test("hash indexed log rebuilds newest offsets", (t) => {
	const file = path.join(tempDirectory(t), "data.log");
	const store = new HashIndexedLog(file);

	store.set("color", "blue");
	store.set("shape", "circle");
	store.set("color", "green");

	const rebuilt = new HashIndexedLog(file, true);

	assert.equal(store.get("color"), "green");
	assert.equal(rebuilt.get("color"), "green");
	assert.equal(rebuilt.get("shape"), "circle");
});

// Verifies that SSTables sort records, use sparse scans, and skip impossible misses with a Bloom filter.
test("sstable uses sorted sparse lookup and bloom skip", (t) => {
	const directory = tempDirectory(t);
	const segment = SSTableSegment.create(directory, "segment-a", [
		{ key: "handbag", value: "bag", kind: "put", seq: 1 },
		{ key: "handsome", value: "nice", kind: "put", seq: 2 },
		{ key: "handiwork", value: "craft", kind: "put", seq: 3 },
		{ key: "hat", value: "cap", kind: "put", seq: 4 },
	], 2);

	const found = segment.lookup("handiwork");
	const missing = segment.lookup("zzzz");

	assert.equal(found.found, true);
	assert.equal(found.entry?.value, "craft");
	assert.deepEqual(segment.range("handbag", "hat").map((entry) => entry.key), [
		"handbag",
		"handiwork",
		"handsome",
		"hat",
	]);
	assert.equal(missing.skippedByBloom, true);
});

// Verifies that reads prefer the newest segment, which is essential when older segments contain stale values.
test("lsm tree reads newest segment before older segments", (t) => {
	const tree = new LSMTree(tempDirectory(t), 10, 2);

	tree.put("alpha", "old");
	tree.flush();
	tree.put("alpha", "new");
	tree.flush();

	assert.equal(tree.get("alpha"), "new");
});

// Verifies that tombstones hide older values and full compaction removes deleted keys from surviving data.
test("tombstones hide values and compaction drops deleted keys", (t) => {
	const tree = new LSMTree(tempDirectory(t), 10, 2);

	tree.put("alpha", "1");
	tree.put("bravo", "2");
	tree.flush();
	tree.delete("bravo");
	tree.put("charlie", "3");
	tree.flush();

	assert.equal(tree.get("bravo"), undefined);
	tree.compactAll();

	assert.equal(tree.get("alpha"), "1");
	assert.equal(tree.get("bravo"), undefined);
	assert.equal(tree.get("charlie"), "3");
});
