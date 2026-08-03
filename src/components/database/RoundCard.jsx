import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import Link from 'next/link';
import { Eye, Play, Pencil, Trash2, Atom, FileText, Globe, Lock, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { SUBJECT_COLORS } from '@/utils/parseRound';
import { motion } from 'framer-motion';
import { useRoundPermissions } from './RoundPermissions';

function StatusBadge({ status }) {
  if (status === 'success') return <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
  if (status === 'error') return <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />;
  if (status === 'processing') return <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />;
  return null;
}

function getSubjectCounts(questions = []) {
  const counts = {};
  questions.forEach(q => {
    const s = q.subject || 'General Science';
    counts[s] = (counts[s] || 0) + 1;
  });
  return Object.entries(counts).sort(([, a], [, b]) => b - a);
}

export default function RoundCard({ round, onPreview, onEdit, onDelete, onToggleVisibility }) {
  // The server enforces these (server/rounds.js); this only keeps the UI from
  // offering actions that would be rejected.
  const { canManage, canPublish, isPublic, isMine } = useRoundPermissions(round);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
    >
      <Card className="border-border/60 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 h-full">
        <CardContent className="p-5">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Atom className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm truncate">{round.title}</h3>
              <p className="text-xs text-muted-foreground">{round.source || 'Unknown source'} · {round.year || '—'}</p>
            </div>
            <StatusBadge status={round.parse_status} />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <FileText className="w-3 h-3" />
            <span>{round.question_count || 0} questions</span>
            <span>·</span>
            <span className="uppercase">{round.file_type || 'pdf'}</span>
          </div>

          {/* Subject tags — show ALL subjects */}
          <div className="flex flex-wrap gap-1 mb-4">
            {getSubjectCounts(round.questions).map(([subj]) => (
              <Badge key={subj} variant="secondary" className={`text-xs ${SUBJECT_COLORS[subj] || ''}`}>
                {subj}
              </Badge>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-3">
            {canPublish ? (
              <>
                <Switch
                  checked={isPublic}
                  onCheckedChange={() => onToggleVisibility(round)}
                  id={`pub-${round.id}`}
                />
                <label htmlFor={`pub-${round.id}`} className="text-xs text-muted-foreground flex items-center gap-1 cursor-pointer select-none">
                  {isPublic ? <><Globe className="w-3 h-3" /> Public</> : <><Lock className="w-3 h-3" /> Private</>}
                </label>
              </>
            ) : (
              <Badge variant="outline" className="text-xs font-normal">
                {isPublic
                  ? <><Globe className="w-3 h-3 mr-1" /> Public</>
                  : <><Lock className="w-3 h-3 mr-1" /> {isMine ? 'Private — only you' : 'Private'}</>}
              </Badge>
            )}
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => onPreview(round)} disabled={round.parse_status !== 'success'}>
              <Eye className="w-3 h-3 mr-1" /> Preview
            </Button>
            <Link href={`/play?roundId=${round.id}`} className="flex-1">
              <Button size="sm" className="w-full text-xs" disabled={round.parse_status !== 'success'}>
                <Play className="w-3 h-3 mr-1" /> Play
              </Button>
            </Link>
            {canManage && (
              <>
                <Button size="sm" variant="outline" className="px-2" onClick={() => onEdit(round)}>
                  <Pencil className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 px-2" onClick={() => onDelete(round)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}