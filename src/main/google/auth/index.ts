// Public surface of the Google auth core. API modules and IPC import from here.
export { connect, disconnect, status, setCredentials, ensureConnected } from './authService'
export type { ConnectResult, AuthStatus } from './authService'
export { getAccessToken, NeedsReauthError } from './tokenManager'
export { isEncryptionAvailable } from './secureStore'
export { ALL_API_IDS, API_SCOPES, apiIsGranted } from './scopes'
export type { GoogleApiId } from './scopes'
