import { useState } from 'react';
import Link from 'next/link';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Play, Database, Users, Upload, FileJson, Zap, CheckCircle2,
  XCircle, Hash, BookOpen, ChevronDown, ChevronUp, Atom, Trophy, Settings,
  Brain, Target, BarChart2, Star
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_HELP_CONTENT, assembleHelpContent } from '@/content/helpContent';

// The page renders structured content loaded from the HelpContent entity
// (Supabase `help_content` table), falling back to the bundled default in
// src/content/helpContent.js. Edit the stored copy via the entities API or
// refresh it from the default with: npm run seed:help
//
// Content is stored one row per part (header / each section / cta) and
// reassembled here by assembleHelpContent — see src/content/helpContent.js.

const ICONS = {
  Play, Database, Users, Upload, FileJson, Zap, CheckCircle2, XCircle, Hash,
  BookOpen, Atom, Trophy, Settings, Brain, Target, BarChart2, Star,
};

function Icon({ name, className }) {
  const Cmp = ICONS[name] || BookOpen;
  return <Cmp className={className} />;
}

/** Inline markup: **bold** and `code`. */
function Inline({ text }) {
  const parts = String(text ?? '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i} className="text-foreground">{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith('`') && p.endsWith('`')) {
      return <code key={i} className="bg-muted text-foreground px-1 rounded text-xs font-mono">{p.slice(1, -1)}</code>;
    }
    return p;
  });
}

function FAQItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left bg-card hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-sm font-medium text-foreground">{question}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-4 py-3 text-sm text-muted-foreground border-t border-border bg-muted/20 leading-relaxed">
          <Inline text={answer} />
        </div>
      )}
    </div>
  );
}

const INFO_STYLES = {
  blue: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300',
  amber: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300',
  violet: 'border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 text-violet-800 dark:text-violet-300',
  emerald: 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300',
};

const POINT_TONES = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-destructive',
  muted: 'text-muted-foreground',
};

const TILE_TONES = {
  good: { box: 'bg-emerald-500/10 border-emerald-500/20', value: 'text-emerald-600 dark:text-emerald-400' },
  bad: { box: 'bg-destructive/10 border-destructive/20', value: 'text-destructive' },
};

