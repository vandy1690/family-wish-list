// Local testing switches (plain files instead of Blob, sign-in links shown on the page, a
// stand-in store on 127.0.0.1, cookies over plain http) only work inside dev/server.mjs, which
// sets globalThis.WL_DEV before loading any route. An environment variable alone can never turn
// one on, so a server set up some other way, on Vercel or anywhere else, cannot run in test mode.
export const devMode = () => globalThis.WL_DEV === true && !process.env.VERCEL;
