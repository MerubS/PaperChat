/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdf-parse'],
  webpack: (config) => {
    // pdf.js has an optional Node-only "canvas" dependency the browser viewer doesn't need
    config.resolve.alias.canvas = false;
    return config;
  },
}

module.exports = nextConfig
