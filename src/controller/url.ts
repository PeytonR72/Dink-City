// Shared only by browser entries. The phone never imports the game or Court connection.
export function controllerUrl(code: string, role: 'screen' | 'phone'): string {
  const host: string = import.meta.env.VITE_PARTY_HOST ?? 'localhost:8787';
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return (local ? 'ws://' : 'wss://') + host + '/parties/controller/' + encodeURIComponent(code) + '?role=' + role;
}
