import { useSyncExternalStore } from 'react';

export type MenuScreen = 'home' | 'login' | 'play' | 'practice';
function currentScreen(): MenuScreen {
  const value = window.location.hash.slice(1);
  return value === 'login' || value === 'play' || value === 'practice' ? value : 'home';
}
function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}
export const navigate = (screen: MenuScreen) => { window.location.hash = screen === 'home' ? '' : screen; };
export const useScreen = () => useSyncExternalStore(subscribe, currentScreen, (): MenuScreen => 'home');
