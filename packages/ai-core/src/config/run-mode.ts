import { z } from "zod";
import type { RunMode } from "../models/types";
import type { EnvSource } from "./env-schema";

const runModeSchema = z.enum(["mock", "local", "live"]);

function presentValue(value: string | undefined): string | undefined {
	return value === "" ? undefined : value;
}

export function resolveRunMode(env: EnvSource): RunMode {
	if (env.VITEST !== undefined) {
		return runModeSchema.parse(presentValue(env.AI_TEST_RUN_MODE) ?? "mock");
	}
	return runModeSchema.parse(presentValue(env.AI_RUN_MODE) ?? "local");
}
