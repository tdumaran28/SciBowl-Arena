import { Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Physical cover over the answer area. Shown whenever the answer is not yet
 * revealable for the CURRENT question. Acts as a hard visual backup: even if
 * stale render state tries to paint the answer during a question transition,
 * this overlay sits on top and blocks it.
 */
export default function AnswerCover({ visible, label = 'Answer hidden' }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-card/97 backdrop-blur-sm border border-dashed border-border pointer-events-none"
        >
          <div className="flex items-center justify-center text-muted-foreground/80">
            <Lock className="w-5 h-5" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}