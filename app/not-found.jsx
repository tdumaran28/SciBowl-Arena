import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Atom, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <Atom className="w-10 h-10 text-primary" />
        </div>
        <h1 className="text-5xl font-bold mb-2">404</h1>
        <p className="text-xl font-medium mb-2">Page Not Found</p>
        <p className="text-muted-foreground mb-8">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
        <Link href="/">
          <Button>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
