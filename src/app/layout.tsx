import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Sans_Thai, IBM_Plex_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans-thai',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'นับตังค์ - Nubtang | จัดการรายรับ-รายจ่าย & บันทึกสลิปอัตโนมัติ',
  description: 'ระบบบันทึกรายรับ-รายจ่าย เชื่อมต่อ Google Sheets และซิงค์สลิปจาก Google Drive อัตโนมัติด้วย AI',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="th"
      suppressHydrationWarning
      className={`h-full dark ${ibmPlexSans.variable} ${ibmPlexSansThai.variable} ${ibmPlexMono.variable}`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink font-sans antialiased selection:bg-accent-soft selection:text-accent-text">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
