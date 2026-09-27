/**
 * In-memory CLI I/O for tests: the same shape `runIfMain` passes to a script's `main`, with the
 * written text readable back through `stdoutText()` / `stderrText()`.
 */
export function memoryIo({ argv = [], cwd = "/", stdin = "" } = {}) {
	const written = { stderr: "", stdout: "" };
	const stream = (name) => ({
		write(chunk) {
			written[name] += String(chunk);
			return true;
		},
	});
	return {
		argv,
		cwd,
		readStdin: () => stdin,
		stderr: stream("stderr"),
		stderrText: () => written.stderr,
		stdout: stream("stdout"),
		stdoutText: () => written.stdout,
	};
}
