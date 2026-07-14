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

const lessons: Record<string, () => void> = {
	"01": lesson01,
	"02": lesson02,
	"03": lesson03,
};


if (selectedLesson) {
	lessons[selectedLesson]?.();
} else {
	for (const lesson of Object.values(lessons)) {
		lesson();
	}
}
