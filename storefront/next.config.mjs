/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    // Cloudflare R2 public bucket + S3-compatible API.
    // Add additional CDN/origin hostnames here as the project grows.
    remotePatterns: [
      { protocol: 'https', hostname: 'pub-*.r2.dev' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: 'cdn.shopify.com' }, // for Stripe-hosted line item images, etc.
    ],
  },
};
export default config;
