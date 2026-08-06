import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Crown, LogOut, Users, Trophy, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import QuestionReviewDialog from '@/components/game/QuestionReviewDialog';

// Combined Teams + scores + points log + leave-game, shown during a match.
//
// `getQuestion(index)` resolves a logged event back to its question so players
// can reread one mid-match. Only past questions are reachable: an event only
// exists once the question has been answered, and the live one is filtered out
// below so nobody can open the answer to the question being read.
// `getLabel(index)` resolves a logged event to its pair-numbered position
// ("1.T", "1.B") — the same numbering the reader shows, so the log reads as the
// packet is written rather than as a flat question count.
export default function MatchSidePanel({ session, myPlayerId, onLeave, getQuestion = null, getLabel = null, powers = false }) {
  const players = session?.players || [];
  const teams = session?.teams || [];
  const hostId = session?.host_id;
  const events = session?.question_results || [];
  const myTeam = players.find(p => p.user_id === myPlayerId)?.team;
  const currentIndex = session?.current_question_index ?? -1;
  const [reviewEvent, setReviewEvent] = useState(null);

  return (
    <div className="space-y-3">
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Teams
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {teams.map(team => {
            const members = players.filter(p => p.team === team.name);
            const isMyTeam = team.name === myTeam;
            return (
              <div key={team.name} className={cn('rounded-lg p-2.5', isMyTeam ? 'bg-primary/5 border border-primary/20' : 'bg-muted/30')}>
                <div className="flex items-center justify-between mb-1">
                  <span className={cn('font-semibold text-sm', isMyTeam && 'text-primary')}>{team.name}</span>
                  <Badge variant="secondary" className="font-bold">{team.score || 0} pts</Badge>
                </div>
                <div className="space-y-0.5">
                  {members.map(p => (
                    <div key={p.user_id} className="flex items-center gap-1.5 text-xs">
                      <span className={p.user_id === myPlayerId ? 'font-semibold text-primary' : ''}>{p.display_name}</span>
                      {p.user_id === team.captain_id && <Crown className="w-3 h-3 text-amber-500" />}
                      {p.user_id === hostId && <Badge variant="outline" className="text-[10px] px-1 py-0">Host</Badge>}
                    </div>
                  ))}
                  {members.length === 0 && <p className="text-xs text-muted-foreground italic">No members</p>}
                </div>
              </div>
            );
          })}
          {teams.length === 0 && <p className="text-xs text-muted-foreground">No teams yet.</p>}
          <Button variant="outline" size="sm" className="w-full text-destructive hover:text-destructive" onClick={onLeave}>
            <LogOut className="w-3.5 h-3.5 mr-1" /> Leave Game
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" /> Points Log
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 max-h-72 overflow-y-auto">
          {events.length === 0 && <p className="text-xs text-muted-foreground">No events yet.</p>}
          {events.length > 0 && getQuestion && (
            <p className="text-[10px] text-muted-foreground/70 pb-1">Click an entry to review that question</p>
          )}
          {[...events].reverse().map((ev, i) => {
            const tone = ev.kind === 'correct'
              ? 'text-emerald-600 dark:text-emerald-400'
              : ev.kind === 'neg'
                ? 'text-red-600 dark:text-red-400'
                : 'text-slate-500';
            const ptsStr = (ev.points > 0 ? '+' : '') + ev.points;
            // The question currently being read stays closed — opening it would
            // hand the reader its answer.
            const reviewable = getQuestion && ev.question_index != null && ev.question_index !== currentIndex;
            const positionLabel = getLabel?.(ev.question_index);
            const body = (
              <>
                <Badge variant="outline" className="text-[10px] px-1.5 flex-shrink-0 tabular-nums">
                  {positionLabel ?? ev.type}
                </Badge>
                <span className="flex-1 truncate text-left">
                  {ev.player} <span className="text-muted-foreground">· {ev.team || '—'}</span>
                </span>
                {reviewable && <Eye className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors flex-shrink-0" />}
                <span className={cn('font-bold tabular-nums flex-shrink-0', tone)}>{ptsStr}</span>
              </>
            );

            if (!reviewable) {
              return <div key={i} className="flex items-center gap-2 text-xs">{body}</div>;
            }
            return (
              <button
                key={i}
                type="button"
                onClick={() => setReviewEvent(ev)}
                className="w-full flex items-center gap-2 text-xs py-1 px-1 -mx-1 rounded hover:bg-muted/60 transition-colors group"
              >
                {body}
              </button>
            );
          })}
        </CardContent>
      </Card>

      {getQuestion && (
        <QuestionReviewDialog
          open={reviewEvent !== null}
          onOpenChange={(v) => !v && setReviewEvent(null)}
          question={reviewEvent ? getQuestion(reviewEvent.question_index) : null}
          questionNumber={reviewEvent ? reviewEvent.question_index + 1 : null}
          questionLabel={reviewEvent ? getLabel?.(reviewEvent.question_index) : null}
          entry={reviewEvent ? { ...reviewEvent, result: reviewEvent.kind } : null}
          powers={powers}
        />
      )}
    </div>
  );
}