import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
	createYoutubeiTranscriptSource,
	type TranscriptSource,
	TranscriptSourceError,
} from "./transcript";

function transcriptClient() {
	return {
		getInfo: vi.fn().mockResolvedValue({
			basic_info: { title: "A useful video", is_private: false },
			getTranscript: vi.fn().mockResolvedValue({
				selectedLanguage: "English",
				transcript: {
					content: {
						body: {
							initial_segments: [
								{ start_ms: "0", end_ms: "0", snippet: { text: "Chapter" } },
								{
									target_id: "segment-1",
									start_ms: "1500",
									end_ms: "3200",
									snippet: { text: "First point" },
								},
								{
									target_id: "segment-2",
									start_ms: "3200",
									end_ms: "5000",
									snippet: { text: "Second" },
								},
							],
						},
					},
				},
			}),
		}),
	};
}

function circularInfo() {
	const info: Record<string, unknown> = { status: "ERROR" };
	info.self = info;
	return info;
}

function transcriptWith(content: unknown) {
	return {
		getInfo: vi.fn().mockResolvedValue({
			basic_info: {},
			getTranscript: vi.fn().mockResolvedValue({ transcript: { content } }),
		}),
	};
}

describe("createYoutubeiTranscriptSource", () => {
	it("maps youtubei transcript segments to timestamped text", async () => {
		const client = transcriptClient();
		const source = createYoutubeiTranscriptSource({ createClient: async () => client });

		await expect(source.fetchTranscript("video-1")).resolves.toEqual({
			videoId: "video-1",
			title: "A useful video",
			language: "English",
			segments: [
				{ text: "First point", startSeconds: 1.5, durationSeconds: 1.7 },
				{ text: "Second", startSeconds: 3.2, durationSeconds: 1.8 },
			],
		});
		expectTypeOf(source).toMatchTypeOf<TranscriptSource>();
	});

	it.each([
		["no-captions", new Error("Transcript panel not found. Video likely has no transcript.")],
		["private", new Error("This video is private")],
		["fetch-failed", new Error("socket closed")],
		["fetch-failed", new Error("Failed to fetch transcript: socket hang up")],
		[
			"private",
			Object.assign(new Error("Playability error"), {
				info: { status: "LOGIN_REQUIRED", reason: "This video is private" },
			}),
		],
		["fetch-failed", new Error("LOGIN_REQUIRED: Sign in to confirm your age")],
		[
			"fetch-failed",
			new TypeError(
				"Cannot read private member #page from an object whose class did not declare it",
			),
		],
		["fetch-failed", Object.assign(new Error("Parser error"), { info: circularInfo() })],
	] as const)("maps youtubei failures to %s", async (reason, cause) => {
		const source = createYoutubeiTranscriptSource({
			createClient: async () => ({ getInfo: vi.fn().mockRejectedValue(cause) }),
		});

		const promise = source.fetchTranscript("video-2");
		await expect(promise).rejects.toMatchObject({ reason, code: "source-unavailable" });
		await expect(promise).rejects.toBeInstanceOf(TranscriptSourceError);
	});

	it.each([
		["metadata", { basic_info: { is_private: "no" }, getTranscript: vi.fn() }],
		[
			"segment timing",
			{
				basic_info: {},
				getTranscript: vi.fn().mockResolvedValue({
					transcript: {
						content: {
							body: {
								initial_segments: [
									{ target_id: "s", start_ms: 1500, end_ms: "3200", snippet: { text: "x" } },
								],
							},
						},
					},
				}),
			},
		],
		[
			"empty segment start",
			{
				basic_info: {},
				getTranscript: vi.fn().mockResolvedValue({
					transcript: {
						content: {
							body: {
								initial_segments: [
									{ target_id: "s", start_ms: "", end_ms: "1000", snippet: { text: "x" } },
								],
							},
						},
					},
				}),
			},
		],
		[
			"inverted segment timing",
			{
				basic_info: {},
				getTranscript: vi.fn().mockResolvedValue({
					transcript: {
						content: {
							body: {
								initial_segments: [
									{ target_id: "s", start_ms: "3000", end_ms: "1000", snippet: { text: "x" } },
								],
							},
						},
					},
				}),
			},
		],
		[
			"segment snippet",
			{
				basic_info: {},
				getTranscript: vi.fn().mockResolvedValue({
					transcript: {
						content: {
							body: {
								initial_segments: [
									{ target_id: "s", start_ms: "0", end_ms: "1000", snippet: { text: 42 } },
								],
							},
						},
					},
				}),
			},
		],
	] as const)("rejects malformed youtubei %s as fetch-failed", async (_part, info) => {
		const source = createYoutubeiTranscriptSource({
			createClient: async () => ({ getInfo: vi.fn().mockResolvedValue(info) }),
		});

		await expect(source.fetchTranscript("malformed")).rejects.toMatchObject({
			reason: "fetch-failed",
			code: "source-unavailable",
		});
	});

	it("rejects with the caller abort reason instead of a transcript failure", async () => {
		const source = createYoutubeiTranscriptSource({
			createClient: async () => ({ getInfo: vi.fn(() => new Promise<never>(() => {})) }),
		});
		const controller = new AbortController();
		const result = source.fetchTranscript("slow-video", controller.signal);

		controller.abort(new DOMException("Stopped", "AbortError"));
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		await expect(result).rejects.not.toBeInstanceOf(TranscriptSourceError);
	});

	it.each([
		["no transcript panel content", null],
		["no segment list", { body: null }],
		["an empty segment list", { body: { initial_segments: [] } }],
		[
			"only section headers",
			{ body: { initial_segments: [{ start_ms: "0", end_ms: "0", snippet: { text: "Intro" } }] } },
		],
	])("maps %s to no-captions", async (_case, content) => {
		const source = createYoutubeiTranscriptSource({
			createClient: async () => transcriptWith(content),
		});

		await expect(source.fetchTranscript("silent-video")).rejects.toMatchObject({
			reason: "no-captions",
		});
	});

	it.each(["This video is private", "Private video"])(
		"classifies the private playability reason %j before requesting the transcript",
		async (reason) => {
			const getTranscript = vi.fn();
			const source = createYoutubeiTranscriptSource({
				createClient: async () => ({
					getInfo: vi.fn().mockResolvedValue({
						basic_info: {},
						playability_status: { status: "LOGIN_REQUIRED", reason },
						getTranscript,
					}),
				}),
			});

			await expect(source.fetchTranscript("private-video")).rejects.toMatchObject({
				reason: "private",
			});
			expect(getTranscript).not.toHaveBeenCalled();
		},
	);

	it("retries client creation after a failed attempt", async () => {
		const createClient = vi
			.fn<() => Promise<ReturnType<typeof transcriptClient>>>()
			.mockRejectedValueOnce(new Error("session bootstrap failed"))
			.mockResolvedValue(transcriptClient());
		const source = createYoutubeiTranscriptSource({ createClient });

		await expect(source.fetchTranscript("video-1")).rejects.toMatchObject({
			reason: "fetch-failed",
		});
		await expect(source.fetchTranscript("video-1")).resolves.toMatchObject({ videoId: "video-1" });
		expect(createClient).toHaveBeenCalledTimes(2);
	});

	it("classifies private video metadata before requesting the transcript", async () => {
		const getTranscript = vi.fn();
		const source = createYoutubeiTranscriptSource({
			createClient: async () => ({
				getInfo: vi.fn().mockResolvedValue({
					basic_info: { title: "Private video", is_private: true },
					getTranscript,
				}),
			}),
		});

		await expect(source.fetchTranscript("private-video")).rejects.toMatchObject({
			reason: "private",
		});
		expect(getTranscript).not.toHaveBeenCalled();
	});
});
