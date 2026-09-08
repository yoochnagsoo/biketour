import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: process.env.NODE_ENV === "production" ? "/biketour" : "",
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
