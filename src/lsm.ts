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
