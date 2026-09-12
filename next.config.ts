import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  output: 'standalone', // Docker copies .next/standalone (Task 11)
};

export default nextConfig;
