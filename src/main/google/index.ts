// Google integration entry point — a modular OAuth 2.0 (Authorization Code +
// PKCE) subsystem with the auth core decoupled from the per-product API
// modules (Gmail / Drive / Calendar). See ./auth for the flow and ./apis for
// the products. Register all IPC in one call from the main process.
export { registerGoogleIpc } from './ipc'
export type { GoogleApiId } from './auth'
