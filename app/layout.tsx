import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '诗游中国 · 山水诗文地图',
  description: '从立体山水地图出发，探索全国景点与有出处的古诗词星河。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
