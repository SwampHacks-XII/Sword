import type { PopupConfigOptions, PopupLoginOptions } from '@auth0/auth0-react';
import { loginOptions } from './errors';

interface PopupLoginDependencies {
  open(): Window | null;
  track(popup: Window | null): void;
  authenticate(options: PopupLoginOptions, config: PopupConfigOptions): Promise<void>;
}

/** Keep one authentication transaction alive, even across rapid or repeated clicks. */
export function createPopupLogin(dependencies: PopupLoginDependencies) {
  let pending: Promise<void> | null = null;
  let popup: Window | null = null;
  return (mode: 'login' | 'signup' = 'login'): Promise<void> => {
    if (pending) {
      popup?.focus();
      return pending;
    }
    pending = loginInPopup(mode, {
      ...dependencies,
      track: value => { popup = value; dependencies.track(value); },
    }).finally(() => { pending = null; });
    return pending;
  };
}

/** Open synchronously in the click handler, then let Auth0 verify the response. */
export async function loginInPopup(mode: 'login' | 'signup', dependencies: PopupLoginDependencies) {
  const popup = dependencies.open();
  if (!popup) throw Object.assign(new Error('The sign-in window could not open.'), { error: 'popup_open' });
  dependencies.track(popup);
  try {
    await dependencies.authenticate({ authorizationParams: loginOptions(mode).authorizationParams }, {
      popup, timeoutInSeconds: 300,
    });
  } finally {
    popup.close();
    dependencies.track(null);
  }
  // auth0-react reports some popup failures through context instead of rejecting.
  // Navigate only after that context confirms authentication, never here.
}
