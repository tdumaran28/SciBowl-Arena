import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Users, Crown, Plus, LogIn } from 'lucide-react';

// The room's whole roster, organised by team — there is no separate players
// list any more, because a player who is not on a team cannot play: the match
// will not start until every one of them has joined or made one.
export default function TeamPanel({ session, myPlayerId, onUpdateSession, hostId = null }) {
  const [newTeamName, setNewTeamName] = useState('');
  const players = session?.players || [];
  const teams = session?.teams || [];

  const myPlayer = players.find(p => p.user_id === myPlayerId);
  const myTeam = myPlayer?.team;

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;
    const name = newTeamName.trim();
    if (teams.find(t => t.name === name)) return;
    const newTeams = [...teams, { name, captain_id: myPlayerId, score: 0 }];
    const updatedPlayers = players.map(p =>
      p.user_id === myPlayerId ? { ...p, team: name } : p
    );
    await onUpdateSession({ teams: newTeams, players: updatedPlayers });
    setNewTeamName('');
  };

  const handleJoinTeam = async (teamName) => {
    const updatedPlayers = players.map(p =>
      p.user_id === myPlayerId ? { ...p, team: teamName } : p
    );
    await onUpdateSession({ players: updatedPlayers });
  };

  const handleLeaveTeam = async () => {
    const updatedPlayers = players.map(p =>
      p.user_id === myPlayerId ? { ...p, team: '' } : p
    );
    await onUpdateSession({ players: updatedPlayers });
  };

  const playersOnTeam = (teamName) => players.filter(p => p.team === teamName);
  const unassigned = players.filter(p => !p.team);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> Teams
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {teams.map(team => (
          <div key={team.name} className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-sm">{team.name}</span>
                {team.score > 0 && <Badge variant="secondary" className="text-xs">{team.score} pts</Badge>}
              </div>
              {myTeam !== team.name ? (
                <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => handleJoinTeam(team.name)}>
                  <LogIn className="w-3 h-3 mr-1" /> Join
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-muted-foreground" onClick={handleLeaveTeam}>
                  Leave
                </Button>
              )}
            </div>
            <div className="space-y-0.5">
              {playersOnTeam(team.name).map(p => (
                <div key={p.user_id} className="flex items-center gap-1.5 text-xs">
                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                    {p.display_name?.[0]?.toUpperCase()}
                  </div>
                  <span className={p.user_id === myPlayerId ? 'font-semibold text-primary' : ''}>{p.display_name}</span>
                  {p.user_id === team.captain_id && <Crown className="w-3 h-3 text-amber-500" />}
                  {p.user_id === hostId && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0">Host</Badge>
                  )}
                </div>
              ))}
              {playersOnTeam(team.name).length === 0 && (
                <p className="text-xs text-muted-foreground italic">No players yet</p>
              )}
            </div>
          </div>
        ))}

        {unassigned.length > 0 && (
          <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
            <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              Not playing yet — needs a team
            </p>
            {unassigned.map(p => (
              <div key={p.user_id} className="flex items-center gap-1.5 text-xs px-1">
                <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                  {p.display_name?.[0]?.toUpperCase()}
                </div>
                <span className={p.user_id === myPlayerId ? 'font-semibold text-primary' : 'text-muted-foreground'}>{p.display_name}</span>
                {p.user_id === hostId && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0">Host</Badge>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1.5 pt-1">
          <Input
            value={newTeamName}
            onChange={e => setNewTeamName(e.target.value)}
            placeholder="New team name…"
            className="h-8 text-xs"
            onKeyDown={e => e.key === 'Enter' && handleCreateTeam()}
            maxLength={20}
          />
          <Button size="sm" variant="outline" className="h-8 px-2" onClick={handleCreateTeam} disabled={!newTeamName.trim()}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}