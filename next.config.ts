import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in a parent directory would otherwise be picked as the workspace root.
  turbopack: { root: __dirname },
  // PGlite loads its WASM and data files from node_modules at runtime, so it must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Migrations are read from disk at boot, so serverless bundles must include them.
  outputFileTracingIncludes: { "/**": ["./drizzle/**"] },
  async headers() {
    return [{ source: "/s/:token", headers: [{ key: "X-Robots-Tag", value: "noindex" }] }];
  },
};

export default nextConfig;
