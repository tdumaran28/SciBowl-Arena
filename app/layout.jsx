import { ClerkProvider } from '@clerk/nextjs';
import { Inter, JetBrains_Mono } from 'next/font/google';
import Providers from './providers';
import '@/index.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

// The tab icon comes from the file convention: app/icon.png. Next hashes and
// serves it automatically — don't add an `icons` field here, it would override
// the file.
export const metadata = {
  title: 'SciBowl Arena',
  description: 'Upload Science Bowl packets, practice solo, and compete with teammates.',
};

// Shown until Clerk is configured, instead of a blank crash.
function ClerkSetupNotice() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-lg bg-card border border-border rounded-2xl p-8 space-y-3">
        <h1 className="text-xl font-bold">Authentication not configured</h1>
        <p className="text-sm text-muted-foreground">
          SciBowl Arena uses <strong>Clerk</strong> for sign-in. Create a free application
          at <code className="bg-muted px-1 rounded">clerk.com</code>, then add to
          <code className="bg-muted px-1 rounded mx-1">.env.local</code>:
        </p>
        <pre className="bg-muted rounded-lg p-3 text-xs overflow-x-auto">
{`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...`}
        </pre>
        <p className="text-sm text-muted-foreground">
          Then restart <code className="bg-muted px-1 rounded">npm run dev</code>.
          See the README for full setup steps.
        </p>
      </div>
    </div>
  );
}

export default function RootLayout({ children }) {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  // Applies the saved theme before first paint so dark mode doesn't flash
  // and hydration sees the final <html> class.
  const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetBrainsMono.variable} font-inter`}>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {clerkConfigured ? (
          <ClerkProvider afterSignOutUrl="/login">
            <Providers>{children}</Providers>
          </ClerkProvider>
        ) : (
          <ClerkSetupNotice />
        )}
      </body>
    </html>
  );
}
