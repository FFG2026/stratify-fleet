import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = { title: 'Stratify | Fleet insurance workspace', description: 'White-label fleet insurance portal.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#142e28' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
