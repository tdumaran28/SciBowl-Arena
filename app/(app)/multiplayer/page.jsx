'use client';

// The view is a fully client-driven page (timers, speech, window APIs), so it
// is loaded client-only to skip server prerendering entirely.
import dynamic from 'next/dynamic';

const Multiplayer = dynamic(() => import('@/views/Multiplayer'), { ssr: false });

export default function Page() {
  return <Multiplayer />;
}
