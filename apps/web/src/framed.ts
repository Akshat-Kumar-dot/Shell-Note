// ShellNote never runs inside another page. A site that showed it in a frame could lay its own page over it and
// have a person's clicks land on ShellNote's buttons unseen. A site can forbid being framed only with a header, and
// the website's host sends none of the site's own, so the page looks for itself: in a frame, it draws nothing.
// (Browsers also give a framed site a storage of its own, empty: the notes and the keys are not in it.)

/** Whether the page is inside another page's frame. A page that cannot tell is taken to be. */
export function inAFrame(view: { readonly top: unknown; readonly self: unknown } = window): boolean {
  try {
    return view.top !== view.self
  } catch {
    return true
  }
}

/** What a framed page says in place of the app, as plain words. */
export const FRAMED = 'ShellNote does not open inside another page. Open it in a tab of its own.'
