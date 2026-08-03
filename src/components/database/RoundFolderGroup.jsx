import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import RoundCard from './RoundCard';

export default function RoundFolderGroup({ folderName, rounds, defaultOpen = true, onPreview, onEdit, onDelete, onToggleVisibility }) {
  const [open, setOpen] = useState(defaultOpen);
  const totalQuestions = rounds.reduce((s, r) => s + (r.question_count || 0), 0);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full mb-3 group sticky top-0 bg-background/95 backdrop-blur py-2 z-10"
      >
        {open
          ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
          : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        <Folder className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm text-left">{folderName}</h3>
        <Badge variant="secondary" className="text-xs">{rounds.length}</Badge>
        <span className="text-xs text-muted-foreground ml-auto">
          {totalQuestions} questions
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            layout
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            {rounds.map(round => (
              <RoundCard
                key={round.id}
                round={round}
                onPreview={onPreview}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleVisibility={onToggleVisibility}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}