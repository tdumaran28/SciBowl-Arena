import { BookOpen, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

// Round practice vs marathon — the choice that opens both Solo Play and
// Multiplayer. Marathon used to be its own tab; folding it in here means the
// two views offer the same two ways to play instead of splitting them by page.
export default function GameKindSelect({ value, onChange, className }) {
  const options = [
    {
      id: 'round',
      icon: BookOpen,
      title: 'Round Practice',
      blurb: 'Play a specific packet start to finish',
      accent: 'text-primary',
    },
    {
      id: 'marathon',
      icon: Timer,
      title: 'Marathon',
      blurb: 'Endless questions drawn from a pool you choose',
      accent: 'text-emerald-500',
    },
  ];

  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      {options.map(({ id, icon: Icon, title, blurb, accent }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={cn(
            'rounded-lg border p-4 text-left transition-all',
            value === id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
          )}
        >
          <Icon className={cn('w-5 h-5 mb-2', accent)} />
          <p className="font-semibold text-sm">{title}</p>
          <p className="text-xs text-muted-foreground">{blurb}</p>
        </button>
      ))}
    </div>
  );
}
