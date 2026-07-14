import fs from "node:fs";
import path from "node:path";

export type EntryKind = "put" | "delete";

export type LogEntry = {
	key: string;
	value: string | null;
	kind: EntryKind;
	seq: number;
};

export type SparseIndexEntry = {
	firstKey: string;
	offset: number;
};

type SegmentMeta = {
	id: string;
	createdAtSeq: number;
	blockSize: number;
	sparseIndex: SparseIndexEntry[];
	bloom: BloomFilterJSON;
};

type BloomFilterJSON = {
	bitSize: number;
	hashCount: number;
	bits: number[];
};

export type SegmentLookup = {
	found: boolean;
	skippedByBloom: boolean;
	entry?: LogEntry;
	startKey?: string;
	scannedKeys: string[];
};

export function resetDirectory(directory: string): void {
	// Recreate the directory so every demo starts from a blank disk.
	fs.rmSync(directory, { recursive: true, force: true });
	fs.mkdirSync(directory, { recursive: true });
}

function ensureFile(filePath: string): void {
	// Make parent directories and create an empty file if it does not exist.
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	if (!fs.existsSync(filePath)) {
		fs.writeFileSync(filePath, "");
	}
}

function encodeEntry(entry: LogEntry): string {
	return `${JSON.stringify(entry)}\n`;
}

function decodeEntry(line: string): LogEntry {
	return JSON.parse(line) as LogEntry;
}

function byKey(a: LogEntry, b: LogEntry): number {
	return a.key.localeCompare(b.key);
}

function sortedEntries(entries: Iterable<LogEntry>): LogEntry[] {
	return [...entries].sort(byKey);
}

function uniqueLatestByKey(entries: Iterable<LogEntry>): LogEntry[] {
	const latest = new Map<string, LogEntry>();

	// Keep the newest sequence number when duplicate keys appear.
	for (const entry of entries) {
		const current = latest.get(entry.key);
		if (!current || entry.seq > current.seq) {
			latest.set(entry.key, entry);
		}
	}

	return sortedEntries(latest.values());
}

export class AppendOnlyLog {
	constructor(private readonly filePath: string) {
		ensureFile(filePath);
	}

	append(entry: LogEntry): number {
		// Record the current byte size; that is where the new entry will start.
		const offset = fs.statSync(this.filePath).size;
		fs.appendFileSync(this.filePath, encodeEntry(entry));
		return offset;
	}

	readAt(offset: number): LogEntry {
		// Seek by slicing from the known byte offset and decode one newline record.
		const data = fs.readFileSync(this.filePath, "utf8");
		const rest = data.slice(offset);
		const lineEnd = rest.indexOf("\n");
		const line = lineEnd === -1 ? rest : rest.slice(0, lineEnd);
		return decodeEntry(line);
	}

	scan(): Array<{ offset: number; entry: LogEntry }> {
		const rows: Array<{ offset: number; entry: LogEntry }> = [];
		let offset = 0;

		// Walk the log in physical order and calculate each row's byte offset.
		for (const line of fs.readFileSync(this.filePath, "utf8").split("\n")) {
			if (line.length === 0) {
				continue;
			}

			rows.push({ offset, entry: decodeEntry(line) });
			offset += Buffer.byteLength(`${line}\n`);
		}

		return rows;
	}

	truncate(): void {
		// Reset the recovery log after its writes are safely flushed to SSTables.
		fs.writeFileSync(this.filePath, "");
	}
}

export class HashIndexedLog {
	private readonly log: AppendOnlyLog;
	private readonly offsets = new Map<string, number>();
	private nextSeq = 1;

	constructor(filePath: string, rebuildIndex = false) {
		this.log = new AppendOnlyLog(filePath);

		// Optionally rebuild volatile memory state by scanning the durable log.
		if (rebuildIndex) {
			this.rebuildIndex();
		}
	}

	set(key: string, value: string): number {
		// Append first, then update the in-memory index to the newest offset.
		const offset = this.log.append({ key, value, kind: "put", seq: this.nextSeq++ });
		this.offsets.set(key, offset);
		return offset;
	}

