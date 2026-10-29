import { PlatformError } from "../errors";

const MAX_NAME_BYTES = 100;

/**
 * `SandboxSession.writeFile` takes a plain file name, placed in the directory the code runs in.
 * Every provider applies this one rule, so a path that the mock accepts is accepted by the
 * real sandboxes too (and nothing can name a place outside the working directory).
 */
export function assertSandboxFileName(name: string): void {
	const bytes = new TextEncoder().encode(name).length;
	if (
		name === "" ||
		name === "." ||
		name === ".." ||
		/[/\\\0]/.test(name) ||
		bytes > MAX_NAME_BYTES
	) {
		throw new PlatformError(
			"invalid-request",
			"サンドボックスに書き込むファイル名が不正です（ディレクトリを含まない 100 バイト以内の名前にしてください）。",
		);
	}
}
