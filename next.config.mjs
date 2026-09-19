/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel function region pinned to Mumbai (ARCHITECTURE.md §3.1). Note that a
  // Mumbai function region is not the same thing as the certified India data
  // residency §16 requires — see the compliance note in the README.
  env: {},

  experimental: {
    /*
     * pdfjs is loaded on the server to read a policy's text layer. Bundled by
     * Next it breaks: the library resolves its own worker and font files at
     * runtime by path, and a bundler rewrites those paths. Left external it is
     * required from node_modules as an ordinary Node module and works.
     */
    serverComponentsExternalPackages: ['pdfjs-dist'],
  },
};

export default nextConfig;
