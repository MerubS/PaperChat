/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  // Production builds are a static site (out/) served from S3 + CloudFront.
  // CloudFront routes /api/* to the Python backend on Lambda.
  ...(isProd ? { output: 'export' } : {}),
  // Local dev: forward /api/* to the backend (uvicorn on :8000, see "Run locally" in README.md)
  ...(!isProd
    ? {
        async rewrites() {
          return [{ source: '/api/:path*', destination: `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/:path*` }];
        },
      }
    : {}),
  webpack: (config) => {
    // pdf.js has an optional Node-only "canvas" dependency the browser viewer doesn't need
    config.resolve.alias.canvas = false;
    return config;
  },
};

module.exports = nextConfig;
