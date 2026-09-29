import type { SuiteFactory, TestContext, TestFunction } from "vitest";
import { beforeEach, describe, inject, it } from "vitest";

export interface LocalAvailability {
	available: boolean;
	reason: string | null;
}

interface LocalTestRegistrar {
	describe(name: string, factory: SuiteFactory): void;
	it(name: string, test: TestFunction): void;
	beforeEach(hook: (context: TestContext) => unknown): void;
}

export interface LocalTestApi {
	describeLocal(name: string, factory: SuiteFactory): void;
	itLocal(name: string, test: TestFunction): void;
}

declare module "vitest" {
	export interface ProvidedContext {
		localAvailability: LocalAvailability;
	}
}

function unavailableReason(availability: LocalAvailability): string {
	return availability.reason ?? "Local model is unavailable.";
}

/** Builds local-only registration helpers; exported for deterministic contract tests. */
export function createLocalTestApi(
	availability: LocalAvailability,
	registrar: LocalTestRegistrar,
): LocalTestApi {
	return {
		describeLocal(name, factory) {
			registrar.describe(name, (suite) => {
				if (!availability.available) {
					registrar.beforeEach((context) => context.skip(unavailableReason(availability)));
				}
				return factory(suite);
			});
		},
		itLocal(name, test) {
			registrar.it(name, (context) => {
				if (!availability.available) context.skip(unavailableReason(availability));
				return test(context);
			});
		},
	};
}

const localApi = createLocalTestApi(inject("localAvailability"), {
	describe: (name, factory) => describe(name, factory),
	it: (name, test) => it(name, (context) => test(context)),
	beforeEach: (hook) => beforeEach((context) => hook(context)),
});

export const describeLocal = localApi.describeLocal;
export const itLocal = localApi.itLocal;
