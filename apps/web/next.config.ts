import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { SECURITY_HEADERS } from "./src/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  transpilePackages: ["@ecapital/shared"],
  // Every path, pages and route handlers alike (security-headers.ts).
  headers: async () => [{ source: "/(.*)", headers: [...SECURITY_HEADERS] }],
};

export default withNextIntl(nextConfig);