function Block({ block }) {
  switch (block.type) {
    case 'p':
      return <p className={block.small ? 'text-xs' : undefined}><Inline text={block.text} /></p>;

    case 'label':
      return <p className="font-semibold text-foreground">{block.text}</p>;

    case 'badges':
      return (
        <div className="flex flex-wrap gap-2">
          {(block.items || []).map(({ label, color }) => (
            <Badge key={label} className={cn('text-xs border-0', color)}>{label}</Badge>
          ))}
        </div>
      );

    case 'cards':
      return (
        <div className={cn('grid grid-cols-1 gap-3', block.columns === 2 && 'sm:grid-cols-2')}>
          {(block.items || []).map((item, i) => (
            <div key={i} className="rounded-lg border border-border p-4 bg-card space-y-2">
              {(item.icon || item.badge || item.title) && (
                <div className="flex items-center gap-2">
                  {item.icon && <Icon name={item.icon} className={cn('w-4 h-4 flex-shrink-0', item.iconColor)} />}
                  {item.badge && <Badge variant={item.badgeVariant || 'default'} className="text-xs">{item.badge}</Badge>}
                  {item.title && <span className={cn('font-semibold text-foreground', item.badge && 'text-xs font-medium')}>{item.title}</span>}
                </div>
              )}
              <p className="text-xs"><Inline text={item.text} /></p>
              {item.points && (
                <div className="flex gap-2 text-xs font-semibold">
                  {item.points.map((pt, j) => (
                    <span key={j} className={POINT_TONES[pt.tone] || POINT_TONES.muted}>{pt.text}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      );

    case 'grid':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {(block.items || []).map(({ title, text }) => (
            <div key={title} className="rounded-md border border-border bg-card p-2.5">
              <p className="font-medium text-foreground mb-0.5">{title}</p>
              <p className="text-muted-foreground"><Inline text={text} /></p>
            </div>
          ))}
        </div>
      );

    case 'kbds':
      return (
        <div className="flex flex-wrap gap-2 text-xs">
          {(block.items || []).map(({ key, action }) => (
            <div key={key} className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
              <kbd className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-xs font-semibold">{key}</kbd>
              <span className="text-muted-foreground">{action}</span>
            </div>
          ))}
        </div>
      );

    case 'info':
      return (
        <div className={cn('rounded-lg border p-3 text-xs leading-relaxed', INFO_STYLES[block.color] || INFO_STYLES.blue)}>
          <Inline text={block.text} />
        </div>
      );

    case 'code':
      return <pre className="bg-muted rounded-lg p-3 text-xs overflow-x-auto leading-relaxed">{block.code}</pre>;

    case 'prompt':
      return (
        <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 p-3">
          <p className="text-xs font-semibold text-violet-800 dark:text-violet-300 mb-2">{block.title}</p>
          <pre className="bg-white dark:bg-black/30 rounded-md p-3 text-xs text-violet-900 dark:text-violet-200 overflow-x-auto whitespace-pre-wrap leading-relaxed border border-violet-200 dark:border-violet-700">{block.text}</pre>
        </div>
      );

    case 'steps':
    case 'bullets': {
      const ListTag = block.type === 'steps' ? 'ol' : 'ul';
      return (
        <div className="rounded-lg border border-border p-4 bg-card">
          {block.title && (
            <div className="flex items-center gap-2 mb-2">
              {block.icon && <Icon name={block.icon} className="w-4 h-4 text-violet-500" />}
              <span className="font-semibold text-foreground">{block.title}</span>
            </div>
          )}
          <ListTag className={cn('list-inside space-y-1 text-xs', block.type === 'steps' ? 'list-decimal' : 'list-disc')}>
            {(block.items || []).map((item, i) => (
              <li key={i}><Inline text={item} /></li>
            ))}
          </ListTag>
        </div>
      );
    }

    case 'tiles':
      return (
        <div className="grid grid-cols-3 gap-2 text-xs text-center">
          {(block.items || []).map(({ value, label, tone }) => {
            const t = TILE_TONES[tone] || TILE_TONES.good;
            return (
              <div key={label} className={cn('rounded-md border p-2', t.box)}>
                <p className={cn('font-bold text-lg', t.value)}>{value}</p>
                <p className="text-muted-foreground">{label}</p>
              </div>
            );
          })}
        </div>
      );

    case 'rules':
      return (
        <div className="space-y-1.5 text-xs">
          {(block.items || []).map(({ title, text, examples }) => (
            <div key={title} className="rounded-md border border-border bg-card p-2.5">
              <p className="font-medium text-foreground mb-1">{title}</p>
              <p className="text-muted-foreground mb-1"><Inline text={text} /></p>
              {examples?.length > 0 && (
                <div className="flex flex-col gap-y-0.5 text-xs">
                  {examples.map((ex, i) => (
                    <span
                      key={i}
                      className={cn('flex items-center gap-1', ex.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}
                    >
                      {ex.ok ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" /> : <XCircle className="w-3 h-3 flex-shrink-0" />}
                      {ex.text}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      );

    case 'faq':
      return (
        <div className="space-y-3 text-sm">
          {(block.items || []).map(({ q, a }) => (
            <FAQItem key={q} question={q} answer={a} />
          ))}
        </div>
      );

    default:
      return null;
  }
}

export default function Help() {
  const { data: content } = useQuery({
    queryKey: ['help-content'],
    queryFn: async () => {
      const records = await base44.entities.HelpContent.list('position');
      return assembleHelpContent(records);
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const page = content && Array.isArray(content.sections) && content.sections.length > 0
    ? content
    : DEFAULT_HELP_CONTENT;

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{page.header?.title || 'Help & Guide'}</h1>
            <p className="text-muted-foreground text-sm">{page.header?.subtitle}</p>
          </div>
        </div>
      </div>

      {/* Quick nav */}
      <div className="flex flex-wrap gap-2 mb-8">
        {page.sections.map(({ id, icon, color, navLabel, title }) => (
          <a
            key={id}
            href={`#${id}`}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-border bg-card hover:bg-muted transition-colors"
          >
            <Icon name={icon} className={cn('w-3.5 h-3.5', color)} />
            {navLabel || title}
          </a>
        ))}
      </div>

      <div className="space-y-6">
        {page.sections.map(({ id, icon, color, bg, title, blocks }) => (
          <Card key={id} id={id} className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3 text-lg">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', bg)}>
                  <Icon name={icon} className={cn('w-4 h-4', color)} />
                </div>
                {title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
                {(blocks || []).map((block, i) => (
                  <Block key={i} block={block} />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {page.cta && (
        <div className="mt-10 rounded-xl border border-primary/20 bg-primary/5 p-6 text-center">
          <p className="font-semibold mb-1">{page.cta.title}</p>
          <p className="text-sm text-muted-foreground mb-4">{page.cta.text}</p>
          <div className="flex gap-3 justify-center flex-wrap">
            {(page.cta.buttons || []).map(({ label, href, icon, variant }) => (
              <Button key={label} variant={variant === 'outline' ? 'outline' : 'default'} asChild>
                <Link href={href}>
                  <Icon name={icon} className="w-4 h-4 mr-2" /> {label}
                </Link>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
