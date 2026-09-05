import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '诗游中国 · 山水诗文地图',
  description: '从中国地图出发，探索浙江景区与有出处的古典诗文。',
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
