import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Home, Lobby } from './Lobby';
import { useNet } from './net';
import { Table } from './Table';

export function App() {
  const state = useNet();
  const snap = state.snap;
  const [toast, setToast] = useState<{ msg: string; at: number } | null>(null);

  useEffect(() => {
    if (!state.error) return;
    setToast(state.error);
    const t = setTimeout(() => setToast((x) => (x?.at === state.error!.at ? null : x)), 3200);
    return () => clearTimeout(t);
  }, [state.error]);

  let screen;
  if (!snap) screen = <Home state={state} />;
  else if (!snap.game) screen = <Lobby room={snap.room} you={snap.you} />;
  else screen = <Table snap={snap} />;

  return (
    <>
      {screen}
      <AnimatePresence>
        {state.status === 'reconnecting' && (
          <motion.div className="conn" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            Reconnecting…
          </motion.div>
        )}
      </AnimatePresence>
      <div className="toast-host" aria-live="assertive">
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.at}
              className="toast"
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            >
              {toast.msg}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
