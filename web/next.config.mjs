/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Server actions only accept requests from our own origins.
    serverActions: { bodySizeLimit: '4.5mb', allowedOrigins: ['stratifyfleet.co.uk', 'www.stratifyfleet.co.uk'] }
  }
};
export default nextConfig;
