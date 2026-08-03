import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import GameSettings from '@/components/game/GameSettings';
import QuestionReader from '@/components/game/QuestionReader';
import GameResults from '@/components/game/GameResults';
import TeamPanel from '@/components/multiplayer/TeamPanel';
import ChatBox from '@/components/multiplayer/ChatBox';
import BuzzLockOverlay from '@/components/multiplayer/BuzzLockOverlay';
import BuzzResultBanner from '@/components/multiplayer/BuzzResultBanner';
import MatchSidePanel from '@/components/multiplayer/MatchSidePanel';
import RoundSelect from '@/components/game/RoundSelect';
import { Users, Plus, LogIn, Crown, Trophy, Zap, Copy, CheckCircle, LogOut, Globe, Lock, Unlock, Timer, Flag, BookOpen, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { buildMarathonPools, marathonQuestionAt, randomSeed } from '@/utils/marathon';
import MarathonSetup, { DEFAULT_MARATHON_CONFIG } from '@/components/game/MarathonSetup';
import GameKindSelect from '@/components/game/GameKindSelect';
import { syncClock, serverNow } from '@/lib/clock';

const DEFAULT_SETTINGS = {
  read_aloud: false,
  wpm: 250,
  answer_time: 8,
  skip_bonuses: false,
  subjects: [],
  question_types: ['TOSSUP', 'BONUS'],
  display_mode: 'word_by_word',
};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

export default function Multiplayer() {
  const [user, setUser] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [nameSet, setNameSet] = useState(false);
  const [view, setView] = useState('lobby');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [session, setSession] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [selectedRoundId, setSelectedRoundId] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [myResults, setMyResults] = useState([]);
  const [copied, setCopied] = useState(false);
  // Bumped when the server awards a buzz to someone else, so QuestionReader can
  // roll back the optimistic local buzz.
  const [buzzRevokedAt, setBuzzRevokedAt] = useState(0);
  // Round practice (a specific packet) or marathon (endless, sampled from a pool)
  const [gameKind, setGameKind] = useState('round');
  const [marathonConfig, setMarathonConfig] = useState(DEFAULT_MARATHON_CONFIG);
  const pollRef = useRef(null);
  const sessionRef = useRef(null);
  const autoJoinRef = useRef(false);

  useEffect(() => {
    base44.auth.me()
      .then(u => {
        setUser(u);
        setDisplayName(u.full_name || u.email?.split('@')[0] || '');
        setNameSet(true);
      })
      .catch(() => {});
  }, []);

  // My own library — public packets plus my private ones.
  const { data: myRounds = [] } = useQuery({
    queryKey: ['rounds-mp'],
    queryFn: () => base44.entities.Round.filter({ parse_status: 'success' }, '-created_date', 500),
  });

  // Packets this room plays. A host can pick one of their private packets, and
  // it is not in anyone else's library — so the session serves it separately.
  const { data: sessionRounds = [] } = useQuery({
    queryKey: ['session-rounds', session?.id],
    queryFn: () => base44.multiplayer.rounds(session.id),
    enabled: Boolean(session?.id),
    staleTime: 60 * 1000,
  });

  // Session-supplied packets win on id collision — they are the authoritative
  // copy for this room.
  const rounds = useMemo(() => {
    if (sessionRounds.length === 0) return myRounds;
    const byId = new Map(myRounds.map(r => [r.id, r]));
    for (const r of sessionRounds) byId.set(r.id, r);
    return [...byId.values()];
  }, [myRounds, sessionRounds]);

  const myPlayerId = user?.email || displayName;

  const activeQuestions = (() => {
    const round = rounds.find(r => r.id === session?.round_id);
    let qs = round?.questions || [];
    const cfg = session?.settings || settings;
    if (cfg?.subjects?.length > 0) qs = qs.filter(q => cfg.subjects.includes(q.subject));
    if (cfg?.skip_bonuses) qs = qs.filter(q => q.type === 'TOSSUP');
    return qs;
  })();

  const activeRound = rounds.find(r => r.id === session?.round_id);
  const players = session?.players || [];
  const teams = session?.teams || [];
  const myPlayer = players.find(p => p.user_id === myPlayerId);
  const myTeam = myPlayer?.team || '';
  const myTeamDef = teams.find(t => t.name === myTeam);
  const isCaptain = myTeamDef ? myTeamDef.captain_id === myPlayerId : true; // no team = can buzz
  const isHost = session?.host_id === myPlayerId;
  const buzzState = session?.buzz_state || null;
  const currentIndex = session?.current_question_index || 0;

  // Marathon sessions carry no question list — every client derives the same
  // infinite sequence from the shared { seed, round_ids, subject_freq } config.
  const isMarathon = session?.game_type === 'marathon';
  const marathonPools = useMemo(() => {
    if (!isMarathon || !session) return null;
    return buildMarathonPools(rounds, {
      roundIds: session.round_ids || [],
      roundFilter: session.round_filter || 'all',
      questionTypes: session.settings?.question_types || ['TOSSUP', 'BONUS'],
      subjectFreq: session.subject_freq || {},
    });
  }, [isMarathon, rounds, session]);

  const totalQuestions = isMarathon ? Infinity : activeQuestions.length;
  const currentQuestion = isMarathon
    ? (marathonPools ? marathonQuestionAt(marathonPools, session?.seed || 0, currentIndex) : null)
    : activeQuestions[currentIndex];
  const currentQuestionRef = useRef(null);
  currentQuestionRef.current = currentQuestion;

  // Resolve any question index back to its question — marathon derives it from
  // the shared seed, round practice indexes the filtered list. Used by the side
  // panel to reopen an already-played question.
  const getQuestionAt = useCallback((index) => {
    if (index == null || index < 0) return null;
    return isMarathon
      ? (marathonPools ? marathonQuestionAt(marathonPools, session?.seed || 0, index) : null)
      : activeQuestions[index] || null;
  }, [isMarathon, marathonPools, session?.seed, activeQuestions]);

  // Derived buzz state. Team games lock out by team; free-for-all (no teams)
  // locks out by player, and the bonus belongs to the specific winning player.
  const isFFA = teams.length === 0;
  const iAmNegged = isFFA
    ? !!buzzState?.negged_players?.includes(myPlayerId)
    : !!(myTeam && buzzState?.negged_teams?.includes(myTeam));
  const bonusIsMine = isFFA
    ? buzzState?.bonus_for_player_id === myPlayerId
    : !!(myTeam && buzzState?.bonus_for_team === myTeam);
  const bonusEarned = !!(buzzState?.bonus_for_team || buzzState?.bonus_for_player_id || buzzState?.bonus_for_player);
  const isBonusForOther = bonusEarned && !bonusIsMine;
  const someoneElseBuzzed = buzzState?.buzzed_player_id && buzzState.buzzed_player_id !== myPlayerId && !buzzState.result;
  const iAmBuzzing = buzzState?.buzzed_player_id === myPlayerId && !buzzState.result;

  const isTossupQ = currentQuestion?.type === 'TOSSUP';
  const isBonusQ = currentQuestion?.type === 'BONUS';
  // A tossup is "dead" (nobody can get it right anymore) when the timer elapsed
  // with no correct answer, or every team / every player has answered wrong.
  const allTeamsAnswered = teams.length > 0 && teams.every(t => buzzState?.negged_teams?.includes(t.name));
  const allPlayersAnswered = isFFA && players.length > 0 &&
    players.every(p => buzzState?.negged_players?.includes(p.user_id));
  const questionDead = !!buzzState?.dead || allTeamsAnswered || allPlayersAnswered;
  // A question is "resolved" (no more buzzing) when a tossup is answered correctly
  // or dies, or when a bonus has been answered (correct or wrong).
  const resolved = isTossupQ
    ? (buzzState?.result === 'correct' || questionDead)
    : !!buzzState?.result;

  // Can I buzz a tossup? Not when resolved, not while someone else is answering,
  // not if I/my team already negged, not if it's someone else's bonus, captain only.
  const canBuzz = !resolved &&
    !someoneElseBuzzed &&
    !iAmNegged &&
    !isBonusForOther &&
    isCaptain &&
    !iAmBuzzing;

  // Measure this machine's offset from the server clock before anything
  // time-sensitive happens. Every shared instant (reading start, buzz time) is
  // expressed on the server's clock precisely so player clock skew — routinely
  // seconds — cannot desynchronize the match. See src/lib/clock.js.
  useEffect(() => { syncClock(); }, []);

  // Realtime session updates + a slow poll fallback.
  useEffect(() => {
    if (!session?.id || view === 'lobby') return;
    const sessionId = session.id;
    let cancelled = false;

    const applyFull = (u) => {
      if (cancelled || !u || u.id !== sessionId) return;
      setSession(u);
      sessionRef.current = u;
      if (u.status === 'active' && view === 'room') setView('playing');
      if (u.status === 'finished' && view === 'playing') setView('finished');
      if (u.status === 'waiting' && (view === 'playing' || view === 'finished')) setView('room');
    };

    // Patch frames carry only the fields that changed — merge them onto the
    // session we already hold rather than replacing it.
    const applyPatch = (id, patch) => {
      if (cancelled || id !== sessionId || !patch) return;
      const merged = { ...(sessionRef.current || {}), ...patch };
      applyFull(merged);
    };

    const refetch = async () => {
      try {
        const arr = await base44.entities.GameSession.filter({ id: sessionId }, '-created_date', 1);
        if (arr[0]) applyFull(arr[0]);
      } catch { /* transient — the poll will retry */ }
    };

    refetch();
    const leaveRoom = base44.multiplayer.joinRoom(sessionId);
    const unsubscribe = base44.entities.GameSession.subscribe((event) => {
      // A reconnect means frames were missed while the socket was down, so
      // reconcile with the server instead of trusting local state.
      if (event?.resync) { syncClock({ force: true }); refetch(); return; }
      if (event?.patch) applyPatch(event.id, event.patch);
      else applyFull(event?.data);
    });

    // WebSocket push is the primary channel; this poll is only a safety net
    // for a dropped connection, so it can be slow.
    pollRef.current = setInterval(refetch, 15000);
    return () => {
      cancelled = true;
      leaveRoom();
      if (typeof unsubscribe === 'function') unsubscribe();
      clearInterval(pollRef.current);
    };
  }, [session?.id, view]);

  // Closing the tab leaves the game (and forfeits if only one player would
  // remain). sendBeacon, because browsers cancel in-flight fetches during
  // unload — which used to leave ghost players sitting in rooms.
  useEffect(() => {
    if (!session?.id) return;
    const handler = () => {
      const sess = sessionRef.current;
      if (!sess) return;
      base44.multiplayer.leaveBeacon(sess.id, { player_id: myPlayerId });
    };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, [session?.id, myPlayerId]);

  const updateSession = useCallback(async (data) => {
    if (!sessionRef.current?.id) return;
    const updated = await base44.entities.GameSession.update(sessionRef.current.id, data);
    setSession(updated);
    sessionRef.current = updated;
    return updated;
  }, []);

  // Pool preview for the marathon setup in the lobby (before a session exists).
  const lobbyMarathonPools = useMemo(
    () => buildMarathonPools(rounds, {
      roundIds: marathonConfig.roundIds,
      roundFilter: marathonConfig.roundFilter,
      questionTypes: settings.question_types,
      subjectFreq: marathonConfig.subjectFreq,
    }),
    [rounds, marathonConfig, settings.question_types],
  );

  const handleCreateRoom = async () => {
    if (gameKind === 'round' && !selectedRoundId) return toast.error('Select a round first');
    if (gameKind === 'marathon' && lobbyMarathonPools.poolSize === 0) {
      return toast.error('No questions match the selected filters. Adjust subjects or packets.');
    }
    const code = generateRoomCode();
    // A marathon room stores only the sampling config: every client derives the
    // identical infinite question sequence from the shared seed.
    //
    // The packet list is always materialized, never left empty to mean "all":
    // "all" resolves differently per player now that libraries differ by
    // visibility, and each client derives its own questions from the pool — so
    // an implicit list would silently desynchronize the room.
    const marathonFields = gameKind === 'marathon' ? {
      game_type: 'marathon',
      round_id: '',
      round_ids: marathonConfig.roundIds.length > 0
        ? marathonConfig.roundIds
        : lobbyMarathonPools.roundIds,
      round_filter: marathonConfig.roundFilter,
      subject_freq: marathonConfig.subjectFreq,
      seed: randomSeed(),
    } : {
      game_type: 'standard',
      round_id: selectedRoundId,
    };
    const newSession = await base44.entities.GameSession.create({
      ...marathonFields,
      mode: 'multiplayer',
      room_code: code,
      host_id: myPlayerId,
      status: 'waiting',
      is_public: isPublic,
      locked: false,
      players: [{ user_id: myPlayerId, display_name: displayName, score: 0, team: '', answers: [] }],
      teams: [],
      current_question_index: 0,
      settings,
      question_results: [],
      chat_messages: [],
      buzz_state: null,
    });
    sessionRef.current = newSession;
    setSession(newSession);
    setRoomCode(code);
    setView('room');
  };

  // Host: after a round finishes, pick another packet and play again with the
  // same people. Scores reset — it is a new game, not a continuation.
  const handlePlayAnotherRound = async (nextRoundId) => {
    const sess = sessionRef.current;
    if (!sess) return;
    let updated = await base44.multiplayer.returnToLobby(sess.id, {
      round_id: nextRoundId || '',
      game_type: nextRoundId ? 'standard' : sess.game_type,
    });
    // A fresh marathon needs a fresh seed, or it replays the same sequence —
    // the whole question order is derived from it.
    if (!nextRoundId && sess.game_type === 'marathon') {
      updated = await base44.entities.GameSession.update(sess.id, { seed: randomSeed() });
    }
    setSession(updated);
    sessionRef.current = updated;
    setMyResults([]);
    setSelectedRoundId(nextRoundId || '');
    setView('room');
  };

  // Host: close the room for everyone.
  const handleEndGame = async () => {
    const sess = sessionRef.current;
    if (!sess) return;
    const updated = await base44.multiplayer.next(sess.id, { next_index: 0, finished: true });
    setSession(updated);
    sessionRef.current = updated;
    setView('finished');
  };

  // Join by code — used by the manual input, the public games browser, and the
  // ?room= URL param (marathon rooms hand off here after creation). Players may
  // join mid-match at any time unless the host has locked the room.
  const joinRoomByCode = useCallback(async (code) => {
    if (!code?.trim()) return;
    const sessions = await base44.entities.GameSession.filter({ room_code: code.toUpperCase() }, '-created_date', 1);
    if (!sessions[0]) return toast.error('Room not found');
    const sess = sessions[0];
    if (sess.status === 'finished') return toast.error('That game has ended');
    const already = sess.players.find(p => p.user_id === myPlayerId);
    if (!already && sess.locked) return toast.error('The host has locked this room to new players');
    let updated = sess;
    if (!already) {
      updated = await base44.entities.GameSession.update(sess.id, {
        players: [...sess.players, { user_id: myPlayerId, display_name: displayName, score: 0, team: '', answers: [] }],
      });
    }
    sessionRef.current = updated;
    setSession(updated);
    setRoomCode(sess.room_code);
    setMyResults([]);
    setView(updated.status === 'active' ? 'playing' : updated.status === 'finished' ? 'finished' : 'room');
  }, [myPlayerId, displayName]);

  const handleJoinRoom = () => joinRoomByCode(joinCode);

  // Auto-join a room passed via ?room= (e.g. after creating a marathon room)
  useEffect(() => {
    if (autoJoinRef.current || !nameSet || !user) return;
    const code = new URLSearchParams(window.location.search).get('room');
    if (!code) return;
    autoJoinRef.current = true;
    joinRoomByCode(code);
  }, [nameSet, user, joinRoomByCode]);

  const handleStartGame = async () => {
    const sess = sessionRef.current;
    if (!sess) return;
    // The server stamps the reading clock so every client reads in step.
    const updated = await base44.multiplayer.start(sess.id);
    setSession(updated);
    sessionRef.current = updated;
    setView('playing');
    setMyResults([]);
  };

  // Buzz in. The buzz instant is stamped on the client (already converted to
  // the server's clock) and the server awards the buzz to the earliest such
  // instant within a short arbitration window — so the player who actually hit
  // the buzzer first wins, not the one with the shortest network path.
  const handleBuzz = useCallback(async (buzzedAt) => {
    const sess = sessionRef.current;
    if (!sess || !canBuzz) return;
    try {
      const updated = await base44.multiplayer.buzz(sess.id, {
        player_id: myPlayerId,
        team: myTeam,
        display_name: displayName,
        buzzed_at: buzzedAt ?? serverNow(),
      });
      setSession(updated);
      sessionRef.current = updated;
      if (updated.buzz_margin_ms != null) {
        toast.success(`Buzzed first by ${updated.buzz_margin_ms} ms`, { duration: 2000 });
      }
    } catch (err) {
      // Lost the arbitration — take the optimistic local buzz back and sync to
      // the server's view of who won.
      if (err.status === 409) {
        setBuzzRevokedAt(Date.now());
        if (err.data?.session) {
          setSession(err.data.session);
          sessionRef.current = err.data.session;
        }
        if (err.data?.margin_ms != null) {
          toast(`Lost the buzz by ${err.data.margin_ms} ms`, { duration: 2000 });
        }
      }
    }
  }, [canBuzz, myPlayerId, myTeam, displayName]);

  // Submit answer result (called from QuestionReader when I answered).
  // Scoring is applied server-side: two players resolving at nearly the same
  // moment used to clobber each other's score arrays through the generic PATCH.
  const handleAnswer = useCallback(async (result) => {
    const sess = sessionRef.current;
    if (!sess) return;
    setMyResults(prev => [...prev, { ...result, questionIndex: currentIndex }]);
    const updated = await base44.multiplayer.answer(sess.id, {
      player_id: myPlayerId,
      display_name: displayName,
      team: myTeam,
      result: result.result,
      type: result.type,
      interrupted: !!result.interrupted,
    });
    setSession(updated);
    sessionRef.current = updated;
  }, [currentIndex, myPlayerId, myTeam, displayName]);

  // Tossup timer elapsed with no correct answer → question is dead (shared).
  // The server decides what "dead" means for the current roster.
  const handleDead = useCallback(async () => {
    const sess = sessionRef.current;
    if (!sess) return;
    const bs = sess.buzz_state || {};
    if (bs.result === 'correct' || bs.dead) return;
    const updated = await base44.multiplayer.dead(sess.id, {
      is_bonus: currentQuestionRef.current?.type === 'BONUS',
    });
    setSession(updated);
    sessionRef.current = updated;
  }, []);

  // Advance to next question (only the person who answered correctly / captain for bonus can press next)
  const handleNext = useCallback(async () => {
    const sess = sessionRef.current;
    if (!sess) return;

    // Marathon: endless — every sampled question stands alone (no bonus
    // skipping/ownership). The game only ends when the host ends it.
    if (sess.game_type === 'marathon') {
      const updated = await base44.multiplayer.next(sess.id, {
        next_index: (sess.current_question_index || 0) + 1,
      });
      setSession(updated);
      sessionRef.current = updated;
      return;
    }

    const qs = (() => {
      const round = rounds.find(r => r.id === sess.round_id);
      let q = round?.questions || [];
      const cfg = sess.settings;
      if (cfg?.subjects?.length > 0) q = q.filter(x => cfg.subjects.includes(x.subject));
      if (cfg?.skip_bonuses) q = q.filter(x => x.type === 'TOSSUP');
      return q;
    })();

    let nextIdx = (sess.current_question_index || 0) + 1;
    // Skip ALL consecutive unearned bonuses (covers bonus-after-bonus chains)
    const wasEarned = sess.buzz_state?.bonus_for_team || sess.buzz_state?.bonus_for_player_id || sess.buzz_state?.bonus_for_player;
    while (nextIdx < qs.length && qs[nextIdx]?.type === 'BONUS' && !wasEarned) {
      nextIdx++;
    }

    if (nextIdx >= qs.length) {
      const updated = await base44.multiplayer.next(sess.id, { next_index: nextIdx, finished: true });
      setSession(updated);
      sessionRef.current = updated;
      setView('finished');
      return;
    }

    // Preserve earned bonus ownership when advancing onto the bonus question so
    // the winning team/player (and only them) can answer it. Clear otherwise.
    const updated = await base44.multiplayer.next(sess.id, {
      next_index: nextIdx,
      keep_bonus_owner: qs[nextIdx]?.type === 'BONUS',
    });
    setSession(updated);
    sessionRef.current = updated;
  }, [rounds]);

  const handleLeave = async () => {
    // Remove myself from players; if only one (or fewer) remains, they win by default.
    if (session?.id) {
      await base44.multiplayer.leave(session.id, { player_id: myPlayerId }).catch(() => {});
    }
    clearInterval(pollRef.current);
    setView('lobby');
    setSession(null);
    sessionRef.current = null;
    setRoomCode('');
    setJoinCode('');
    setMyResults([]);
  };

  // Chat goes through a dedicated append endpoint so two people sending at
  // the same moment can't overwrite each other's messages.
  const handleSendMessage = async (text) => {
    const sess = sessionRef.current;
    if (!sess) return;
    const updated = await base44.multiplayer.sendChat(sess.id, {
      sender_id: myPlayerId, sender_name: displayName, text,
    });
    setSession(updated);
    sessionRef.current = updated;
  };

  const handleUpdateSession = async (data) => {
    return updateSession(data);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Name setup ────────────────────────────────────────────────────────────
  if (!nameSet) {
    return (
      <div className="p-6 lg:p-8 max-w-md mx-auto mt-8">
        <Card className="border-border/60">
          <CardHeader><CardTitle>Enter Your Display Name</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Input placeholder="Display name…" value={displayName} onChange={e => setDisplayName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && displayName.trim() && setNameSet(true)} />
            <Button className="w-full" onClick={() => setNameSet(true)} disabled={!displayName.trim()}>Continue</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Finished ──────────────────────────────────────────────────────────────
  if (view === 'finished') {
    const sortedTeams = [...teams].sort((a, b) => (b.score || 0) - (a.score || 0));
    const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
    // Align the review list with MY results (results[i] ↔ questions[i])
    const reviewQuestions = myResults.map(r => isMarathon
      ? (marathonPools ? marathonQuestionAt(marathonPools, session?.seed || 0, r.questionIndex) : null)
      : activeQuestions[r.questionIndex]);
    return (
      <div className="p-6 lg:p-8">
        <div className="max-w-2xl mx-auto mb-6">
          <Card className="border-border/60 mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" /> Final Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              {teams.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Teams</p>
                  {sortedTeams.map((t, i) => (
                    <div key={t.name} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                      <span className="text-lg font-bold w-6">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`}</span>
                      <span className="font-medium flex-1">{t.name}</span>
                      <Badge variant={i === 0 ? 'default' : 'secondary'}>{t.score || 0} pts</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedPlayers.map((p, i) => (
                    <div key={p.user_id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                      <span className="text-lg font-bold w-6">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`}</span>
                      <span className={`font-medium flex-1 ${p.user_id === myPlayerId ? 'text-primary' : ''}`}>{p.display_name}</span>
                      <Badge variant={i === 0 ? 'default' : 'secondary'}>{p.score || 0} pts</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Host: keep the room alive for another round, or close it. Everyone
              else is told which is happening — a `waiting` status arrives over
              the socket and pulls them back to the room automatically. */}
          <Card className="border-border/60 mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {isHost ? 'What next?' : 'Waiting for the host'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isHost ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button className="flex-1" onClick={() => handlePlayAnotherRound('')}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {isMarathon ? 'New Marathon' : 'Play Another Round'}
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={handleLeave}>
                    <LogOut className="w-4 h-4 mr-2" /> End Game & Close Room
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The host can start another round with the same players, or close the room.
                  You&apos;ll be pulled back into the room automatically if they play on.
                </p>
              )}
              <Button variant="ghost" size="sm" className="mt-3 text-muted-foreground" onClick={handleLeave}>
                Leave this room
              </Button>
            </CardContent>
          </Card>
        </div>
        <GameResults
          results={myResults}
          questions={reviewQuestions}
          onReplay={handleLeave}
          roundTitle={isMarathon ? 'Multiplayer Marathon' : (activeRound?.title || 'Multiplayer Game')}
          mode={isMarathon ? 'marathon' : 'multiplayer'}
          subjectsFilter={session?.settings?.subjects || []}
        />
      </div>
    );
  }

  // ── Playing ───────────────────────────────────────────────────────────────
  if (view === 'playing') {
    // The team (or, in free-for-all, the player) that won the tossup answers the bonus.
    const canAnswerMyBonus = isBonusQ && bonusIsMine && !resolved;
    // Frozen out (cannot buzz, reading pauses) when someone else is answering a
    // tossup or the bonus belongs to someone else.
    const externalBuzzed = someoneElseBuzzed || (isBonusQ && isBonusForOther && !resolved);
    const buzzEnabled = (canBuzz || canAnswerMyBonus) && !iAmBuzzing;
    const canInteract = iAmBuzzing || canAnswerMyBonus;
    const showLock = externalBuzzed;

    // Next is available once the question is resolved: the winner advances,
    // anyone advances on a dead question, and the host can always advance as a
    // fallback so the game can never get stuck (e.g. the winner disconnected).
    const iWonThis = isFFA
      ? buzzState?.result_player_id === myPlayerId
      : !!(myTeam && buzzState?.result_team === myTeam);
    const canAdvance = resolved && (
      (buzzState?.result === 'correct' && iWonThis) ||
      (isBonusQ && !!buzzState?.result && (iWonThis || bonusIsMine)) ||
      (isTossupQ && questionDead) ||
      (isBonusQ && questionDead) ||
      isHost
    );

    return (
      <div className="p-4 lg:p-6 max-w-6xl mx-auto flex flex-col gap-4 min-h-screen">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 flex-1">
          {/* Main question area */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {isMarathon && <Timer className="w-4 h-4 text-primary flex-shrink-0" />}
                <h2 className="font-semibold text-sm truncate">{isMarathon ? 'Marathon' : activeRound?.title}</h2>
                {session?.locked && (
                  <Badge variant="outline" className="text-xs flex-shrink-0"><Lock className="w-3 h-3 mr-1" /> Locked</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isMarathon && (
                  <span className="text-xs text-muted-foreground">Q {currentIndex + 1}/{activeQuestions.length}</span>
                )}
                {isHost && (
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => updateSession({ locked: !session?.locked })}
                    title={session?.locked ? 'Unlock joins' : 'Lock joins'}
                  >
                    {session?.locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleLeave} className="text-muted-foreground hover:text-destructive">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {currentQuestion ? (
              <>
                <QuestionReader
                  key={`${currentIndex}`}
                  question={currentQuestion}
                  questionIndex={currentIndex}
                  totalQuestions={totalQuestions}
                  settings={session?.settings || settings}
                  onAnswer={canInteract ? handleAnswer : () => {}}
                  onBuzz={buzzEnabled ? handleBuzz : undefined}
                  onDead={handleDead}
                  isBonusFor={isBonusQ ? (buzzState?.bonus_for_team || buzzState?.bonus_for_player || null) : null}
                  externalBuzzed={externalBuzzed}
                  buzzEnabled={buzzEnabled}
                  multiplayer
                  resolved={resolved}
                  readingStartedAt={buzzState?.reading_started_at || null}
                  buzzRevokedAt={buzzRevokedAt}
                />
                <BuzzResultBanner buzzState={buzzState} dead={questionDead} answer={currentQuestion?.answer} />
                {showLock && <BuzzLockOverlay buzzState={buzzState} myTeam={myTeam} />}
                {canAdvance && (
                  <Button onClick={handleNext} size="lg" className="w-full font-semibold">
                    {isMarathon || currentIndex + 1 < activeQuestions.length ? 'Next Question →' : 'See Results'}
                  </Button>
                )}
                {isHost && (
                  <Button variant="outline" className="w-full" onClick={handleEndGame}>
                    <Flag className="w-4 h-4 mr-2" />
                    {isMarathon ? 'End Marathon & Show Results' : 'End Round & Show Results'}
                  </Button>
                )}
              </>
            ) : null}
          </div>

          {/* Side panel */}
          <div className="space-y-3">
            <MatchSidePanel
              session={session}
              myPlayerId={myPlayerId}
              onLeave={handleLeave}
              getQuestion={getQuestionAt}
            />
          </div>
        </div>

        {/* Chat bar */}
        <ChatBox
          session={session}
          myPlayerId={myPlayerId}
          myDisplayName={displayName}
          onSendMessage={handleSendMessage}
        />
      </div>
    );
  }

  // ── Room lobby ────────────────────────────────────────────────────────────
  if (view === 'room') {
    return (
      <div className="p-6 lg:p-8 max-w-2xl mx-auto space-y-4">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 flex-wrap">
              <Users className="w-5 h-5 text-primary" /> Room: {roomCode}
              {isMarathon && (
                <Badge variant="secondary" className="text-xs"><Timer className="w-3 h-3 mr-1" /> Marathon</Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {session?.is_public ? <><Globe className="w-3 h-3 mr-1" /> Public</> : <><Lock className="w-3 h-3 mr-1" /> Private</>}
              </Badge>
              {session?.locked && (
                <Badge variant="outline" className="text-xs text-destructive border-destructive/40">
                  <Lock className="w-3 h-3 mr-1" /> Joins locked
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted rounded-lg px-4 py-2.5 font-mono text-xl font-bold tracking-widest text-center">{roomCode}</code>
              <Button variant="outline" size="icon" onClick={handleCopyCode}>
                {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>

            {isHost && (
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{session?.locked ? 'Room locked' : 'Room open'}</p>
                  <p className="text-xs text-muted-foreground">
                    {session?.locked
                      ? 'No new players can join until you unlock'
                      : 'Players can join at any time — even mid-match'}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => updateSession({ locked: !session?.locked })}>
                  {session?.locked
                    ? <><Unlock className="w-3.5 h-3.5 mr-1" /> Unlock</>
                    : <><Lock className="w-3.5 h-3.5 mr-1" /> Lock</>}
                </Button>
              </div>
            )}

            <div>
              <p className="text-sm font-medium mb-2">Players ({players.length})</p>
              <div className="space-y-1.5">
                {players.map(p => (
                  <div key={p.user_id} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                      {p.display_name?.[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm font-medium flex-1">{p.display_name}</span>
                    {p.team && <Badge variant="outline" className="text-xs">{p.team}</Badge>}
                    {p.user_id === session?.host_id && <Crown className="w-3.5 h-3.5 text-amber-500" />}
                  </div>
                ))}
              </div>
            </div>

            <TeamPanel session={session} myPlayerId={myPlayerId} onUpdateSession={handleUpdateSession} />

            {/* Round practice: the host picks the packet here, so returning to
                the room after a finished round is also how you choose the next
                one — same players, new round. */}
            {isHost && !isMarathon && (
              <div>
                <label className="text-sm font-medium mb-1.5 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  {session?.round_id ? 'Round' : 'Choose a round to play'}
                </label>
                <RoundSelect
                  rounds={rounds}
                  value={session?.round_id || ''}
                  onChange={(id) => updateSession({ round_id: id })}
                />
              </div>
            )}
            {!isHost && !isMarathon && (
              <p className="text-sm text-muted-foreground">
                Round: <span className="font-medium text-foreground">{activeRound?.title || 'waiting for host to choose…'}</span>
              </p>
            )}

            <div className="flex gap-2">
              {isHost ? (
                <Button
                  className="flex-1"
                  onClick={handleStartGame}
                  disabled={!isMarathon && !session?.round_id}
                >
                  <Zap className="w-4 h-4 mr-2" /> Start Game
                </Button>
              ) : (
                <div className="flex-1 text-sm text-muted-foreground text-center py-2 bg-muted rounded-lg">
                  Waiting for host to start…
                </div>
              )}
              <Button variant="outline" onClick={handleLeave}>Leave</Button>
            </div>
          </CardContent>
        </Card>

        <ChatBox
          session={session}
          myPlayerId={myPlayerId}
          myDisplayName={displayName}
          onSendMessage={handleSendMessage}
        />
      </div>
    );
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-1">Multiplayer</h1>
        <p className="text-muted-foreground">Create or join a room to compete head-to-head with others</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" /> Create Room
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Your Name</label>
              <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display name…" />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Game Type</label>
              <GameKindSelect value={gameKind} onChange={setGameKind} />
            </div>

            {gameKind === 'round' ? (
              <div>
                <label className="text-sm font-medium mb-1.5 block">Select Round</label>
                <RoundSelect rounds={rounds} value={selectedRoundId} onChange={setSelectedRoundId} />
              </div>
            ) : (
              <MarathonSetup
                rounds={rounds}
                config={marathonConfig}
                onChange={setMarathonConfig}
                poolSize={lobbyMarathonPools.poolSize}
              />
            )}

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                {isPublic ? <Globe className="w-4 h-4 text-emerald-500" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
                <div>
                  <p className="text-sm font-medium">{isPublic ? 'Public room' : 'Private room'}</p>
                  <p className="text-xs text-muted-foreground">
                    {isPublic ? 'Listed below — anyone can join' : 'Joinable only with the room code'}
                  </p>
                </div>
              </div>
              <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            </div>
            <GameSettings
              settings={settings}
              onChange={setSettings}
              onStart={handleCreateRoom}
              startLabel={gameKind === 'marathon'
                ? `Create Marathon Room (${lobbyMarathonPools.poolSize} in pool)`
                : `Create ${isPublic ? 'Public' : 'Private'} Room`}
              disabled={
                !displayName.trim() ||
                (gameKind === 'round' ? !selectedRoundId : lobbyMarathonPools.poolSize === 0)
              }
            />
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <LogIn className="w-4 h-4 text-primary" /> Join Room
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Your Name</label>
              <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Display name…" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Room Code</label>
              <Input
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Enter code…"
                maxLength={5}
                className="font-mono text-lg tracking-widest uppercase"
              />
            </div>
            <Button className="w-full" onClick={handleJoinRoom} disabled={joinCode.length < 4 || !displayName.trim()}>
              <LogIn className="w-4 h-4 mr-2" /> Join Room
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Public games browser */}
      <PublicRoomBrowser onJoin={joinRoomByCode} disabled={!displayName.trim()} />
    </div>
  );
}

// Browsable list of public rooms. Rooms stay joinable while waiting AND
// mid-match (late join) unless the host has locked them.
//
// Each row states what you'd be joining: which kind of game (marathon or a
// specific round, named), and who is already in it.
function PublicRoomBrowser({ onJoin, disabled }) {
  const { data: sessions = [] } = useQuery({
    queryKey: ['public-rooms'],
    queryFn: () => base44.entities.GameSession.filter({ is_public: true, mode: 'multiplayer' }, '-updated_date', 25),
    refetchInterval: 5000,
  });

  // Round titles for the "playing X" label — rooms only store a round_id.
  const { data: rounds = [] } = useQuery({
    queryKey: ['rounds-public-browser'],
    queryFn: () => base44.entities.Round.filter({ parse_status: 'success' }, '-created_date', 200),
    staleTime: 5 * 60 * 1000,
  });
  const roundTitleById = useMemo(
    () => Object.fromEntries(rounds.map(r => [r.id, r.title])),
    [rounds],
  );

  const now = Date.now();
  const rooms = sessions.filter(s =>
    s.status !== 'finished' &&
    s.room_code &&
    now - new Date(s.updated_date || s.created_date).getTime() < 6 * 60 * 60 * 1000
  );

  return (
    <Card className="border-border/60 mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="w-4 h-4 text-emerald-500" /> Public Games
          <Badge variant="secondary" className="text-xs">{rooms.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rooms.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No public games right now. Create one with the switch above!
          </p>
        ) : (
          <div className="divide-y divide-border">
            {rooms.map(room => {
              const roomPlayers = room.players || [];
              const isMarathonRoom = room.game_type === 'marathon';
              const roundTitle = roundTitleById[room.round_id];
              return (
                <div key={room.id} className="flex items-start gap-3 px-5 py-3">
                  <code className="bg-muted rounded px-2 py-1 font-mono text-sm font-bold tracking-wider flex-shrink-0 mt-0.5">
                    {room.room_code}
                  </code>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isMarathonRoom
                        ? <Badge variant="secondary" className="text-xs"><Timer className="w-3 h-3 mr-1" /> Marathon</Badge>
                        : <Badge variant="outline" className="text-xs"><BookOpen className="w-3 h-3 mr-1" /> Round Practice</Badge>}
                      <Badge
                        variant="outline"
                        className={`text-xs ${room.status === 'active' ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/40' : ''}`}
                      >
                        {room.status === 'active' ? 'In progress' : 'Waiting'}
                      </Badge>
                      {room.locked && (
                        <Badge variant="outline" className="text-xs text-destructive border-destructive/40">
                          <Lock className="w-3 h-3 mr-1" /> Locked
                        </Badge>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground truncate">
                      {isMarathonRoom
                        ? `Endless · ${(room.round_ids || []).length || 'all'} packet${(room.round_ids || []).length === 1 ? '' : 's'} in the pool`
                        : roundTitle
                          ? `Playing ${roundTitle}`
                          : 'Round not chosen yet'}
                    </p>

                    {/* Who's in the room */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Users className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        {roomPlayers.length} player{roomPlayers.length === 1 ? '' : 's'}:
                      </span>
                      {roomPlayers.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">empty</span>
                      ) : (
                        roomPlayers.slice(0, 6).map(p => (
                          <Badge key={p.user_id} variant="secondary" className="text-xs font-normal">
                            {p.user_id === room.host_id && <Crown className="w-2.5 h-2.5 mr-1 text-amber-500" />}
                            {p.display_name}
                            {p.team ? ` · ${p.team}` : ''}
                          </Badge>
                        ))
                      )}
                      {roomPlayers.length > 6 && (
                        <span className="text-xs text-muted-foreground">+{roomPlayers.length - 6} more</span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={room.status === 'active' ? 'outline' : 'default'}
                    onClick={() => onJoin(room.room_code)}
                    disabled={disabled || room.locked}
                    className="flex-shrink-0 mt-0.5"
                  >
                    <LogIn className="w-3.5 h-3.5 mr-1" /> {room.status === 'active' ? 'Join Live' : 'Join'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}