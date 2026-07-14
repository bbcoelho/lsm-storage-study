import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { AppendOnlyLog, HashIndexedLog, LSMTree, SSTableSegment, resetDirectory } from "./lsm.js";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataRoot = path.join(projectRoot, ".study-data");

type LessonContext = {
	rl: Interface;
};

type Lesson = (context: LessonContext) => Promise<void> | void;

type TableRow = Record<string, boolean | number | string | null | undefined>;

function heading(title: string): void {
	console.log(`\n${"=".repeat(72)}`);
	console.log(title);
	console.log("=".repeat(72));
}

function concept(lines: string[]): void {
	console.log("\nConcept:");
	for (const line of lines) {
		console.log(`- ${line}`);
	}
}

function operation(text: string): void {
	console.log("\nOperation:");
	console.log(`  ${text}`);
}

async function prediction(context: LessonContext, question: string): Promise<void> {
	console.log("\nPrediction:");
	console.log(question);
	await pause(context);
}

async function pause(context: LessonContext, prompt = "Press Enter to continue..."): Promise<void> {
	await context.rl.question(`\n${prompt}`);
}

function takeaway(lines: string[]): void {
	console.log("\nTakeaway:");
	for (const line of lines) {
		console.log(`- ${line}`);
	}
}

function table(title: string, rows: TableRow[]): void {
	console.log(`\n${title}:`);
	if (rows.length === 0) {
		console.log("  empty");
		return;
	}

	console.table(rows);
}

function formatValue(value: string | null): string {
	return value ?? "<tombstone>";
}

function segmentRows(snapshot: object): TableRow[] {
	const segment = snapshot as { entries: Array<{ key: string; value: string | null; kind: string; seq: number }> };
	return segment.entries.map((entry) => ({
		key: entry.key,
		value: formatValue(entry.value),
		kind: entry.kind,
		seq: entry.seq,
	}));
}

function sparseIndexRows(snapshot: object): TableRow[] {
	const segment = snapshot as { sparseIndex: Array<{ firstKey: string; offset: number }> };
	return segment.sparseIndex.map((entry) => ({
		firstKey: entry.firstKey,
		offset: entry.offset,
	}));
}

function traceRows(trace: object): TableRow[] {
	const read = trace as { trace: Array<{ place: string; found: boolean; skippedByBloom: boolean; startKey?: string; scannedKeys: string[] }> };
	return read.trace.map((step) => ({
		place: step.place,
		found: step.found,
		skippedByBloom: step.skippedByBloom,
		startKey: step.startKey ?? "-",
		scannedKeys: step.scannedKeys.join(", ") || "-",
	}));
}

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

const lessonTitles: Record<string, string> = {
	"01": "Append-only log",
	"02": "In-memory hash index",
	"03": "SSTable with sparse index",
	"04": "Memtable, WAL, and flush",
	"05": "Tombstones and Bloom filters",
	"06": "Compaction",
};

const lessons: Record<string, Lesson> = {
	"01": lesson01,
	"02": lesson02,
	"03": lesson03,
	"04": lesson04,
	"05": lesson05,
	"06": lesson06,
};

const selectedLesson = process.argv[2];

async function chooseLesson(context: LessonContext): Promise<string> {
	heading("Log-Structured Storage Interactive Demos");
	console.log("Choose one lesson, or run all lessons in order.\n");
	for (const [id, title] of Object.entries(lessonTitles)) {
		console.log(`${id}. ${title}`);
	}
	console.log("all. Run every lesson");

	const answer = await context.rl.question("\nLesson [all]: ");
	return answer.trim() || "all";
}

async function run(): Promise<void> {
	const rl = createInterface({ input, output });
	const context = { rl };

	try {
		const selected = selectedLesson ?? await chooseLesson(context);

		if (selected === "all") {
			for (const lesson of Object.values(lessons)) {
				await lesson(context);
			}
			return;
		}

		const lesson = lessons[selected];
		if (!lesson) {
			console.log(`Unknown lesson "${selected}". Use 01-06 or all.`);
			return;
		}

		await lesson(context);
	} finally {
		rl.close();
	}
}

await run();
