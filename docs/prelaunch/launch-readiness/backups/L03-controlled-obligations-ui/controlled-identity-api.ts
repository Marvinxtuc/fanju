export interface ControlledPrincipal {
  id: string; personId: string; role: "OPS" | "REVIEWER" | "RESTAURANT";
  userId: null; restaurantId: string | null; version: number;
}
type Transport = (path: string, options: RequestInit) => Promise<{ status: number; data: unknown }>;
function principal(value: unknown): ControlledPrincipal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("身份响应格式错误");
  const p = value as Record<string, unknown>;
  const identifier = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 160;
  if (!identifier(p.id) || !identifier(p.personId) || !["OPS", "REVIEWER", "RESTAURANT"].includes(String(p.role))
    || p.userId !== null || !Number.isInteger(p.version) || (p.version as number) < 0
    || (p.role === "RESTAURANT" ? !identifier(p.restaurantId) : p.restaurantId !== null)) throw Error("身份响应格式错误");
  return { id: p.id, personId: p.personId, role: p.role as ControlledPrincipal["role"], userId: null,
    restaurantId: p.restaurantId as string | null, version: p.version as number };
}
function envelope(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || (value as Record<string, unknown>).version !== "v11-identity-1")
    throw Error("身份接口版本不兼容");
  return value as Record<string, unknown>;
}
export function createControlledIdentityClient(transport: Transport) {
  let generation = 0;
  let session: { token: string; principal: ControlledPrincipal } | null = null;
  async function request(path: string, options: RequestInit) {
    const response = await transport(path, options);
    if (response.status < 200 || response.status >= 300) throw Error(response.status === 401 ? "登录已失效或账号密码错误" : "身份服务暂不可用");
    return envelope(response.data);
  }
  return {
    // Tokens stay in this closure; callers receive only the safe principal projection.
    current: () => session ? { ...session.principal } : null,
    logout() { generation++; session = null; },
    async login(username: string, password: string) {
      const epoch = ++generation; session = null;
      const data = await request("/api/v11/ops/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (generation !== epoch) throw Error("登录请求已取消");
      if (typeof data.token !== "string" || !data.token || data.token.length > 8192) throw Error("身份响应格式错误");
      const initial = principal(data.principal);
      const checked = await request("/api/v11/ops/identity", { method: "GET", headers: { authorization: `Bearer ${data.token}` } });
      if (generation !== epoch) throw Error("登录请求已取消");
      const verified = principal(checked.principal);
      if (JSON.stringify(initial) !== JSON.stringify(verified)) throw Error("身份绑定已变更，请重新登录");
      session = { token: data.token, principal: verified };
      return { ...verified };
    },
    async refresh() {
      const epoch = generation; const captured = session;
      if (!captured) throw Error("请先登录");
      try {
        const data = await request("/api/v11/ops/identity", { method: "GET", headers: { authorization: `Bearer ${captured.token}` } });
        if (generation !== epoch || session !== captured) throw Error("身份请求已取消");
        const verified = principal(data.principal);
        if (JSON.stringify(captured.principal) !== JSON.stringify(verified)) throw Error("身份绑定已变更，请重新登录");
        return { ...verified };
      } catch (error) {
        if (generation === epoch && session === captured) { generation++; session = null; }
        throw error;
      }
    },
  };
}
export function browserControlledIdentityClient() {
  const base = import.meta.env.VITE_API_BASE_URL ?? window.location.origin;
  const url = new URL(base, window.location.origin);
  if (url.protocol !== "https:" && !(import.meta.env.DEV && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    throw Error("受控登录需要安全连接");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw Error("身份服务地址格式错误");
  return createControlledIdentityClient(async (path, options) => {
    const response = await fetch(`${url.origin}${path}`, { ...options, credentials: "omit", redirect: "error", cache: "no-store" });
    return { status: response.status, data: await response.json().catch(() => null) };
  });
}
