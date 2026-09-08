import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: process.env.GITHUB_ACTIONS === "true" ? "/biketour" : "",
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