	delete(key: string): number {
		// A delete is also an append-only record; reads interpret it as absence.
		const offset = this.log.append({ key, value: null, kind: "delete", seq: this.nextSeq++ });
		this.offsets.set(key, offset);
		return offset;
	}

	get(key: string): string | undefined {
		// Use the index to jump to the newest physical row for this key.
		const offset = this.offsets.get(key);
		if (offset === undefined) {
			return undefined;
		}

		const entry = this.log.readAt(offset);
		return entry.kind === "delete" ? undefined : entry.value ?? undefined;
	}

	rebuildIndex(): void {
		this.offsets.clear();

		// Replay the log so the latest occurrence of each key wins.
		for (const { offset, entry } of this.log.scan()) {
			this.offsets.set(entry.key, offset);
			this.nextSeq = Math.max(this.nextSeq, entry.seq + 1);
		}
	}

	snapshot(): object {
		return {
			log: this.log.scan(),
			index: Object.fromEntries([...this.offsets.entries()].sort()),
		};
	}
}

export class BloomFilter {
	private readonly bits: number[];

	constructor(
		private readonly bitSize: number,
		private readonly hashCount: number,
		bits?: number[],
	) {
		this.bits = bits ?? Array.from({ length: bitSize }, () => 0);
	}

	static fromKeys(keys: string[], bitsPerKey = 10): BloomFilter {
		// Choose a small deterministic filter that is easy to inspect in demos.
		const bitSize = Math.max(16, keys.length * bitsPerKey);
		const hashCount = Math.max(3, Math.round((bitSize / Math.max(keys.length, 1)) * Math.log(2)));
		const filter = new BloomFilter(bitSize, hashCount);

		for (const key of keys) {
			filter.add(key);
		}

		return filter;
	}

	static fromJSON(json: BloomFilterJSON): BloomFilter {
		return new BloomFilter(json.bitSize, json.hashCount, json.bits);
	}

	add(key: string): void {
		// Set every bit chosen by the hash family for this key.
		for (const index of this.indexesFor(key)) {
			this.bits[index] = 1;
		}
	}

	mightContain(key: string): boolean {
		// Any zero bit proves absence; all one bits means "maybe".
		return this.indexesFor(key).every((index) => this.bits[index] === 1);
	}

	toJSON(): BloomFilterJSON {
		return {
			bitSize: this.bitSize,
			hashCount: this.hashCount,
			bits: [...this.bits],
		};
	}

	private indexesFor(key: string): number[] {
		const indexes: number[] = [];

		// Derive multiple stable hashes by salting the same string hash.
		for (let salt = 0; salt < this.hashCount; salt += 1) {
			indexes.push(stableHash(`${salt}:${key}`) % this.bitSize);
		}

		return indexes;
	}
}

function stableHash(input: string): number {
	let hash = 2166136261;

	// FNV-1a gives a compact deterministic hash without external dependencies.
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return hash >>> 0;
}

export class SSTableSegment {
	private readonly bloom: BloomFilter;

	private constructor(
		private readonly dataFile: string,
		private readonly metaFile: string,
		private readonly meta: SegmentMeta,
	) {
		this.bloom = BloomFilter.fromJSON(meta.bloom);
	}

	static create(directory: string, id: string, entries: Iterable<LogEntry>, blockSize = 3): SSTableSegment {
		fs.mkdirSync(directory, { recursive: true });

		const dataFile = path.join(directory, `${id}.sst`);
		const metaFile = path.join(directory, `${id}.meta.json`);
		const rows = uniqueLatestByKey(entries);
		const sparseIndex: SparseIndexEntry[] = [];
		let offset = 0;
		let file = "";

		// Write sorted records once and capture the first key in each block.
		for (let index = 0; index < rows.length; index += 1) {
			const entry = rows[index];
			if (!entry) {
				continue;
			}

			if (index % blockSize === 0) {
				sparseIndex.push({ firstKey: entry.key, offset });
			}

			const encoded = encodeEntry(entry);
			file += encoded;
			offset += Buffer.byteLength(encoded);
		}

		const bloom = BloomFilter.fromKeys(rows.map((entry) => entry.key));
		const meta: SegmentMeta = {
			id,
			createdAtSeq: rows.reduce((max, entry) => Math.max(max, entry.seq), 0),
			blockSize,
			sparseIndex,
			bloom: bloom.toJSON(),
		};

		fs.writeFileSync(dataFile, file);
		fs.writeFileSync(metaFile, JSON.stringify(meta, null, "\t"));

		return new SSTableSegment(dataFile, metaFile, meta);
	}

