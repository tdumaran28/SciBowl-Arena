'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Atom, LayoutDashboard, BookOpen, Play, Users,
  FileText, User, HelpCircle, LogOut, Menu, X, Sun, Moon,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/database', label: 'Round Library', icon: BookOpen },
  // Marathon isn't its own tab: Solo Play and Multiplayer each offer round
  // practice or marathon when starting a session.
  { to: '/play', label: 'Solo Play', icon: Play },
  { to: '/multiplayer', label: 'Multiplayer', icon: Users },
  { to: '/pdf', label: 'PDF Viewer', icon: FileText },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/help', label: 'Help', icon: HelpCircle },
];

// The root layout applies the saved theme to <html> before first paint; this
// hook syncs with that after mount (reading localStorage during render would
// make the server and client HTML disagree and break hydration).
function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
  const toggle = (next) => {
    setDark(prev => {
      const value = typeof next === 'function' ? next(prev) : next;
      document.documentElement.classList.toggle('dark', value);
      localStorage.setItem('theme', value ? 'dark' : 'light');
      return value;
    });
  };
  return [dark, toggle];
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useDarkMode();

  const handleLogout = () => {
    logout(true); // Clerk signs out and redirects to /login
  };

  const sidebar = (
    <div className="flex flex-col h-full bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))]">
      {/* Brand */}
      <Link
        href="/"
        onClick={() => setMobileOpen(false)}
        className="flex items-center gap-2.5 px-5 h-16 border-b border-[hsl(var(--sidebar-border))]"
      >
        <div className="w-8 h-8 rounded-lg bg-[hsl(var(--sidebar-primary))] flex items-center justify-center flex-shrink-0">
          <Atom className="w-5 h-5 text-[hsl(var(--sidebar-primary-foreground))]" />
        </div>
        <span className="font-bold tracking-tight text-[hsl(var(--sidebar-accent-foreground))]">
          SciBowl <span className="text-[hsl(var(--sidebar-primary))]">Arena</span>
        </span>
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => {
          const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
          return (
            <Link
              key={to}
              href={to}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]'
                  : 'hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-[hsl(var(--sidebar-border))] p-3 space-y-1">
        <button
          onClick={() => setDark(d => !d)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full transition-colors hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-[hsl(var(--sidebar-primary))]/20 flex items-center justify-center text-xs font-bold text-[hsl(var(--sidebar-primary))] flex-shrink-0">
            {(user?.full_name || user?.email || '?')[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate text-[hsl(var(--sidebar-accent-foreground))]">
              {user?.full_name || user?.email?.split('@')[0] || 'Player'}
            </p>
            <p className="text-xs truncate opacity-60">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            title="Log out"
            className="p-1.5 rounded-md transition-colors hover:bg-[hsl(var(--sidebar-accent))] hover:text-destructive"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 z-30">
        {sidebar}
      </aside>

      {/* Mobile header */}
      <header className="lg:hidden sticky top-0 z-40 h-14 bg-card/95 backdrop-blur border-b border-border flex items-center gap-3 px-4">
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
          <Menu className="w-5 h-5" />
        </Button>
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <Atom className="w-4 h-4 text-primary-foreground" />
          </div>
          SciBowl <span className="text-primary">Arena</span>
        </Link>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">
            {sidebar}
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 p-1.5 rounded-md text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="lg:pl-60 min-h-screen">
        {children}
      </main>
    </div>
  );
}
