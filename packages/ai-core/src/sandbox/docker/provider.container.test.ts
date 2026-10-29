import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_OUTPUT_LIMITS, parseSandboxOutput } from "../../analysis/output-parser";
import { ANALYSIS_HELPERS_FILE, analysisPrelude, helpersImportLine } from "../../analysis/prelude";
import { describeContainer } from "../../testing/container-only";
import type { DockerEngine } from "./engine";
import { createDockerEngine } from "./engine";
import { createDockerProvider, type DockerLimits } from "./provider";

// Runs the Docker provider against a real Docker Engine and the real sandbox image
// (`mise run sandbox:build`, then `mise run test:container`). It is the only place where the
// isolation properties are observed rather than configured: what the code inside can and cannot do.
// Without Docker or the image, every test here is skipped with the reason (`describeContainer`).

const SAMPLE = readFileSync(
	path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
		"..",
		"..",
		"fixtures",
		"sandbox",
		"sample-analysis.py",
	),
	"utf8",
);
const CSV = "month,sales\n2026-01,120000\n2026-01,5000\n2026-02,98000\n2026-03,134000\n";
const RUN = { timeoutMs: 60_000 };
const TEST_TIMEOUT = 90_000;

/** Every container the provider created, so the last test can check they are all gone. */
const createdContainers: string[] = [];

/** The ids of the containers (running or not) that carry the sandbox label. */
function containersWithLabel(socketPath: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const filters = encodeURIComponent('{"label":["agentic-ai.sandbox=1"]}');
		const request = http.request(
			{ socketPath, path: `/v1.44/containers/json?all=1&filters=${filters}` },
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () => {
					const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { Id: string }[];
					resolve(body.map((container) => container.Id));
				});
			},
		);
		request.on("error", reject);
		request.end();
	});
}

/** The number of volumes no container uses (a leaked anonymous volume would raise it). */
function danglingVolumeCount(socketPath: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const request = http.request(
			{
				socketPath,
				path: `/v1.44/volumes?filters=${encodeURIComponent('{"dangling":["true"]}')}`,
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () => {
					const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
						Volumes: unknown[] | null;
					};
					resolve(body.Volumes?.length ?? 0);
				});
			},
		);
		request.on("error", reject);
		request.end();
	});
}

