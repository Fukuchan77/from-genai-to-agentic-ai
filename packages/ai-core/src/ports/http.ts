export type FetchInit = RequestInit;

export interface HttpResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
}

export interface HttpFetcher {
	fetch(url: string, init?: FetchInit): Promise<HttpResponse>;
}

export function createNodeHttpFetcher(
	fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): HttpFetcher {
	return {
		async fetch(url, init) {
			const response = await fetchImplementation(url, init);
			return {
				status: response.status,
				headers: Object.fromEntries(response.headers.entries()),
				body: await response.text(),
			};
		},
	};
}
