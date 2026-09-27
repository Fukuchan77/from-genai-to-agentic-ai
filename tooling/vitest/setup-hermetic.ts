// Vitest setup file (plan C18, Req 2.11): installs the hermetic network guard for every test file
// and fails any test that attempted an unmocked connection, even if the code under test caught
// the NetworkBlockedError. Tests that expect blocking acknowledge it with consumeBlockedConnections().
import { afterEach } from "vitest";
import {
	assertNoUnconsumedBlockedConnections,
	installHermeticNetworkGuards,
} from "./network-guard";

export {
	assertNoUnconsumedBlockedConnections,
	consumeBlockedConnections,
	DEFAULT_POSTGRES_PORT,
	installHermeticNetworkGuards,
	NetworkBlockedError,
	restoreHermeticNetworkGuards,
} from "./network-guard";

installHermeticNetworkGuards();

afterEach(() => {
	assertNoUnconsumedBlockedConnections();
});
