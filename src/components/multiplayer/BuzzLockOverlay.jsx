import { Lock, Zap } from 'lucide-react';

// Shown to players who are NOT the one buzzing / answering bonus
export default function BuzzLockOverlay({ buzzState, myTeam, myPlayerId = null }) {
  if (!buzzState) return null;

  // A pending buzz is a claim that has reached the server but not yet cleared
  // arbitration. It locks the room exactly like a settled buzz — that early
  // lock is the point — so it names the same way, and only the display name can
  // still change if someone else turns out to have buzzed first.
  const pending = !buzzState.result && !buzzState.dead ? buzzState.pending_buzz : null;
  const buzzer = buzzState.buzzed_player_id
    ? { name: buzzState.buzzed_display_name }
    : pending ? { name: pending.display_name } : null;

  // Free-for-all rooms have no teams, so a bonus is owned by a player and
  // `bonus_for_team` is empty. Keying the lock on the team alone meant that in
  // every no-teams game the players shut out of someone else's bonus got a
  // dead buzzer and nothing on screen telling them why.
  const bonusOwner = buzzState.bonus_for_team || buzzState.bonus_for_player || null;
  const isBonusLock = !!bonusOwner && !buzzer;
  const isAnsweringLock = buzzer && !buzzState.result;

  if (isAnsweringLock) {
    return (
      <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
          <Lock className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <p className="font-semibold text-amber-700 dark:text-amber-300">Question Locked</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{buzzer.name}</span> is answering…
          </p>
        </div>
      </div>
    );
  }

  if (isBonusLock) {
    const isMyTeamBonus = buzzState.bonus_for_team
      ? buzzState.bonus_for_team === myTeam
      : buzzState.bonus_for_player_id === myPlayerId;
    return (
      <div className={`rounded-xl border p-4 flex items-center gap-3 ${
        isMyTeamBonus
          ? 'border-primary/40 bg-primary/5'
          : 'border-amber-400/40 bg-amber-500/10'
      }`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
          isMyTeamBonus ? 'bg-primary/20' : 'bg-amber-500/20'
        }`}>
          <Zap className={`w-5 h-5 ${isMyTeamBonus ? 'text-primary' : 'text-amber-500'}`} />
        </div>
        <div>
          <p className={`font-semibold ${isMyTeamBonus ? 'text-primary' : 'text-amber-700 dark:text-amber-300'}`}>
            {isMyTeamBonus
              ? (buzzState.bonus_for_team ? "Your team's bonus!" : 'Your bonus!')
              : 'Bonus Locked'}
          </p>
          <p className="text-sm text-muted-foreground">
            Bonus for {buzzState.bonus_for_team ? 'team ' : ''}
            <span className="font-medium text-foreground">{bonusOwner}</span>
          </p>
        </div>
      </div>
    );
  }

  return null;
}