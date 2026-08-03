'use client';

// Thin wrapper over Clerk that preserves the app's existing useAuth()
// interface (user, isAuthenticated, isLoadingAuth, logout, ...). Must be
// rendered inside <ClerkProvider>.
import React, { createContext, useContext, useEffect } from 'react';
import { useAuth as useClerkAuth, useUser, useClerk } from '@clerk/nextjs';
import { setAuthTokenGetter } from '@/api/base44Client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();

  // Give the API client access to fresh Clerk session tokens.
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  const user = clerkUser
    ? {
        id: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress || '',
        full_name: clerkUser.fullName || clerkUser.username || clerkUser.primaryEmailAddress?.emailAddress?.split('@')[0] || 'Player',
      }
    : null;

  const logout = (shouldRedirect = true) => {
    signOut(shouldRedirect ? { redirectUrl: '/login' } : undefined);
  };

  const navigateToLogin = () => {
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!isSignedIn,
      isLoadingAuth: !isLoaded,
      isLoadingPublicSettings: false, // kept for compatibility with consumers
      authError: null,
      authChecked: isLoaded,
      logout,
      navigateToLogin,
      checkUserAuth: () => {},
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
