let oidcClient = null;

export const setOidcClient = client => {
  oidcClient = client;
};

export const getOidcClient = () => oidcClient;
