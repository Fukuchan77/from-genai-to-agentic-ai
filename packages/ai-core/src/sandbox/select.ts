import { DEFAULT_SANDBOX } from "../config/defaults";

/** What a probe of the local Docker Engine found (`probeDockerSocket`, 17.6). */
export interface DockerProbeResult {
	/** The Engine answered on a socket. */
	readonly reachable: boolean;
	/** The sandbox image exists locally (an image can be built only with Docker reachable). */
	readonly imagePresent: boolean;
}

export type SandboxSelection =
	| { readonly kind: "e2b" }
	| { readonly kind: "docker" }
	| { readonly kind: "disabled"; readonly reason: string; readonly guidance: string };

export interface SelectSandboxParams {
	readonly env: {
		readonly E2B_API_KEY?: string | undefined;
		readonly DOCKER_SANDBOX_IMAGE?: string | undefined;
	};
	readonly dockerProbe: DockerProbeResult;
}

const BUILD_TASK = "mise run sandbox:build";

/**
 * Picks where generated code runs (Req 3.8): the E2B key first, then the local container, and
 * otherwise nothing. The result never contains the key. A pure function of its inputs.
 */
export function selectSandboxProvider({ env, dockerProbe }: SelectSandboxParams): SandboxSelection {
	if (env.E2B_API_KEY?.trim()) return { kind: "e2b" };

	const image = env.DOCKER_SANDBOX_IMAGE?.trim() || DEFAULT_SANDBOX.image;
	if (dockerProbe.reachable && dockerProbe.imagePresent) return { kind: "docker" };

	if (dockerProbe.reachable) {
		return {
			kind: "disabled",
			reason: `E2B_API_KEY が未設定で、ローカルのコンテナ用の画像（${image}）もありません。`,
			guidance: `画像を作るには \`${BUILD_TASK}\` を実行してください。または E2B_API_KEY を設定してください。`,
		};
	}
	return {
		kind: "disabled",
		reason: "E2B_API_KEY が未設定で、ローカルのコンテナ実行環境（Docker）にも接続できません。",
		guidance: `E2B_API_KEY を設定するか、Docker を起動して \`${BUILD_TASK}\` で画像（${image}）を作ってください。`,
	};
}
