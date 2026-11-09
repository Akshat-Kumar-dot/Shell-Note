// The words kept of each place of the programs written beside (stage 4, step 5), under the side panel's transcript, as a
// video's lines are: for the person to read and find again, each with its ↩ back to the place, by their own tap only.
import { useState, useSyncExternalStore } from 'react'
import type { EditorStore } from '../store.js'
import { programHost } from './host.js'
import { placeKey } from './moment.js'
import { goBack, placeWords } from './ProgramMarks.js'

export function ProgramWords({ store }: { store: EditorStore }) {
  const sources = useSyncExternalStore(store.subscribe, () => store.doc.programs)
  const host = useSyncExternalStore(programHost.subscribe, programHost.snapshot)
  const [cannot, setCannot] = useState<string>()
  const kept = (sources ?? []).filter((source) => (source.places?.length ?? 0) > 0)
  if (kept.length === 0) return null
  return (
    <section className="nw-program-words" aria-label="What the programs showed">
      {kept.map((source) => (
        <div key={source.id}>
          <h3>{source.title ?? source.program}</h3>
          <ol>
            {source.places!.map(({ place, words }) => {
              const key = placeKey(place)
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="nw-video-add"
                    title={`Back to ${placeWords(place, source)}`}
                    onClick={() => {
                      void goBack(host, source, place).then((went) => setCannot(went ? undefined : key))
                    }}
                  >
                    ↩ {placeWords(place, source)}
                  </button>
                  {cannot === key ? <span role="status"> It cannot go back there now: the program is closed, or that place has gone.</span> : null}
                  <p>{words}</p>
                </li>
              )
            })}
          </ol>
        </div>
      ))}
    </section>
  )
}
