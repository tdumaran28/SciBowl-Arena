import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Flag, Check, X, Clock } from 'lucide-react';

// A standing "shall we end the marathon?" request.
//
// A marathon has no last question, so it needs some way to be stopped — and the
// obvious one, a host button, is precisely the unilateral power the rest of the
// match controls were taken away from. So it is a request the room agrees to:
// everyone still playing has to accept, and one decline drops it.
//
// The card is shown to everybody, because a vote nobody can see is a vote
// nobody answers — the requester gets the tally and a way out, everyone else
// gets the two buttons.
export default function EndMarathonVote({
  vote,
  players = [],
  myPlayerId,
  windowMs = 60_000,
  onAccept,
  onDecline,
  onWithdraw,
  onLapsed,
}) {
  const requestedAt = vote?.requested_at || 0;
  const declinedBy = vote?.declined_by || null;
  const [remaining, setRemaining] = useState(null);

  // A request that nobody answers has to go away on its own, or it sits over
  // the game forever. Every client counts down and any of them may report it;
  // the server checks the timestamp, so a report racing an accept does nothing.
  const reportedRef = useRef(0);
  useEffect(() => {
    if (!requestedAt || declinedBy) return;
    const tick = () => {
      const left = Math.max(0, requestedAt + windowMs - Date.now());
      setRemaining(Math.ceil(left / 1000));
      // Reported once per request, not once a second until the frame clearing
      // it comes back — every client in the room is running this timer.
      if (left === 0 && reportedRef.current !== requestedAt) {
        reportedRef.current = requestedAt;
        onLapsed?.();
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [requestedAt, windowMs, declinedBy, onLapsed]);

  if (!vote) return null;

  const accepted = vote.accepted || [];
  const mine = vote.requested_by === myPlayerId;
  const iAccepted = accepted.includes(myPlayerId);
  const waitingOn = players.filter(p => !accepted.includes(p.user_id));

  if (declinedBy) {
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-4 flex items-start gap-3">
        <X className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-sm">
            <span className="text-foreground">{declinedBy}</span> wants to keep playing
          </p>
          <p className="text-sm text-muted-foreground">The marathon carries on.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onWithdraw}>Dismiss</Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Flag className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">
            {mine
              ? 'You asked to end the marathon'
              : <><span className="text-foreground">{vote.requested_by_name}</span> wants to end the marathon</>}
          </p>
          <p className="text-sm text-muted-foreground">
            {waitingOn.length === 0
              ? 'Everyone has agreed — finishing up…'
              : `Everyone has to agree. Waiting on ${waitingOn.map(p => p.display_name).join(', ')}.`}
          </p>
        </div>
        {remaining != null && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums flex-shrink-0">
            <Clock className="w-3 h-3" />{remaining}s
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {players.map(p => (
          <Badge
            key={p.user_id}
            variant="outline"
            className={accepted.includes(p.user_id)
              ? 'text-xs border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
              : 'text-xs text-muted-foreground'}
          >
            {accepted.includes(p.user_id) && <Check className="w-3 h-3 mr-1" />}
            {p.display_name}
          </Badge>
        ))}
      </div>

      {/* The requester has already agreed by asking, so they get a way to take
          it back rather than a second vote. Someone who has accepted and
          changed their mind DECLINES — withdrawing is the requester's alone,
          and declining is what actually stops the vote. */}
      {mine ? (
        <Button variant="outline" size="sm" className="w-full" onClick={onWithdraw}>
          Withdraw the request
        </Button>
      ) : iAccepted ? (
        <Button variant="outline" size="sm" className="w-full" onClick={onDecline}>
          Changed my mind — keep playing
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={onAccept}>
            <Check className="w-3.5 h-3.5 mr-1" /> End the marathon
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={onDecline}>
            <X className="w-3.5 h-3.5 mr-1" /> Keep playing
          </Button>
        </div>
      )}
    </div>
  );
}
