import type { Metadata } from 'next';
import '@/styles/plum.css';

export const metadata: Metadata = {
  title: 'Rollover Quote Management',
  description: 'Internal quote management for rollover deals.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
