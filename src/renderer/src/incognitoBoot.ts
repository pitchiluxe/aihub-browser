// Side-effect module, imported before anything else in main.tsx: ES modules
// evaluate in import order, so the private-window storage overlay is in place
// before the store (or any other module) first touches localStorage.
import { bootIncognitoWindow } from './services/incognitoMode'

bootIncognitoWindow()
