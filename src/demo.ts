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

async function lesson01(context: LessonContext): Promise<void> {
	const directory = path.join(dataRoot, "01-append-log");
	resetDirectory(directory);
	const log = new AppendOnlyLog(path.join(directory, "data.log"));

	heading("Lesson 01: Append-only log");
	concept([
		"A write does not update an existing row in place.",
		"Every write appends a new record at the end of the file.",
		"The byte offset becomes the physical address of that record.",
	]);

	operation('append({ key: "color", value: "blue" })');
	await prediction(context, "The file is empty. What byte offset should the first record get?");
	const firstOffset = log.append({ key: "color", value: "blue", kind: "put", seq: 1 });
	table("Physical log after first append", log.scan().map(({ offset, entry }) => ({
		offset,
		key: entry.key,
		value: formatValue(entry.value),
		kind: entry.kind,
		seq: entry.seq,
	})));
	takeaway([`The first record starts at byte offset ${firstOffset}.`]);

	operation('append({ key: "shape", value: "circle" })');
	await prediction(context, "Will this overwrite color, or be placed after the first row?");
	const secondOffset = log.append({ key: "shape", value: "circle", kind: "put", seq: 2 });
	table("Physical log after second append", log.scan().map(({ offset, entry }) => ({
		offset,
		key: entry.key,
		value: formatValue(entry.value),
		kind: entry.kind,
		seq: entry.seq,
	})));
	takeaway([`The second record starts at byte offset ${secondOffset}; the first row remains unchanged.`]);

	operation('append({ key: "color", value: "green" })');
	await prediction(context, "This key already exists. What happens to the old color=blue row?");
	const thirdOffset = log.append({ key: "color", value: "green", kind: "put", seq: 3 });
	table("Physical log after overwrite append", log.scan().map(({ offset, entry }) => ({
		offset,
		key: entry.key,
		value: formatValue(entry.value),
		kind: entry.kind,
		seq: entry.seq,
	})));
	takeaway([
		`The new color value starts at byte offset ${thirdOffset}.`,
		"The old color=blue row still occupies disk space until a later compaction step removes stale data.",
	]);
}

async function lesson02(context: LessonContext): Promise<void> {
	const directory = path.join(dataRoot, "02-hash-index");
	resetDirectory(directory);
	const file = path.join(directory, "data.log");
	const store = new HashIndexedLog(file);

	heading("Lesson 02: In-memory hash index");
	concept([
		"The append-only log is durable, but scanning it for every read is slow.",
		"A hash index maps each key to the newest byte offset for that key.",
		"The index is memory-only, so restart requires rebuilding it from the log.",
	]);

	operation('set("color", "blue")');
	await prediction(context, "After the append, what should the hash index store for color?");
	store.set("color", "blue");
	let snapshot = store.snapshot() as { log: Array<{ offset: number; entry: { key: string; value: string | null; kind: string; seq: number } }>; index: Record<string, number> };
	table("Log rows", snapshot.log.map(({ offset, entry }) => ({
		offset,
		key: entry.key,
		value: formatValue(entry.value),
		kind: entry.kind,
		seq: entry.seq,
	})));
	table("Hash index", Object.entries(snapshot.index).map(([key, offset]) => ({ key, offset })));
	takeaway(["The index points color directly to its physical log offset."]);

	operation('set("shape", "circle")');
	await prediction(context, "Will shape need to scan color first, or can it get its own index entry?");
	store.set("shape", "circle");
	snapshot = store.snapshot() as typeof snapshot;
	table("Hash index", Object.entries(snapshot.index).map(([key, offset]) => ({ key, offset })));
	takeaway(["Each key has one index entry, even though the log may keep growing."]);

	operation('set("color", "green")');
	await prediction(context, "Color already has an index entry. Should it point to the old row or the newest row?");
	store.set("color", "green");
	snapshot = store.snapshot() as typeof snapshot;
	table("Log rows", snapshot.log.map(({ offset, entry }) => ({
		offset,
		key: entry.key,
		value: formatValue(entry.value),
		kind: entry.kind,
		seq: entry.seq,
	})));
	table("Hash index", Object.entries(snapshot.index).map(([key, offset]) => ({ key, offset })));
	takeaway(["The index for color moved to the newest offset, while the old color row stayed in the log."]);

	operation('get("color")');
	await prediction(context, "What value should the read return if it jumps to the indexed offset?");
	console.log(`\nRead result: ${store.get("color")}`);
	takeaway(["The read uses one hash lookup plus one offset read, rather than scanning every log row."]);

	operation("simulate restart");
	await prediction(context, "The log file remains on disk. What happens to the in-memory hash map?");
	const emptyMemoryStore = new HashIndexedLog(file);
	const rebuilt = new HashIndexedLog(file, true);
	console.log(`\nRead without rebuilding index: ${emptyMemoryStore.get("color") ?? "<missing>"}`);
	console.log(`Read after rebuilding index: ${rebuilt.get("color")}`);
	takeaway(["The durable log can rebuild the volatile hash index, but large logs make restart slower."]);
}

async function lesson03(context: LessonContext): Promise<void> {
	const directory = path.join(dataRoot, "03-sstable");
	resetDirectory(directory);
	const inputRows = [
		{ key: "handbag", value: "bag", kind: "put" as const, seq: 1 },
		{ key: "handsome", value: "nice", kind: "put" as const, seq: 2 },
		{ key: "handiwork", value: "craft", kind: "put" as const, seq: 3 },
		{ key: "hat", value: "cap", kind: "put" as const, seq: 4 },
		{ key: "zebra", value: "animal", kind: "put" as const, seq: 5 },
	];

	heading("Lesson 03: SSTable with sparse index");
	concept([
		"An SSTable stores one sorted row per key.",
		"A sparse index stores only the first key of each block.",
		"A lookup jumps near the key, then scans a short sorted range.",
	]);
	table("Input rows before SSTable write", inputRows.map((entry) => ({
		key: entry.key,
		value: entry.value,
		seq: entry.seq,
	})));

	operation("create SSTable with blockSize=2");
	await prediction(context, "The input includes handiwork after handsome. What order should the SSTable store them in?");
	const segment = SSTableSegment.create(directory, "segment-a", [
		...inputRows,
	], 2);
	const snapshot = segment.snapshot();
	table("Sorted SSTable rows", segmentRows(snapshot));
	table("Sparse index", sparseIndexRows(snapshot));
	takeaway(["The sparse index is smaller than the data: one index entry per block, not per key."]);

	operation('lookup("handiwork")');
	await prediction(context, "handiwork is not a sparse-index key. Which block should the lookup start scanning from?");
	const lookup = segment.lookup("handiwork");
	table("Lookup trace", [{
		startKey: lookup.startKey ?? "-",
		scannedKeys: lookup.scannedKeys.join(", "),
		found: lookup.found,
		value: lookup.entry?.value ?? "-",
	}]);
	takeaway(["Sorted keys let the read stop once it finds the target or passes where it could be."]);

	operation('range("handbag", "hat")');
	await prediction(context, "Why is a sorted file better than a hash map for this range query?");
	table("Range scan result", segment.range("handbag", "hat").map((entry) => ({
		key: entry.key,
		value: formatValue(entry.value),
		seq: entry.seq,
	})));
	takeaway(["Range queries become sequential scans over neighboring sorted keys."]);
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
