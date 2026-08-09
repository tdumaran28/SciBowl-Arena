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
import { Users, Plus, LogIn, Crown, Trophy, Zap, Copy, CheckCircle, LogOut, Globe, Lock, Unlock, Timer, Flag, BookOpen, RotateCcw, Sparkles, Swords } from 'lucide-react';
import { toast } from 'sonner';
import { buildMarathonPools, marathonQuestionAt, randomSeed } from '@/utils/marathon';
import { SCORING, applyQuestionRules, asBossUp, pairPositions } from '@/utils/parseRound';
import { deriveMatchState } from '@/utils/matchRules';
import MarathonSetup, { DEFAULT_MARATHON_CONFIG } from '@/components/game/MarathonSetup';
import GameKindSelect from '@/components/game/GameKindSelect';
import { syncClock, serverNow } from '@/lib/clock';

// Mirrors STALE_BUZZ_MS in server/match.js — the client only decides when to
// ask; the server decides whether the hold really is stale.
const STALE_BUZZ_MS = 15000;

const DEFAULT_SETTINGS = {
  read_aloud: false,
  wpm: 250,
  answer_time: 8,
  powers: false,
  boss_ups: false,
  skip_bonuses: false,
  subjects: [],
  question_types: ['TOSSUP', 'BONUS'],
  display_mode: 'word_by_word',
};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// How many bonus draws in a row a marathon will step over before giving up and
// playing one. Only reached by a pool that is almost entirely bonuses; the bonus
// it then lands on has no owner, so it reads as dead and anyone may advance.
const MARATHON_BONUS_SCAN = 50;

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

  const activeRound = useMemo(
    () => rounds.find(r => r.id === session?.round_id),
    [rounds, session?.round_id],
  );

  // Every client derives this list independently and indexes into it by the
  // shared current_question_index, so it has to come out identical everywhere —
  // hence one shared rule set (subject filter, boss-ups, skipped bonuses).
  //
  // Memoized because it is a packet-sized filter+map and `positions` below is
  // keyed on its identity: rebuilding it on every render (a buzz, a chat
  // message, a countdown tick) meant re-numbering the whole packet each time.
  const activeQuestions = useMemo(
    () => applyQuestionRules(activeRound?.questions, session?.settings || settings),
    [activeRound, session?.settings, settings],
  );

  const players = session?.players || [];
  const teams = session?.teams || [];
  const myTeam = players.find(p => p.user_id === myPlayerId)?.team || '';
  const isHost = session?.host_id === myPlayerId;
  const buzzState = session?.buzz_state || null;
  const currentIndex = session?.current_question_index || 0;

  // Marathon sessions carry no question list — every client derives the same
  // infinite sequence from the shared { seed, round_ids, subject_freq } config.
  const isMarathon = session?.game_type === 'marathon';
  // Keyed on the sampling config alone, not on `session`: the pool is a pass
  // over every question in every packet, and the whole session object changes
  // identity on each buzz, chat message and poll — which rebuilt it (and every
  // question lookup derived from it) many times a minute for no change at all.
  const marathonRoundIds = session?.round_ids;
  const marathonFilter = session?.round_filter;
  const marathonSubjectFreq = session?.subject_freq;
  const marathonTypes = session?.settings?.question_types;
  const marathonPools = useMemo(() => {
    if (!isMarathon) return null;
    return buildMarathonPools(rounds, {
      roundIds: marathonRoundIds || [],
      roundFilter: marathonFilter || 'all',
      questionTypes: marathonTypes || ['TOSSUP', 'BONUS'],
      subjectFreq: marathonSubjectFreq || {},
    });
  }, [isMarathon, rounds, marathonRoundIds, marathonFilter, marathonTypes, marathonSubjectFreq]);

  const bossUps = !!(session?.settings || settings)?.boss_ups;

  // Resolve any question index back to its question — marathon derives it from
  // the shared seed, round practice indexes the filtered list. Used for the
  // current question and by the side panel to reopen an already-played one.
  const getQuestionAt = useCallback((index) => {
    if (index == null || index < 0) return null;
    if (!isMarathon) return activeQuestions[index] || null;
    if (!marathonPools) return null;
    const q = marathonQuestionAt(marathonPools, session?.seed || 0, index);
    return bossUps ? asBossUp(q) : q;
  }, [isMarathon, marathonPools, session?.seed, activeQuestions, bossUps]);

  const totalQuestions = isMarathon ? Infinity : activeQuestions.length;
  const currentQuestion = getQuestionAt(currentIndex);
  const currentQuestionRef = useRef(null);
  currentQuestionRef.current = currentQuestion;

  // Counter numbering: round practice counts tossup/bonus pairs (12.T of 23);
  // marathon numbers the draws, since they are not paired.
  const positions = useMemo(() => pairPositions(activeQuestions), [activeQuestions]);
  const positionLabelAt = useCallback((index) => {
    if (index == null || index < 0) return null;
    if (!isMarathon) return positions.labels[index] ?? null;
    const q = getQuestionAt(index);
    return `${index + 1}.${(q?.original_type || q?.type) === 'BONUS' ? 'B' : 'T'}`;
  }, [isMarathon, positions, getQuestionAt]);
  const positionLabel = positionLabelAt(currentIndex);

  // Who may buzz, whether the question is over, who may advance it, and whether
  // the answer may be shown — all of it in src/utils/matchRules.js, which is
  // pure and is what server/match.test.js exercises directly.
  const {
    isBonusForOther, someoneElseBuzzed, iAmBuzzing,
    isBonusQ, questionDead, resolved, wrongLimit,
    canBuzz, canAnswerBonus, canAdvance, revealAnswer,
    bonusEarned, bonusOwnerPresent,
  } = deriveMatchState({ session, myPlayerId, question: currentQuestion });

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
      if (u.status === 'waiting' && (view === 'playing' || view === 'finished')) {
        // The host has taken the room back to selection to play another round.
        // My own results belong to the round that just ended: carrying them
        // into the next one left every non-host player's review showing the
        // previous round's questions, indexed against the new round's list.
        // (The host clears these in handlePlayAnotherRound; everyone else
        // arrives here instead.)
        setMyResults([]);
        setView('room');
      }
    };

    // Patch frames carry only the fields that changed — merge them onto the
    // session we already hold rather than replacing it.
    const applyPatch = (id, patch) => {
      if (cancelled || id !== sessionId || !patch) return;
      const merged = { ...(sessionRef.current || {}), ...patch };
      applyFull(merged);
    };

    const refetch = async () => {
      let found;
      try {
        const arr = await base44.entities.GameSession.filter({ id: sessionId }, '-created_date', 1);
        found = arr[0];
      } catch {
        return; // transient (offline, restarting, expired token) — the poll retries
      }
      if (found) { applyFull(found); return; }

      // A request that SUCCEEDED and found nothing is authoritative: this room
      // is gone. Live sessions are held in the server's own process, so a
      // restart, a redeploy, or an idle host spinning down takes every room with
      // it — routine on a free tier. Ignoring the empty result left the player
      // parked on a room that would never update again, with a buzzer that did
      // nothing and no hint as to why.
      if (cancelled || view === 'finished') return; // don't yank away a results screen
      toast.error('This room is no longer available — the server may have restarted.');
      sessionRef.current = null;
      setSession(null);
      setRoomCode('');
      setMyResults([]);
      setView('lobby');
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
      base44.multiplayer.leaveBeacon(sess.id);
    };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, [session?.id]);

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

  // Buzz in — tossups only. The buzz instant is stamped on the client (already
  // converted to the server's clock) and the server awards the buzz to the
  // earliest such instant within a short arbitration window, so the player who
  // actually hit the buzzer first wins, not the one with the shortest network
  // path. A bonus never comes through here: it belongs to a whole team, and a
  // claim would lock the rest of them out of it (see canAnswerBonus).
  const handleBuzz = useCallback(async (buzzedAt) => {
    const sess = sessionRef.current;
    if (!sess) return;
    // Re-derived from the room as it stands now rather than read from a value
    // captured when this callback was built, which can be a frame behind the
    // socket.
    const st = deriveMatchState({
      session: sess, myPlayerId, question: currentQuestionRef.current,
    });
    if (!st.canBuzz) return;
    try {
      const updated = await base44.multiplayer.buzz(sess.id, {
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
  }, [myPlayerId]);

  // Submit answer result (called from QuestionReader when I answered).
  // Scoring is applied server-side: two players resolving at nearly the same
  // moment used to clobber each other's score arrays through the generic PATCH.
  const handleAnswer = useCallback(async (result) => {
    const sess = sessionRef.current;
    if (!sess) return;
    try {
      const updated = await base44.multiplayer.answer(sess.id, {
        result: result.result,
        type: result.type,
        interrupted: !!result.interrupted,
        submitted_answer: result.submitted_answer ?? null,
        submitted_choice: result.submitted_choice ?? null,
        // Decides the wrong-answer limit that kills this tossup — the server has
        // no question list of its own to read the format from.
        question_format: result.question_format || currentQuestionRef.current?.format || '',
      });
      setSession(updated);
      sessionRef.current = updated;
      // Recorded only once the server has taken it. On a team bonus everyone on
      // the team submits and only the first is counted; recording optimistically
      // put the losing teammates' answers in their own post-game review as if
      // they had played, next to a score that never moved. `myResults` is only
      // read on the results screen, so there is nothing to be optimistic for.
      setMyResults(prev => [...prev, { ...result, questionIndex: currentIndex }]);
    } catch (err) {
      // A rejected answer (someone else holds the buzz, the question already
      // resolved) must not leave this client on stale state — take whatever the
      // server says is true and carry on from there.
      if (err.data?.session) {
        setSession(err.data.session);
        sessionRef.current = err.data.session;
      }
      // Say why it didn't count. On a bonus this is the ordinary outcome for
      // three players out of four — they all had a box open and one of them was
      // quicker — and silence there reads as the app having dropped the answer.
      if (err.status === 409) {
        toast(result.type === 'BONUS'
          ? 'A teammate got their answer in first'
          : 'That question had already been resolved', { duration: 2500 });
      } else {
        toast.error('Could not submit that answer — retrying from the room state');
      }
    }
  }, [currentIndex]);

  // Tossup timer elapsed with no correct answer → question is dead (shared).
  // The server decides what "dead" means for the current roster.
  //
  // Every client runs this timer and every client reports, deliberately: if
  // only one did and it disconnected, the question would never die and the room
  // would have nothing left to click. The call is idempotent server-side.
  const handleDead = useCallback(async () => {
    const sess = sessionRef.current;
    if (!sess) return;
    const bs = sess.buzz_state || {};
    if (bs.result === 'correct' || bs.dead) return;
    try {
      const updated = await base44.multiplayer.dead(sess.id, {
        is_bonus: currentQuestionRef.current?.type === 'BONUS',
      });
      setSession(updated);
      sessionRef.current = updated;
    } catch { /* another client's report will land; the poll reconciles */ }
  }, []);

  // Watchdog: a buzz held by someone who never answers locks the whole room out
  // — nobody else may buzz, and the question can never resolve. Every client
  // that is not the buzzer reports it once the hold is clearly stale; the
  // server decides whether it really is, so a report racing a real answer is
  // harmless.
  useEffect(() => {
    if (view !== 'playing') return;
    const holder = buzzState?.buzzed_player_id;
    if (!holder || holder === myPlayerId || buzzState?.result || buzzState?.dead) return;
    const heldSince = buzzState.buzzed_at || buzzState.reading_started_at || serverNow();
    const dueIn = Math.max(0, heldSince + STALE_BUZZ_MS - serverNow()) + 500;
    const timer = setTimeout(() => {
      base44.multiplayer.releaseBuzz(sessionRef.current?.id, {
        is_bonus: currentQuestionRef.current?.type === 'BONUS',
        question_format: currentQuestionRef.current?.format || '',
      }).then(updated => {
        if (!updated) return;
        setSession(updated);
        sessionRef.current = updated;
      }).catch(() => { /* another client's report will land */ });
    }, dueIn);
    return () => clearTimeout(timer);
  }, [view, buzzState?.buzzed_player_id, buzzState?.buzzed_at, buzzState?.result, buzzState?.dead, myPlayerId]);

  // Watchdog: a bonus whose whole team has left the room.
  //
  // Only the owning team's clients run a bonus's answer clock — everyone else is
  // locked out of it and their timer is stopped — so once the last of them goes,
  // nothing is left to report the timeout. Every remaining client already reads
  // the question as dead (bonusUnanswerable in matchRules.js) and so can advance
  // it, but the server should agree rather than leave it open forever. Guarded
  // and idempotent server-side, so all of them reporting is harmless.
  useEffect(() => {
    if (view !== 'playing') return;
    if (!isBonusQ || !bonusEarned || bonusOwnerPresent) return;
    if (buzzState?.dead || buzzState?.result) return;
    // Briefly delayed so a roster frame that arrives a beat before the rest of
    // the session doesn't kill a bonus its team is still holding.
    const timer = setTimeout(handleDead, 500);
    return () => clearTimeout(timer);
  }, [view, isBonusQ, bonusEarned, bonusOwnerPresent, buzzState?.dead, buzzState?.result, handleDead]);

  // Advance to next question. Who may press it is `canAdvance` (matchRules.js);
  // this decides WHERE to go — which is where the bonus rule lives, because a
  // bonus is only played by the team that won the tossup before it.
  const handleNext = useCallback(async () => {
    const sess = sessionRef.current;
    if (!sess) return;

    const bs = sess.buzz_state || {};
    // Did the question just played earn a bonus? Only a correct tossup does.
    const wasEarned = !!(bs.bonus_for_team || bs.bonus_for_player_id || bs.bonus_for_player);

    // Marathon: endless, and each index is drawn from (seed, k) rather than read
    // off a stored list — but a drawn BONUS is still a bonus. It belongs to the
    // team that won the draw before it, and if nobody won that draw there is no
    // one to read it to, so it is stepped over exactly as in round practice.
    if (sess.game_type === 'marathon') {
      let nextIdx = (sess.current_question_index || 0) + 1;
      let scanned = 0;
      while (!wasEarned && getQuestionAt(nextIdx)?.type === 'BONUS' && scanned++ < MARATHON_BONUS_SCAN) {
        nextIdx++;
      }
      try {
        const updated = await base44.multiplayer.next(sess.id, {
          next_index: nextIdx,
          // Carried only onto a bonus, and only one that was earned — the loop
          // above has already stepped past any that were not.
          keep_bonus_owner: getQuestionAt(nextIdx)?.type === 'BONUS',
        });
        setSession(updated);
        sessionRef.current = updated;
      } catch {
        toast.error('Could not advance — try again');
      }
      return;
    }

    const qs = applyQuestionRules(rounds.find(r => r.id === sess.round_id)?.questions, sess.settings);

    let nextIdx = (sess.current_question_index || 0) + 1;
    // Skip ALL consecutive unearned bonuses (covers bonus-after-bonus chains)
    while (nextIdx < qs.length && qs[nextIdx]?.type === 'BONUS' && !wasEarned) {
      nextIdx++;
    }

    try {
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
    } catch {
      toast.error('Could not advance — try again');
    }
  }, [rounds, getQuestionAt]);

  const handleLeave = async () => {
    // Remove myself from players; if only one (or fewer) remains, they win by default.
    if (session?.id) {
      await base44.multiplayer.leave(session.id).catch(() => {});
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
    const updated = await base44.multiplayer.sendChat(sess.id, { text });
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
    const reviewQuestions = myResults.map(r => getQuestionAt(r.questionIndex));
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
              {/* Leaving is leaving — it drops you from the roster and hands
                  the room to whoever is left (server/.../leave). It is not a
                  "close the room for everyone", and labelling it as one told
                  the host their players had been sent home when they hadn't. */}
              {isHost ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button className="flex-1" onClick={() => handlePlayAnotherRound('')}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {isMarathon ? 'New Marathon' : 'Play Another Round'}
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={handleLeave}>
                    <LogOut className="w-4 h-4 mr-2" /> Leave Room
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    The host can start another round with the same players.
                    You&apos;ll be pulled back into the room automatically if they play on.
                  </p>
                  <Button variant="ghost" size="sm" className="mt-3 text-muted-foreground" onClick={handleLeave}>
                    Leave this room
                  </Button>
                </>
              )}
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
          powers={!!session?.settings?.powers}
          bossUps={bossUps}
          positionLabels={myResults.map(r => positionLabelAt(r.questionIndex))}
        />
      </div>
    );
  }

  // ── Playing ───────────────────────────────────────────────────────────────
  if (view === 'playing') {
    // Frozen out (cannot buzz, reading pauses) when someone else is answering a
    // tossup or the bonus belongs to another team.
    const externalBuzzed = someoneElseBuzzed || (isBonusQ && isBonusForOther && !resolved);
    // Buzzing is for tossups only. A bonus belongs to a whole team, so instead of
    // a buzz every one of them gets an open answer box (`canAnswerBonus`) and
    // the first submission is the team's answer — see src/utils/matchRules.js.
    const buzzEnabled = canBuzz && !iAmBuzzing;
    const canInteract = iAmBuzzing || canAnswerBonus;
    const showLock = externalBuzzed;

    // Advancing a question that is still live is a skip (the host's escape
    // hatch), and says so.
    const advanceIsSkip = !resolved && !questionDead;

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
                {session?.settings?.powers && (
                  <Badge variant="outline" className="text-xs flex-shrink-0 text-primary border-primary/40">
                    <Sparkles className="w-3 h-3 mr-1" /> Powers
                  </Badge>
                )}
                {bossUps && (
                  <Badge variant="outline" className="text-xs flex-shrink-0 text-primary border-primary/40">
                    <Swords className="w-3 h-3 mr-1" /> Boss-ups
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isMarathon && (
                  <span className="text-xs text-muted-foreground">Q {positionLabel}/{positions.totalPairs}</span>
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
                  positionLabel={positionLabel}
                  totalPositions={isMarathon ? Infinity : positions.totalPairs}
                  settings={session?.settings || settings}
                  onAnswer={canInteract ? handleAnswer : () => {}}
                  onBuzz={buzzEnabled ? handleBuzz : undefined}
                  openAnswer={canAnswerBonus}
                  openAnswerTeam={buzzState?.bonus_for_team || null}
                  onDead={handleDead}
                  isBonusFor={isBonusQ ? (buzzState?.bonus_for_team || buzzState?.bonus_for_player || null) : null}
                  externalBuzzed={externalBuzzed}
                  buzzEnabled={buzzEnabled}
                  multiplayer
                  resolved={resolved}
                  readingStartedAt={buzzState?.reading_started_at || null}
                  buzzRevokedAt={buzzRevokedAt}
                />
                {/* The correct answer is only handed over once the question is
                    finished for EVERYONE — a wrong answer leaves it live for the
                    other teams, and showing the answer then would end it. */}
                <BuzzResultBanner
                  buzzState={buzzState}
                  dead={questionDead}
                  answer={currentQuestion?.answer}
                  revealAnswer={revealAnswer}
                  wrongLimit={wrongLimit}
                />
                {showLock && (
                  <BuzzLockOverlay buzzState={buzzState} myTeam={myTeam} myPlayerId={myPlayerId} />
                )}
                {canAdvance && (
                  <Button
                    onClick={handleNext}
                    size="lg"
                    variant={advanceIsSkip ? 'outline' : 'default'}
                    className="w-full font-semibold"
                  >
                    {advanceIsSkip
                      ? 'Skip Question →'
                      : isMarathon || currentIndex + 1 < activeQuestions.length
                        ? 'Next Question →'
                        : 'See Results'}
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
              getLabel={positionLabelAt}
              powers={!!session?.settings?.powers}
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
              {session?.settings?.powers && (
                <Badge variant="outline" className="text-xs text-primary border-primary/40">
                  <Sparkles className="w-3 h-3 mr-1" /> Powers +{SCORING.TOSSUP_POWER}
                </Badge>
              )}
              {bossUps && (
                <Badge variant="outline" className="text-xs text-primary border-primary/40">
                  <Swords className="w-3 h-3 mr-1" /> Boss-ups
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