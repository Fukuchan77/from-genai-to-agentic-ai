const HEADER_BYTES = 8;
const STDIN = 0;
const STDOUT = 1;
const STDERR = 2;
const SYSTEM_ERROR = 3;

const DEFAULT_MAX_BYTES_PER_STREAM = 16 * 1024 * 1024;

export interface DemuxedOutput {
	readonly stdout: string;
	readonly stderr: string;
	/** Learner-facing notes about output that was cut, skipped or dropped. Empty for a clean stream. */
	readonly warnings: readonly string[];
}

export interface DemuxOptions {
	/** Bytes kept per stream; the rest is dropped with a warning. Default 16 MiB. */
	readonly maxBytesPerStream?: number;
}

/**
 * Splits Docker's multiplexed log stream (a container created without a TTY) into stdout and
 * stderr. Each frame is an 8-byte header — stream type, three zero bytes, a big-endian length —
 * and the payload. A stream that ends early still yields what was read, plus a warning.
 */
export function demuxDockerStream(bytes: Uint8Array, options: DemuxOptions = {}): DemuxedOutput {
	const limit = options.maxBytesPerStream ?? DEFAULT_MAX_BYTES_PER_STREAM;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunks: { stdout: Uint8Array[]; stderr: Uint8Array[] } = { stdout: [], stderr: [] };
	const sizes = { stdout: 0, stderr: 0 };
	const capped = { stdout: false, stderr: false };
	const warnings: string[] = [];
	let unknownTypes = 0;

	function keep(stream: "stdout" | "stderr", payload: Uint8Array): void {
		const room = limit - sizes[stream];
		if (payload.length > room) capped[stream] = true;
		const part = payload.subarray(0, Math.max(0, room));
		if (part.length === 0) return;
		chunks[stream].push(part);
		sizes[stream] += part.length;
	}

	let offset = 0;
	while (offset < bytes.length) {
		if (bytes.length - offset < HEADER_BYTES) {
			warnings.push("ログが途中で切れました（フレームのヘッダが不完全です）。");
			break;
		}
		const type = bytes[offset] ?? 0;
		const length = view.getUint32(offset + 4, false);
		const start = offset + HEADER_BYTES;
		const available = Math.min(length, bytes.length - start);
		const payload = bytes.subarray(start, start + available);

		if (type === STDOUT) keep("stdout", payload);
		else if (type === STDERR || type === SYSTEM_ERROR) keep("stderr", payload);
		else if (type !== STDIN) unknownTypes += 1;

		if (available < length) {
			warnings.push("ログが途中で切れました（最後のフレームの本文が足りません）。");
			break;
		}
		offset = start + length;
	}

	if (unknownTypes > 0) warnings.push(`未知の種別のログ ${unknownTypes} 件を読み飛ばしました。`);
	if (capped.stdout) warnings.push("標準出力が上限を超えたため、超えた分を切り捨てました。");
	if (capped.stderr) warnings.push("標準エラー出力が上限を超えたため、超えた分を切り捨てました。");

	const decode = (parts: Uint8Array[]) => {
		const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
		let at = 0;
		for (const part of parts) {
			joined.set(part, at);
			at += part.length;
		}
		return new TextDecoder().decode(joined);
	};
	return { stdout: decode(chunks.stdout), stderr: decode(chunks.stderr), warnings };
}
