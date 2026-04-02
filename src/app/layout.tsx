import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ayadi Glocal School - Voice Assistant",
  description: "The Future of Learning. Interactive Voice Assistant for Ayadi Glocal School.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
