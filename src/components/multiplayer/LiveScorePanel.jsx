import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Users } from 'lucide-react';

export default function LiveScorePanel({ session, myPlayerId }) {
  const players = session?.players || [];
  const teams = session?.teams || [];

  const hasTeams = teams.length > 0;

  if (hasTeams) {
    const sortedTeams = [...teams].sort((a, b) => (b.score || 0) - (a.score || 0));
    return (
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" /> Team Scores
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedTeams.map((team, i) => {
            const teamPlayers = players.filter(p => p.team === team.name);
            const myTeam = players.find(p => p.user_id === myPlayerId)?.team === team.name;
            return (
              <div key={team.name} className={`rounded-lg p-2.5 ${myTeam ? 'bg-primary/5 border border-primary/20' : 'bg-muted/30'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-semibold text-sm ${myTeam ? 'text-primary' : ''}`}>{team.name}</span>
                  <Badge variant={i === 0 ? 'default' : 'secondary'} className="font-bold">{team.score || 0} pts</Badge>
                </div>
                <div className="space-y-0.5">
                  {teamPlayers.map(p => (
                    <div key={p.user_id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{p.display_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    );
  }

  const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> Live Scores
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {sorted.map((p, i) => (
          <div key={p.user_id} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
            <span className={`text-sm flex-1 truncate ${p.user_id === myPlayerId ? 'font-semibold text-primary' : ''}`}>
              {p.display_name}
            </span>
            <Badge variant="secondary" className="text-xs">{p.score || 0}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}