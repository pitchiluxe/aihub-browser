/// <reference types="vite/client" />

// Vite's `?raw` suffix inlines a file as a string at build time — used to
// bundle the user manual into the app so it works offline and can be saved
// out as one self-contained file.
declare module '*.html?raw' {
  const content: string
  export default content
}

declare module '*?raw' {
  const content: string
  export default content
}
