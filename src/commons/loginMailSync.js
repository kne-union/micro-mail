const storageKey = 'micro-mail:login-mail-sync';

export const syncMailOnLogin = ({ ajax, userId }) => {
  if (!userId || sessionStorage.getItem(storageKey) === String(userId)) {
    return;
  }
  sessionStorage.setItem(storageKey, String(userId));
  ajax({ url: '/api/v1/mail-sync/login', method: 'POST' }).catch(e => console.error(e));
};

export const clearLoginMailSync = () => {
  sessionStorage.removeItem(storageKey);
};
