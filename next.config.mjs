import { contentSecurityPolicy } from "./lib/providers.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Offline, the browser is forbidden from contacting anything but this server.
  // The policy (and the online/offline toggle behind it) lives in lib/providers.js.
  async headers() {
    if (!contentSecurityPolicy) return [];
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] }];
  },
};

export default nextConfig;
