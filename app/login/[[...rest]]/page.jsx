'use client';

import { SignIn } from '@clerk/nextjs';
import { Atom } from 'lucide-react';

// Clerk's SignIn component handles email/password, social providers enabled in
// the Clerk dashboard, and the full "forgot password" flow.
export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-8">
      <div className="flex items-center gap-2">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
          <Atom className="w-6 h-6 text-primary-foreground" />
        </div>
        <span className="text-xl font-bold tracking-tight">
          SciBowl <span className="text-primary">Arena</span>
        </span>
      </div>
      <SignIn path="/login" signUpUrl="/register" fallbackRedirectUrl="/" />
    </div>
  );
}
