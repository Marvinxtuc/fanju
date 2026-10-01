import { useEffect, useRef, useState } from "react";
import { browserControlledIdentityClient, type ControlledPrincipal } from "./controlled-identity-api.js";

export function ControlledIdentityWorkspace(): JSX.Element {
  const client = useRef<ReturnType<typeof browserControlledIdentityClient> | null>(null);
  const epoch = useRef(0);
  const [identity, setIdentity] = useState<ControlledPrincipal | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { epoch.current++; client.current?.logout(); }, []);
  async function run(login: boolean) {
    const generation = ++epoch.current; setBusy(true); setError("");
    try {
      client.current ??= browserControlledIdentityClient();
      const task = login ? client.current.login(username, password) : client.current.refresh();
      setPassword("");
      const next = await task;
      if (epoch.current === generation) setIdentity(next);
    } catch (e) {
      if (epoch.current === generation) { setIdentity(null); setError(e instanceof Error ? e.message : "身份核验失败"); }
    } finally { if (epoch.current === generation) { setBusy(false); setPassword(""); } }
  }
  function logout() { epoch.current++; client.current?.logout(); setIdentity(null); setBusy(false); setPassword(""); setError(""); }
  return <main><h1>受控工作台</h1>
    {identity ? <section aria-label="当前身份"><p>角色：{identity.role === "OPS" ? "运营" : identity.role === "REVIEWER" ? "复核" : "餐厅"}</p>
      {identity.restaurantId && <p>授权餐厅：{identity.restaurantId}</p>}
      <p>业务功能尚未开放。</p><button disabled={busy} onClick={() => void run(false)}>重新核验身份</button></section>
      : <form onSubmit={e => { e.preventDefault(); void run(true); }}>
        <label>账号<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required maxLength={80} disabled={busy}/></label>
        <label>密码<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={256} disabled={busy}/></label>
        <button disabled={busy}>登录</button></form>}
    <button onClick={logout}>退出登录</button>{error && <p role="alert">{error}</p>}
  </main>;
}
