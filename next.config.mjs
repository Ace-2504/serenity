/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true
  },
  // The reports used to live at /bi, and briefly the shop at /shop; old links keep working.
  async redirects() {
    return [
      { source: "/bi", destination: "/admin/erp", permanent: false },
      { source: "/bi/customers/:path*", destination: "/admin/crm/customers/:path*", permanent: false },
      { source: "/bi/campaigns/:path*", destination: "/admin/crm/campaigns/:path*", permanent: false },
      { source: "/bi/:path*", destination: "/admin/erp/:path*", permanent: false },
      { source: "/shop", destination: "/", permanent: false },
      { source: "/signup", destination: "/admin/login", permanent: false },
      { source: "/privacy", destination: "/admin/erp/data", permanent: false }
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com"
      }
    ]
  }
};

export default nextConfig;