describeContainer("the Docker sandbox on a real engine", (availability) => {
	function setup(limits?: Partial<DockerLimits>) {
		const { socketPath, image } = availability();
		const real = createDockerEngine({ socketPath: socketPath as string });
		const created: string[] = [];
		const engine: DockerEngine = {
			...real,
			async createContainer(spec) {
				const id = await real.createContainer(spec);
				created.push(id);
				createdContainers.push(id);
				return id;
			},
		};
		const provider = createDockerProvider({ engine, image, ...(limits ? { limits } : {}) });
		return { engine: real, provider, created, socketPath: socketPath as string };
	}

	async function run(code: string, limits?: Partial<DockerLimits>, timeoutMs = 60_000) {
		const { provider } = setup(limits);
		const session = await provider.create({ timeoutMs: 600_000 });
		try {
			return await session.runPython(code, { timeoutMs });
		} finally {
			await session.close();
		}
	}

	it(
		"runs the sample analysis on an uploaded file and prints the PNG and table marker lines",
		async () => {
			const { provider } = setup();
			const session = await provider.create({ timeoutMs: 600_000 });
			await session.writeFile("data.csv", new TextEncoder().encode(CSV));

			const result = await session.runPython(SAMPLE, RUN);
			await session.close();

			expect(result.error).toBeUndefined();
			expect(result.stderr).toBe("");
			const lines = result.stdout.split("\n");
			const png = lines.find((line) => line.startsWith("__PNG__:"));
			const table = lines.find((line) => line.startsWith("__TABLE__:"));
			expect(png).toBeDefined();
			expect(table).toBeDefined();
			const figure = JSON.parse((png as string).slice("__PNG__:".length)) as {
				alt: string;
				base64: string;
			};
			expect(Buffer.from(figure.base64, "base64").subarray(0, 8)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);
			expect(figure.alt).toContain("月別売上");
			const parsed = JSON.parse((table as string).slice("__TABLE__:".length)) as {
				columns: string[];
				rows: [string, number][];
				totalRows: number;
			};
			expect(parsed.columns).toEqual(["month", "sales"]);
			expect(parsed.rows).toEqual([
				["2026-01", 125000],
				["2026-02", 98000],
				["2026-03", 134000],
			]);
			expect(lines).toContain("rows: 4");
		},
		TEST_TIMEOUT,
	);

	it(
		"runs the analysis helpers: show_figure and show_table become one figure and one table the parser accepts",
		async () => {
			const { provider } = setup();
			const session = await provider.create({ timeoutMs: 600_000 });
			await session.writeFile("data.csv", new TextEncoder().encode(CSV));
			await session.writeFile(ANALYSIS_HELPERS_FILE, new TextEncoder().encode(analysisPrelude));
			const code = [
				helpersImportLine(),
				"import pandas as pd",
				"import matplotlib.pyplot as plt",
				'df = pd.read_csv("data.csv")',
				'monthly = df.groupby("month", as_index=False)["sales"].sum()',
				'plt.bar(monthly["month"], monthly["sales"])',
				'plt.title("月別売上")',
				'show_figure("月別売上の棒グラフ")',
				'print("open figures:", len(plt.get_fignums()))',
				'extra = pd.DataFrame({"name": ["a", None, "c"], "value": [1.5, float("nan"), float("inf")], "when": pd.to_datetime(["2026-01-01", None, "2026-03-01"])})',
				'show_table(extra, "NaN と NaT と inf を含む表")',
				'show_table(pd.DataFrame({"n": range(300)}), "300 行")',
				'print("done")',
			].join("\n");

			const result = await session.runPython(code, RUN);
			await session.close();

			expect(result.error).toBeUndefined();
			expect(result.stderr).toBe("");
			const parsed = parseSandboxOutput(result.stdout, DEFAULT_OUTPUT_LIMITS);
			expect(parsed.rejected).toEqual([]);
			// show_figure closes the figure it drew, so figures do not pile up in a long session.
			expect(parsed.text).toBe("open figures: 0\ndone\n");
			expect(parsed.figures).toHaveLength(1);
			expect(parsed.figures[0]?.alt).toBe("月別売上の棒グラフ");
			expect(parsed.tables).toHaveLength(2);
			expect(parsed.tables[0]).toEqual({
				caption: "NaN と NaT と inf を含む表",
				columns: ["name", "value", "when"],
				rows: [
					["a", 1.5, "2026-01-01 00:00:00"],
					[null, null, null],
					["c", null, "2026-03-01 00:00:00"],
				],
				totalRows: 3,
			});
			expect(parsed.tables[1]?.rows).toHaveLength(200);
			expect(parsed.tables[1]?.totalRows).toBe(300);
			// The helper itself stops at 200 rows, so a big frame does not flood stdout.
			const rawTable =
				result.stdout.split("\n").filter((line) => line.startsWith("__TABLE__:"))[1] ?? "";
			expect(
				(JSON.parse(rawTable.slice("__TABLE__:".length)) as { rows: unknown[] }).rows,
			).toHaveLength(200);
		},
		TEST_TIMEOUT,
	);

	it(
		"hands binary files over byte for byte and places every file next to the code",
		async () => {
			const { provider } = setup();
			const session = await provider.create({ timeoutMs: 600_000 });
			await session.writeFile("blob.bin", new Uint8Array([0, 255, 10, 13, 128]));
			await session.writeFile("notes.txt", new TextEncoder().encode("メモ"));

			const result = await session.runPython(
				'import os\nprint(sorted(os.listdir("/work")))\nprint(open("blob.bin", "rb").read().hex())\nprint(open("notes.txt", encoding="utf-8").read())',
				RUN,
			);
			await session.close();

			expect(result.error).toBeUndefined();
			expect(result.stdout).toBe(
				"['_sandbox_main.py', 'blob.bin', 'notes.txt']\n00ff0a0d80\nメモ\n",
			);
		},
		TEST_TIMEOUT,
	);

	it(
		"keeps the files for a second run, in a fresh process",
		async () => {
			const { provider } = setup();
			const session = await provider.create({ timeoutMs: 600_000 });
			await session.writeFile("data.csv", new TextEncoder().encode(CSV));

			const first = await session.runPython('x = 41\nprint(len(open("data.csv").read()))', RUN);
			const second = await session.runPython("print(x)", RUN);
			const third = await session.runPython('print(len(open("data.csv").read()))', RUN);
			await session.close();

			expect(first.error).toBeUndefined();
			// No state survives between runs (each run is its own container), but the files do.
			expect(second.error?.name).toBe("NameError");
			expect(third.stdout).toBe(first.stdout);
		},
		TEST_TIMEOUT,
	);

	it(
		"reports a Python exception as the run's error",
		async () => {
			const result = await run('print("before")\nraise KeyError("revenue")');

			expect(result.stdout).toBe("before\n");
			expect(result.error).toMatchObject({ name: "KeyError", message: "'revenue'" });
			expect(result.error?.traceback).toContain("Traceback (most recent call last):");
			expect(result.stderr).toContain("KeyError: 'revenue'");
		},
		TEST_TIMEOUT,
	);

	it(
		"returns a megabyte of output intact",
		async () => {
			const result = await run('print("x" * 1_000_000)');

			expect(result.error).toBeUndefined();
			expect(result.stdout.length).toBe(1_000_001);
		},
		TEST_TIMEOUT,
	);

	describe("isolation, as observed from inside", () => {
		it(
			"has no network: neither a connection nor a name lookup works",
			async () => {
				const result = await run(
					[
						"import socket",
						"try:",
						'    socket.create_connection(("1.1.1.1", 80), timeout=3)',
						'    print("CONNECTED")',
						"except OSError as error:",
						'    print("CONNECT-BLOCKED", type(error).__name__)',
						"try:",
						'    socket.getaddrinfo("example.com", 80)',
						'    print("RESOLVED")',
						"except OSError as error:",
						'    print("LOOKUP-BLOCKED", type(error).__name__)',
					].join("\n"),
				);

				expect(result.error).toBeUndefined();
				expect(result.stdout).toContain("CONNECT-BLOCKED");
				expect(result.stdout).toContain("LOOKUP-BLOCKED");
				expect(result.stdout).not.toContain("CONNECTED\n");
				expect(result.stdout).not.toContain("RESOLVED");
			},
			TEST_TIMEOUT,
		);

		it(
			"has a read-only root; only /tmp is writable, and not /work",
			async () => {
				const result = await run(
					[
						"import errno",
						'for target in ["/etc/pwned", "/usr/local/pwned", "/work/pwned"]:',
						"    try:",
						'        open(target, "w").write("x")',
						'        print("WROTE", target)',
						"    except OSError as error:",
						'        print("DENIED", target, errno.errorcode[error.errno])',
						'open("/tmp/ok", "w").write("x")',
						'print("TMP-OK")',
					].join("\n"),
				);

				expect(result.error).toBeUndefined();
				expect(result.stdout).toContain("DENIED /etc/pwned EROFS");
				expect(result.stdout).toContain("DENIED /usr/local/pwned EROFS");
				expect(result.stdout).toContain("DENIED /work/pwned");
				expect(result.stdout).toContain("TMP-OK");
				expect(result.stdout).not.toContain("WROTE");
			},
			TEST_TIMEOUT,
		);

		it(
			"runs as a non-root user with no capabilities and no new privileges",
			async () => {
				const result = await run(
					[
						"import os",
						"print('uid', os.getuid(), os.geteuid())",
						'status = dict(line.split(":\\t", 1) for line in open("/proc/self/status").read().splitlines() if ":\\t" in line)',
						"print('CapEff', status['CapEff'])",
						"print('CapBnd', status['CapBnd'])",
						"print('NoNewPrivs', status['NoNewPrivs'])",
					].join("\n"),
				);

				expect(result.stdout).toContain("uid 10001 10001");
				expect(result.stdout).toContain("CapEff 0000000000000000");
				// The bounding set is empty too, so the code cannot gain a capability later.
				expect(result.stdout).toContain("CapBnd 0000000000000000");
				expect(result.stdout).toContain("NoNewPrivs 1");
			},
			TEST_TIMEOUT,
		);

		it(
			"limits the number of processes",
			async () => {
				const result = await run(
					[
						"import subprocess",
						"procs = []",
						"try:",
						"    for _ in range(64):",
						'        procs.append(subprocess.Popen(["sleep", "30"]))',
						'    print("SPAWNED", len(procs))',
						"except OSError as error:",
						'    print("LIMITED", type(error).__name__)',
						"finally:",
						"    for proc in procs:",
						"        proc.kill()",
					].join("\n"),
					{ pidsLimit: 16 },
				);

				expect(result.stdout).toContain("LIMITED");
				expect(result.stdout).not.toContain("SPAWNED");
			},
			TEST_TIMEOUT,
		);

		it(
			"kills code that outgrows the memory limit, and says so",
			async () => {
				const result = await run('data = b"x" * (512 * 1024 * 1024)\nprint(len(data))', {
					memoryBytes: 128 * 1024 * 1024,
				});

				expect(result.error).toBeDefined();
				expect(["Killed", "MemoryError"]).toContain(result.error?.name);
				expect(result.stdout).not.toContain("536870912");
			},
			TEST_TIMEOUT,
		);
	});

	it(
		"stops code that runs too long, keeps what it printed, and removes the container",
		async () => {
			const started = Date.now();
			const result = await run(
				'import time\nprint("started", flush=True)\ntime.sleep(120)',
				undefined,
				3_000,
			);

			expect(Date.now() - started).toBeLessThan(30_000);
			expect(result.stdout).toBe("started\n");
			expect(result.error?.name).toBe("TimeoutError");
		},
		TEST_TIMEOUT,
	);

	it(
		"removes the container, and its volume, as soon as the run ends, before the session is closed",
		async () => {
			const { provider, engine, created, socketPath } = setup();
			const volumesBefore = await danglingVolumeCount(socketPath);
			const session = await provider.create({ timeoutMs: 600_000 });
			await session.writeFile("data.csv", new TextEncoder().encode(CSV));

			await session.runPython('print(open("data.csv").read()[:5])', RUN);
			await session.runPython("raise ValueError('x')", RUN);

			// The session is still open: nothing but the runs' own cleanup removed these.
			expect(created).toHaveLength(2);
			for (const id of created) {
				await expect(engine.logs(id)).rejects.toMatchObject({ code: "provider-unavailable" });
			}
			expect(await danglingVolumeCount(socketPath)).toBeLessThanOrEqual(volumesBefore);
			await session.close();
		},
		TEST_TIMEOUT,
	);

	it(
		"survives code that floods its output: the run ends at the timeout, the output read is bounded, and the container is labelled",
		async () => {
			const started = Date.now();
			const result = await run(
				'import sys\nwhile True:\n    sys.stdout.write("x" * 100000)',
				undefined,
				4_000,
			);

			expect(Date.now() - started).toBeLessThan(40_000);
			expect(result.error?.name).toBe("TimeoutError");
			// The daemon keeps at most 16m of it, and the provider reads at most 16 MiB.
			expect(result.stdout.length).toBeLessThanOrEqual(16 * 1024 * 1024 + 1024);
			expect(result.stdout.length).toBeGreaterThan(0);
		},
		TEST_TIMEOUT,
	);

	it(
		"labels its containers, so leftovers can be found by the label",
		async () => {
			const { provider, engine, created } = setup();
			const session = await provider.create({ timeoutMs: 600_000 });
			const running = session.runPython("import time\ntime.sleep(5)", RUN);
			await vi.waitFor(() => expect(created).toHaveLength(1), { timeout: 20_000 });

			const labelled = await containersWithLabel(setup().socketPath);
			await running;
			await session.close();

			expect(labelled).toContain(created[0]);
			expect(engine).toBeDefined();
		},
		TEST_TIMEOUT,
	);

	describe("afterwards", () => {
		afterAll(() => {
			createdContainers.length = 0;
		});

		it(
			"left no container behind: every container created above is gone",
			async () => {
				const { engine } = setup();
				// The earlier tests created at least one container for each run.
				expect(createdContainers.length).toBeGreaterThanOrEqual(10);

				for (const id of createdContainers) {
					await expect(
						engine.logs(id),
						`container ${id} should have been removed`,
					).rejects.toMatchObject({
						code: "provider-unavailable",
					});
				}
			},
			TEST_TIMEOUT,
		);
	});
});

describe("the container suite itself", () => {
	it("is registered under the container suffix only, so the gate never runs it", () => {
		expect(import.meta.url.endsWith(".container.test.ts")).toBe(true);
	});
});
