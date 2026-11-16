import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Study Planner AI",
  description: "Scan textbook pages into instant study notes and quizzes",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#222222] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
