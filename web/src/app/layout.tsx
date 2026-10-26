import './globals.css';
import type { Metadata, Viewport } from 'next';
import { RegisterSW } from '@/components/RegisterSW';

export const metadata: Metadata = { title: 'Stratify | Fleet insurance workspace', description: 'White-label fleet insurance portal.', appleWebApp: { capable: true, title: 'Stratify', statusBarStyle: 'default' }, icons: { icon: [{ url: '/icon-192.png', sizes: '192x192' }, { url: '/icon-512.png', sizes: '512x512' }], apple: '/apple-touch-icon.png' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#142e28' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}<RegisterSW /></body>
    </html>
  );
}
