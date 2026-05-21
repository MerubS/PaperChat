import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'PaperChat - AI Research Assistant',
  description: 'Chat with your research papers using AI',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}