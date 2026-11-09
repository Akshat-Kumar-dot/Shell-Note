// A file's text, as Vite's ?raw import gives it: for tests that check the stylesheet.
declare module '*?raw' {
  const text: string
  export default text
}