	static open(dataFile: string): SSTableSegment {
		// Rehydrate an immutable segment from its sidecar metadata.
		const metaFile = dataFile.replace(/\.sst$/, ".meta.json");
		const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as SegmentMeta;
		return new SSTableSegment(dataFile, metaFile, meta);
	}

	get id(): string {
		return this.meta.id;
	}

	get createdAtSeq(): number {
		return this.meta.createdAtSeq;
	}

	lookup(key: string): SegmentLookup {
		if (!this.bloom.mightContain(key)) {
			return { found: false, skippedByBloom: true, scannedKeys: [] };
		}

		const start = this.findSparseStart(key);
		if (!start) {
			return { found: false, skippedByBloom: false, scannedKeys: [] };
		}

		const scannedKeys: string[] = [];
		const data = fs.readFileSync(this.dataFile, "utf8").slice(start.offset);

		// Scan forward from the nearest sparse-index block until sort order passes the key.
		for (const line of data.split("\n")) {
			if (line.length === 0) {
				continue;
			}

			const entry = decodeEntry(line);
			scannedKeys.push(entry.key);

			if (entry.key === key) {
				return { found: true, skippedByBloom: false, entry, startKey: start.firstKey, scannedKeys };
			}

			if (entry.key.localeCompare(key) > 0) {
				break;
			}
		}

		return { found: false, skippedByBloom: false, startKey: start.firstKey, scannedKeys };
	}

	entries(): LogEntry[] {
		// Decode the immutable table for tests, demos, and compaction.
		return fs.readFileSync(this.dataFile, "utf8")
			.split("\n")
			.filter(Boolean)
			.map(decodeEntry);
	}

	range(startKey: string, endKey: string): LogEntry[] {
		// Sorted storage makes range scans a linear walk over neighboring keys.
		return this.entries().filter((entry) => entry.key >= startKey && entry.key <= endKey);
	}

	deleteFiles(): void {
		// Remove obsolete immutable files only after replacement segments exist.
		fs.rmSync(this.dataFile, { force: true });
		fs.rmSync(this.metaFile, { force: true });
	}

	snapshot(): object {
		return {
			id: this.meta.id,
			entries: this.entries(),
			sparseIndex: this.meta.sparseIndex,
			bloomBits: this.meta.bloom.bits.join(""),
		};
	}

	private findSparseStart(key: string): SparseIndexEntry | undefined {
		let candidate: SparseIndexEntry | undefined;

		// Pick the last block whose first key is less than or equal to the target.
		for (const entry of this.meta.sparseIndex) {
			if (entry.firstKey.localeCompare(key) <= 0) {
				candidate = entry;
			} else {
				break;
			}
		}

		return candidate;
	}
}

export class LSMTree {
	private readonly wal: AppendOnlyLog;
	private readonly segmentDirectory: string;
	private readonly memtable = new Map<string, LogEntry>();
	private readonly segments: SSTableSegment[] = [];
	private nextSeq = 1;

	constructor(
		private readonly directory: string,
		private readonly memtableLimit = 4,
		private readonly blockSize = 3,
	) {
		this.segmentDirectory = path.join(directory, "segments");
		fs.mkdirSync(this.segmentDirectory, { recursive: true });
		this.wal = new AppendOnlyLog(path.join(directory, "wal.log"));

		// Load existing immutable segments so flushed data survives a restart.
		const existingSegments = fs.readdirSync(this.segmentDirectory)
			.filter((fileName) => fileName.endsWith(".sst"))
			.map((fileName) => SSTableSegment.open(path.join(this.segmentDirectory, fileName)))
			.sort((a, b) => b.createdAtSeq - a.createdAtSeq);
		this.segments.push(...existingSegments);

		for (const segment of existingSegments) {
			this.nextSeq = Math.max(this.nextSeq, segment.createdAtSeq + 1);
		}
	}

