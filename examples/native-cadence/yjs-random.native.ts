// App-owned adapter for the getRandomValues import in lib0/random, used by Yjs
// for client IDs. Expo throws if its native RNG is unavailable. This does not
// install a global crypto object or implement WebCrypto's subtle API.
export { getRandomValues } from "expo-crypto";
