import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactCompiler: true,
	typedRoutes: true,
	// PGlite reads its WASM and the pgvector tarball relative to its own files. Bundled into the
	// Server Component layer (the /rag page reads the knowledge base), Turbopack turns that tarball
	// into a client asset URL and "Extension bundle not found" fails the page; the Route Handlers
	// happened to work. Loading the packages from node_modules in every layer fixes both.
	serverExternalPackages: [
		"jsdom",
		"youtubei.js",
		"@electric-sql/pglite",
		"@electric-sql/pglite-pgvector",
	],
};

export default nextConfig;