	put(key: string, value: string): void {
		this.write({ key, value, kind: "put", seq: this.nextSeq++ });
	}

	delete(key: string): void {
		this.write({ key, value: null, kind: "delete", seq: this.nextSeq++ });
	}

	get(key: string): string | undefined {
		// Reads check newest mutable data before older immutable segments.
		const memoryEntry = this.memtable.get(key);
		if (memoryEntry) {
			return memoryEntry.kind === "delete" ? undefined : memoryEntry.value ?? undefined;
		}

		for (const segment of this.segments) {
			const result = segment.lookup(key);
			if (result.found && result.entry) {
				return result.entry.kind === "delete" ? undefined : result.entry.value ?? undefined;
			}
		}

		return undefined;
	}

	getWithTrace(key: string): object {
		const trace: object[] = [];
		const memoryEntry = this.memtable.get(key);

		// Expose the read path so demos can show where work is avoided.
		if (memoryEntry) {
			return {
				status: memoryEntry.kind === "delete" ? "deleted" : "found",
				value: memoryEntry.kind === "delete" ? null : memoryEntry.value,
				trace: [{ place: "memtable", entry: memoryEntry }],
			};
		}

		for (const segment of this.segments) {
			const result = segment.lookup(key);
			trace.push({ place: segment.id, ...result });

			if (result.found && result.entry) {
				return {
					status: result.entry.kind === "delete" ? "deleted" : "found",
					value: result.entry.kind === "delete" ? null : result.entry.value,
					trace,
				};
			}
		}

		return { status: "missing", value: null, trace };
	}

	flush(): SSTableSegment | undefined {
		if (this.memtable.size === 0) {
			return undefined;
		}

		// Freeze the sorted memtable into a new immutable segment.
		const id = `segment-${String(this.nextSeq).padStart(4, "0")}`;
		const segment = SSTableSegment.create(this.segmentDirectory, id, this.memtable.values(), this.blockSize);
		this.segments.unshift(segment);
		this.memtable.clear();
		this.wal.truncate();
		return segment;
	}

	recoverMemtableFromWal(): void {
		this.memtable.clear();

		// Replay only unflushed writes to reconstruct the mutable memtable.
		for (const { entry } of this.wal.scan()) {
			this.memtable.set(entry.key, entry);
			this.nextSeq = Math.max(this.nextSeq, entry.seq + 1);
		}
	}

	compactAll(): SSTableSegment | undefined {
		if (this.segments.length <= 1) {
			return this.segments[0];
		}

		const latest = new Map<string, LogEntry>();

		// Merge newest to oldest so overwritten values are discarded.
		for (const segment of this.segments) {
			for (const entry of segment.entries()) {
				if (!latest.has(entry.key)) {
					latest.set(entry.key, entry);
				}
			}
		}

		const survivors = [...latest.values()].filter((entry) => entry.kind !== "delete");
		const id = `compacted-${String(this.nextSeq).padStart(4, "0")}`;
		const compacted = SSTableSegment.create(this.segmentDirectory, id, survivors, this.blockSize);

		// Atomically switch the logical read set, then clean up obsolete inputs.
		const oldSegments = [...this.segments];
		this.segments.splice(0, this.segments.length, compacted);
		for (const segment of oldSegments) {
			segment.deleteFiles();
		}

		return compacted;
	}

	snapshot(): object {
		return {
			memtable: sortedEntries(this.memtable.values()),
			segments: this.segments.map((segment) => segment.snapshot()),
			wal: this.wal.scan(),
		};
	}

	private write(entry: LogEntry): void {
		// Persist to the WAL before exposing the write in memory.
		this.wal.append(entry);
		this.memtable.set(entry.key, entry);

		if (this.memtable.size >= this.memtableLimit) {
			this.flush();
		}
	}
}
