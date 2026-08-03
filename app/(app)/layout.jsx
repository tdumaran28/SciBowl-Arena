'use client';

// Protected shell: gates on Clerk auth (redirects signed-out visitors to
// /login) and wraps every app page in the sidebar layout.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import Layout from '@/components/Layout';
import { Loader2 } from 'lucide-react';

export default function AppLayout({ children }) {
  const { isAuthenticated, isLoadingAuth, authChecked } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authChecked && !isAuthenticated) {
      router.replace('/login');
    }
  }, [authChecked, isAuthenticated, router]);

  if (isLoadingAuth || !authChecked || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return <Layout>{children}</Layout>;
}
