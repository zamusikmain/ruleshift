// Paste into DevTools Sources > Snippets on the staging origin. Not bundled or deployed.
// Recovery codes are returned only to the caller: do not share console/session exports.
(() => {
  const allowed = 'https://ruleshift-2-staging.zamusik-play.workers.dev';
  if (location.origin !== allowed) throw new Error('Staging origin required');
  const decode = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const encode = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function api(path, body) {
    const response = await fetch(path, {credentials:'same-origin',cache:'no-store',...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const result = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error ?? 'requestFailed'}`);
    return result;
  }
  function serialize(c) {
    if (typeof c.toJSON === 'function') return c.toJSON();
    const r = c.response, response = {clientDataJSON:encode(r.clientDataJSON)};
    if (r.attestationObject) {response.attestationObject=encode(r.attestationObject);response.transports=r.getTransports?.()??[];}
    else {response.authenticatorData=encode(r.authenticatorData);response.signature=encode(r.signature);if(r.userHandle)response.userHandle=encode(r.userHandle);}
    return {id:c.id,rawId:encode(c.rawId),type:c.type,clientExtensionResults:c.getClientExtensionResults(),response,...(c.authenticatorAttachment?{authenticatorAttachment:c.authenticatorAttachment}:{})};
  }
  async function create(options) {
    options.challenge=decode(options.challenge);options.user.id=decode(options.user.id);
    for(const c of options.excludeCredentials??[])c.id=decode(c.id);
    const credential=await navigator.credentials.create({publicKey:options});
    if(!credential)throw new Error('No credential');
    return api('/api/auth/register/verify',{response:serialize(credential)});
  }
  window.ruleshiftQa=Object.freeze({
    register: async name => create(await api('/api/auth/register/options',{name})),
    login: async () => {
      const options=await api('/api/auth/login/options',{});options.challenge=decode(options.challenge);
      for(const c of options.allowCredentials??[])c.id=decode(c.id);
      const credential=await navigator.credentials.get({publicKey:options});
      if(!credential)throw new Error('No credential');
      return api('/api/auth/login/verify',{response:serialize(credential)});
    },
    recover: async code => create(await api('/api/auth/recover',{code})),
    me: () => api('/api/account/me'),
    ranking: (mode='overall',season='lifetime') => api(`/api/leaderboard/me?mode=${encodeURIComponent(mode)}&season=${encodeURIComponent(season)}`),
    logout: () => api('/api/auth/logout',{}),
    deleteAccount: () => api('/api/account/delete',{confirm:true})
  });
})();
