import { createContext, useContext, useMemo } from 'react';

// Who the viewer is, for the round cards buried several levels down the
// source → year → card tree. Context rather than props because the answer is
// the same for every card and threading it through each grouping component
// would add noise at four levels for no benefit.
//
// This mirrors server/rounds.js, which is where the rules are actually
// enforced — these hooks only decide what to render.

const RoundPermissionsContext = createContext({ isAdmin: false, email: null });

export function RoundPermissionsProvider({ user, children }) {
  const value = useMemo(() => ({
    isAdmin: user?.role === 'admin',
    email: user?.email || null,
  }), [user?.role, user?.email]);
  return (
    <RoundPermissionsContext.Provider value={value}>
      {children}
    </RoundPermissionsContext.Provider>
  );
}

export function useRoundPermissions(round) {
  const { isAdmin, email } = useContext(RoundPermissionsContext);
  return useMemo(() => {
    // Mirrors ownsRound() in server/rounds.js — server-written fields only.
    const owner = round?.owner_email || round?.created_by;
    const isMine = Boolean(owner && email && owner.toLowerCase() === email.toLowerCase());
    const isPublic = round?.is_public !== false;
    return {
      isAdmin,
      isMine,
      isPublic,
      // Admins manage everything; players only their own private packets.
      canManage: isAdmin || (isMine && !isPublic),
      // Publishing is admin-only.
      canPublish: isAdmin,
    };
  }, [round, isAdmin, email]);
}
