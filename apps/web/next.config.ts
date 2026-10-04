import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactCompiler: true,
	typedRoutes: true,
	serverExternalPackages: ["jsdom", "youtubei.js"],
};

export default nextConfig;
