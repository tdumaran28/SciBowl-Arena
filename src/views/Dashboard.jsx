import Link from 'next/link';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Atom, BookOpen, Play, Users, Trophy, Target, Zap, ChevronRight, FileText, UserRound } from 'lucide-react';
import { SUBJECT_COLORS } from '@/utils/parseRound';
import { motion } from 'framer-motion';
import LeaderboardSection from '@/components/dashboard/LeaderboardSection';

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } } };

export default function Dashboard() {
  // Aggregate counts are computed server-side over the WHOLE database, so
  // "Games Played" and question counts never cap out at a fetch limit.
  const { data: summary } = useQuery({
    queryKey: ['stats-summary'],
    queryFn: () => base44.stats.summary(),
    refetchInterval: 60000,
  });

  const { data: recentRounds = [] } = useQuery({
    queryKey: ['rounds-recent'],
    queryFn: () => base44.entities.Round.list('-created_date', 8),
  });

  const topSubjects = Object.entries(summary?.subject_breakdown || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  const stats = [
    { icon: BookOpen, label: 'Packets', value: summary?.rounds ?? '—', color: 'text-primary', bg: 'bg-primary/10' },
    { icon: Zap, label: 'Questions', value: summary?.questions ?? '—', color: 'text-accent', bg: 'bg-accent/10' },
    { icon: Trophy, label: 'Games Played', value: summary?.games_played ?? '—', color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { icon: Target, label: 'Questions Answered', value: summary?.questions_answered ?? '—', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { icon: Atom, label: 'Tournaments', value: summary?.tournaments ?? '—', color: 'text-purple-500', bg: 'bg-purple-500/10' },
    { icon: UserRound, label: 'Players', value: summary?.players ?? '—', color: 'text-rose-500', bg: 'bg-rose-500/10' },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Hero */}
      <motion.div variants={container} initial="hidden" animate="show" className="mb-8">
        <motion.div variants={item} className="mb-2">
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Welcome to</span>
        </motion.div>
        <motion.h1 variants={item} className="text-4xl lg:text-5xl font-bold tracking-tight mb-2">
          SciBowl <span className="text-primary">Arena</span>
        </motion.h1>
        <motion.p variants={item} className="text-muted-foreground text-lg max-w-2xl">
          Upload Science Bowl packets, practice solo, and compete with teammates — all in one place.
        </motion.p>
      </motion.div>

      {/* Quick actions */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { to: '/database', icon: BookOpen, label: 'Browse Rounds', sub: `${summary?.playable_rounds ?? '…'} available`, color: 'bg-primary/10 text-primary' },
          { to: '/play', icon: Play, label: 'Solo Practice', sub: 'A round, or an endless marathon', color: 'bg-accent/10 text-accent' },
          { to: '/multiplayer', icon: Users, label: 'Multiplayer', sub: 'Compete with others', color: 'bg-emerald-500/10 text-emerald-600' },
          { to: '/pdf', icon: FileText, label: 'PDF Viewer', sub: 'Read packets side by side', color: 'bg-orange-500/10 text-orange-600' },
        ].map(({ to, icon: Icon, label, sub, color }) => (
          <motion.div key={to} variants={item}>
            <Link href={to}>
              <Card className="group hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 cursor-pointer border-border/60">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-semibold">{label}</p>
                    <p className="text-sm text-muted-foreground">{sub}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto group-hover:translate-x-1 transition-transform" />
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        ))}
      </motion.div>

      {/* Arena-wide stats — full-width row with room for large numbers */}
      <motion.div variants={container} initial="hidden" animate="show" className="mb-8">
        <motion.h2 variants={item} className="text-lg font-semibold mb-4">
          Arena Statistics
        </motion.h2>
        <motion.div variants={item} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {stats.map(({ icon: Icon, label, value, color, bg }) => (
            <Card key={label} className="border-border/60">
              <CardContent className="p-5">
                <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-3`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <p className="text-3xl font-bold tabular-nums tracking-tight">
                  {typeof value === 'number' ? value.toLocaleString() : value}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </CardContent>
            </Card>
          ))}
        </motion.div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div variants={container} initial="hidden" animate="show" className="lg:col-span-2 space-y-4">
          {/* Subject coverage */}
          {topSubjects.length > 0 && (
            <motion.div variants={item}>
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Question Bank by Subject</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {topSubjects.map(([subject, count]) => (
                    <Badge key={subject} variant="outline" className={`text-sm py-1 px-3 ${SUBJECT_COLORS[subject] || ''}`}>
                      {subject} · {count.toLocaleString()}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Recent rounds */}
          <motion.div variants={item}>
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Recently Added Rounds</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {recentRounds.length === 0 ? (
                  <div className="px-6 py-8 text-center text-muted-foreground text-sm">
                    No rounds yet. <Link href="/database" className="text-primary underline">Upload one</Link> to get started.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {recentRounds.map(round => (
                      <div key={round.id} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Atom className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{round.title}</p>
                          <p className="text-xs text-muted-foreground">{round.question_count || 0} questions · {round.year || 'Unknown year'}</p>
                        </div>
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {round.parse_status === 'success' ? '✓ Ready' : round.parse_status === 'processing' ? '⏳ Parsing' : '⚠ Error'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>

        {/* Leaderboard */}
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">
          <motion.div variants={item}>
            <LeaderboardSection />
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
