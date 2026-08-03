import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Folder, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import RoundCard from './RoundCard';
import { sortRoundsByNumber } from '@/utils/parseRound';

export default function SourceBrowser({ rounds, onPreview, onEdit, onDelete, onToggleVisibility }) {
  // Group by source, then by year
  const bySource = rounds.reduce((acc, r) => {
    const src = r.source?.trim() || 'Uncategorized';
    if (!acc[src]) acc[src] = [];
    acc[src].push(r);
    return acc;
  }, {});
  const sources = Object.keys(bySource).sort();

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Folder className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Browse by Source</h2>
        <Badge variant="secondary" className="text-xs ml-auto">{sources.length} sources</Badge>
      </div>
      <div className="space-y-1.5">
        {sources.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground border border-dashed rounded-lg">
            No sources available
          </div>
        ) : (
          sources.map(src => (
            <SourceGroup
              key={src}
              sourceName={src}
              rounds={bySource[src]}
              onPreview={onPreview}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleVisibility={onToggleVisibility}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SourceGroup({ sourceName, rounds, onPreview, onEdit, onDelete, onToggleVisibility }) {
  const [open, setOpen] = useState(false);
  const totalQuestions = rounds.reduce((s, r) => s + (r.question_count || 0), 0);

  // Group this source's rounds by year
  const byYear = rounds.reduce((acc, r) => {
    const yr = r.year?.trim() || 'Unknown year';
    if (!acc[yr]) acc[yr] = [];
    acc[yr].push(r);
    return acc;
  }, {});
  const years = Object.keys(byYear).sort((a, b) => {
    if (a === 'Unknown year') return 1;
    if (b === 'Unknown year') return -1;
    return b.localeCompare(a);
  });

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden bg-card">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3.5 py-3 hover:bg-accent/40 transition-colors text-left"
      >
        {open
          ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
        <Folder className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="font-semibold text-sm truncate flex-1">{sourceName}</span>
        <Badge variant="secondary" className="text-xs">{rounds.length}</Badge>
        <span className="text-xs text-muted-foreground hidden sm:inline">{totalQuestions} Q</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5 pt-1 space-y-1.5 border-t border-border/40">
              {years.map(yr => (
                <YearGroup
                  key={yr}
                  yearName={yr}
                  rounds={byYear[yr]}
                  onPreview={onPreview}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggleVisibility={onToggleVisibility}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function YearGroup({ yearName, rounds, onPreview, onEdit, onDelete, onToggleVisibility }) {
  const [open, setOpen] = useState(false);
  const totalQuestions = rounds.reduce((s, r) => s + (r.question_count || 0), 0);

  return (
    <div className="rounded-md bg-muted/30">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-accent/40 transition-colors text-left rounded-md"
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
        <Calendar className="w-3.5 h-3.5 text-accent flex-shrink-0" />
        <span className="font-medium text-sm truncate flex-1">{yearName}</span>
        <Badge variant="outline" className="text-xs">{rounds.length}</Badge>
        <span className="text-xs text-muted-foreground hidden sm:inline">{totalQuestions} Q</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 pt-1.5">
              {sortRoundsByNumber(rounds).map(round => (
                <RoundCard
                  key={round.id}
                  round={round}
                  onPreview={onPreview}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onToggleVisibility={onToggleVisibility}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}