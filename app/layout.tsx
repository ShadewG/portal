import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "COMMAND CENTER",
  description: "Unified portal for all services",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      <script async id="insanity-workspace" src="https://portal.insanity.team/workspace/shell.js?v=1" data-app="portal"></script>
</body>
    </html>
  );
}
