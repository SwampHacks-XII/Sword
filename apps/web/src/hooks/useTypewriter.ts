import { useEffect, useState } from 'react';

/** Reveals `total` characters a few at a time, restarting when `resetKey` changes. Returns the count and a skip. */
export function useTypewriter(total: number, resetKey?: unknown) {
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    setVisible(0);
    const timer = window.setInterval(() => setVisible(count => {
      if (count >= total) { window.clearInterval(timer); return total; }
      return Math.min(total, count + 3);
    }), 23);
    return () => window.clearInterval(timer);
  }, [total, resetKey]);
  return [visible, () => setVisible(total)] as const;
}
