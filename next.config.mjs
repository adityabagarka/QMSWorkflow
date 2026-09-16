/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel function region pinned to Mumbai (ARCHITECTURE.md §3.1). Note that a
  // Mumbai function region is not the same thing as the certified India data
  // residency §16 requires — see the compliance note in the README.
  env: {},
};

export default nextConfig;
