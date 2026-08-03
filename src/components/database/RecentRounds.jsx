import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Eye, Play, Clock, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { SUBJECT_COLORS, sortRoundsByNumber } from '@/utils/parseRound';
import { motion } from 'framer-motion';

function StatusDot({ status }) {
  if (status === 'success') return <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />;
  if (status === 'error') return <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />;
  if (status === 'processing') return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin flex-shrink-0" />;
  return null;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

export default function RecentRounds({ rounds, onPreview }) {
  const recent = sortRoundsByNumber(rounds).slice(0, 8);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Rounds</h2>
        <Badge variant="secondary" className="text-xs ml-auto">{recent.length}</Badge>
      </div>
      <div className="space-y-2.5">
        {recent.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No rounds available
            </CardContent>
          </Card>
        ) : (
          recent.map((round, i) => (
            <motion.div
              key={round.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Card className="border-border/60 hover:shadow-md transition-shadow">
                <CardContent className="p-3.5">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <FileText className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-semibold text-sm truncate flex-1">{round.title}</h3>
                        <StatusDot status={round.parse_status} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {round.source || 'Unknown source'} · {round.year || '—'} · {round.question_count || 0} Q
                      </p>

                      <div className="flex flex-wrap gap-1 mt-2">
                        {Array.from(new Set((round.questions || []).map(q => q.subject).filter(Boolean)))
                          .slice(0, 4)
                          .map(subj => (
                            <Badge key={subj} variant="secondary" className={`text-[10px] px-1.5 py-0 ${SUBJECT_COLORS[subj] || ''}`}>
                              {subj}
                            </Badge>
                          ))}
                      </div>
                      <div className="flex gap-1.5 mt-2.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => onPreview(round)} disabled={round.parse_status !== 'success'}>
                          <Eye className="w-3 h-3 mr-1" /> Preview
                        </Button>
                        <Link href={`/play?roundId=${round.id}`} className="flex-1">
                          <Button size="sm" className="w-full h-7 text-xs" disabled={round.parse_status !== 'success'}>
                            <Play className="w-3 h-3 mr-1" /> Play
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}