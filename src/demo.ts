import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppendOnlyLog, HashIndexedLog, LSMTree, SSTableSegment, resetDirectory } from "./lsm.js";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataRoot = path.join(projectRoot, ".study-data");

function print(title: string, value: unknown): void {
	console.log(`\n## ${title}`);
	console.log(JSON.stringify(value, null, "\t"));
}

function lesson01(): void {
	const directory = path.join(dataRoot, "01-append-log");
	resetDirectory(directory);
	const log = new AppendOnlyLog(path.join(directory, "data.log"));

	const firstOffset = log.append({ key: "color", value: "blue", kind: "put", seq: 1 });
	const secondOffset = log.append({ key: "shape", value: "circle", kind: "put", seq: 2 });
	const thirdOffset = log.append({ key: "color", value: "green", kind: "put", seq: 3 });

	print("01 Append-only log", {
		idea: "Updates are new rows. Old rows stay on disk until compaction exists.",
		offsets: { firstOffset, secondOffset, thirdOffset },
		physicalLog: log.scan(),
	});
}

function lesson02(): void {
	const directory = path.join(dataRoot, "02-hash-index");
	resetDirectory(directory);
	const file = path.join(directory, "data.log");
	const store = new HashIndexedLog(file);

	store.set("color", "blue");
	store.set("shape", "circle");
	store.set("color", "green");

	const rebuilt = new HashIndexedLog(file, true);

	print("02 In-memory hash index", {
		idea: "The index points each key to its newest byte offset, but it must be rebuilt after restart.",
		valueBeforeRestart: store.get("color"),
		valueAfterRebuild: rebuilt.get("color"),
		snapshot: rebuilt.snapshot(),
	});
}

function lesson03(): void {
	const directory = path.join(dataRoot, "03-sstable");
	resetDirectory(directory);
	const segment = SSTableSegment.create(directory, "segment-a", [
		{ key: "handbag", value: "bag", kind: "put", seq: 1 },
		{ key: "handsome", value: "nice", kind: "put", seq: 2 },
		{ key: "handiwork", value: "craft", kind: "put", seq: 3 },
		{ key: "hat", value: "cap", kind: "put", seq: 4 },
		{ key: "zebra", value: "animal", kind: "put", seq: 5 },
	], 2);

	print("03 SSTable with sparse index", {
		idea: "Rows are sorted, so the sparse index jumps near the key and then scans forward.",
		segment: segment.snapshot(),
		lookup: segment.lookup("handiwork"),
		range: segment.range("handbag", "hat"),
	});
}

function lesson04(): void {
	const directory = path.join(dataRoot, "04-memtable-flush");
	resetDirectory(directory);
	const tree = new LSMTree(directory, 10, 2);

	tree.put("delta", "4");
	tree.put("alpha", "1");
	tree.put("charlie", "3");
	tree.put("bravo", "2");

	const beforeFlush = tree.snapshot();
	tree.flush();

	print("04 Memtable flush", {
		idea: "Writes arrive in any order in memory, then flush as a sorted immutable SSTable.",
		beforeFlush,
		afterFlush: tree.snapshot(),
		readTrace: tree.getWithTrace("charlie"),
	});
}

function lesson05(): void {
	const directory = path.join(dataRoot, "05-tombstone-bloom");
	resetDirectory(directory);
	const tree = new LSMTree(directory, 3, 2);

	tree.put("alpha", "1");
	tree.put("bravo", "2");
	tree.put("charlie", "3");
	tree.delete("bravo");
	tree.flush();

	print("05 Tombstones and Bloom filters", {
		idea: "Deletes hide older values, and Bloom filters let absent keys skip segments without scanning.",
		readDeleted: tree.getWithTrace("bravo"),
		readAbsent: tree.getWithTrace("omega"),
		snapshot: tree.snapshot(),
	});
}

function lesson06(): void {
	const directory = path.join(dataRoot, "06-compaction");
	resetDirectory(directory);
	const tree = new LSMTree(directory, 10, 2);

	tree.put("alpha", "old");
	tree.put("bravo", "2");
	tree.flush();
	tree.put("alpha", "new");
	tree.delete("bravo");
	tree.put("charlie", "3");
	tree.flush();

	const beforeCompaction = tree.snapshot();
	tree.compactAll();

	print("06 Compaction", {
		idea: "Newest values survive, overwritten values disappear, and tombstones can be dropped after covering all older segments.",
		beforeCompaction,
		afterCompaction: tree.snapshot(),
		readAlpha: tree.getWithTrace("alpha"),
		readBravo: tree.getWithTrace("bravo"),
	});
}

const lessons: Record<string, () => void> = {
	"01": lesson01,
	"02": lesson02,
	"03": lesson03,
	"04": lesson04,
	"05": lesson05,
	"06": lesson06,
};

const selectedLesson = process.argv[2];

if (selectedLesson) {
	lessons[selectedLesson]?.();
} else {
	for (const lesson of Object.values(lessons)) {
		lesson();
	}
}
