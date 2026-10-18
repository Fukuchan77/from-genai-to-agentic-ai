// Entry point of the file server: `node stdio.ts` runs it under Node's type stripping, with no
// loader or extra dependency (CL-3). stdout carries the protocol, so every message goes to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createFilesServer, resolveServerRoot } from "./server.ts";

// The default equals `DEFAULT_MCP_FS_ROOT`; a relative value is resolved against the working directory.
const resolved = await resolveServerRoot(process.env.MCP_FS_ROOT || "workspace/");
if (!resolved.ok) {
	process.stderr.write(`${resolved.message}\n`);
	process.exit(1);
}

await createFilesServer({ root: resolved.root }).connect(new StdioServerTransport());
