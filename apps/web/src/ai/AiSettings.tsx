// Settings → AI: LM Studio on this computer, the default,
// or OpenRouter, hosted; the model; and the operation set, guessed from the
// model's size unless chosen. LM Studio must have CORS on, and the help text
// says how in LM Studio's own words, and why to stop its server when the app
// is not in use. An OpenRouter key is typed in once, kept on this device only
// and never shown again; "Forget key" removes it.
import { commands } from '@shellnote/editor'
import { guessCaps, pageFor } from '@shellnote/providers'
import { KeyRound } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchModels, forgetKey, LM_STUDIO, loadSettings, onSettings, saveKey, savedKey, saveSettings, withModel, type AiSettings, type Listed, type Provider } from './settings.js'

const SERVERS: [Provider, string][] = [
  ['lmstudio', 'LM Studio, on this computer'],
  ['openrouter', 'OpenRouter, hosted'],
]

export function AiSettingsPart() {
  const [settings, setSettings] = useState(loadSettings)
  // A model chosen elsewhere (the agent's ai.useModel) shows here too.
  useEffect(() => onSettings(() => setSettings(loadSettings())), [])
  const [address, setAddress] = useState(settings.baseUrl)
  const [hasKey, setHasKey] = useState(() => savedKey() !== undefined)
  // The key kept by Windows is known a moment after the app starts, and may change in another window.
  useEffect(() => onSettings(() => setHasKey(savedKey() !== undefined)), [])
  const [typedKey, setTypedKey] = useState('')
  const [models, setModels] = useState<Listed[]>()
  const [filter, setFilter] = useState('')
  const [problem, setProblem] = useState<string>()
  const [finding, setFinding] = useState(false)

  const change = (next: AiSettings): void => {
    setSettings(next)
    saveSettings(next)
  }

  /** The models the chosen server offers. Only the latest asking counts: a slow answer from the server chosen before is dropped. */
  const asking = useRef(0)
  const find = useCallback(async (provider: Provider, baseUrl: string): Promise<void> => {
    const ask = ++asking.current
    setFinding(true)
    setProblem(undefined)
    try {
      const listed = await fetchModels(provider, baseUrl)
      if (ask === asking.current) setModels(listed)
    } catch {
      if (ask !== asking.current) return
      setModels(undefined)
      setProblem(provider === 'lmstudio' ? `LM Studio did not answer at ${baseUrl}. Is its server running, with CORS on (see below)?` : "OpenRouter's list of models could not be read. Check the connection, then try again.")
    } finally {
      if (ask === asking.current) setFinding(false)
    }
  }, [])
  // Asked when the server changes; after the address changes, by its button, not at every letter typed.
  useEffect(() => {
    void find(settings.provider, settings.baseUrl)
  }, [settings.provider, find])

  const chooseServer = (provider: Provider): void => {
    if (provider === settings.provider) return
    setModels(undefined)
    setFilter('')
    change({ provider, baseUrl: settings.baseUrl, model: '' })
  }
  /** A model chosen from the list (ai.useModel); none chosen is the settings' own. */
  const chooseModel = (id: string): void => {
    if (id === '') change(withModel(settings, '', undefined))
    else commands.tap('ai.useModel', { model: id })
  }
  const useAddress = (): void => {
    const baseUrl = address.trim() === '' ? LM_STUDIO : address.trim()
    setAddress(baseUrl)
    change({ ...settings, baseUrl })
    void find('lmstudio', baseUrl)
  }
  const keepKey = (): void => {
    if (typedKey.trim() === '') return
    saveKey(typedKey)
    setTypedKey('')
    setHasKey(true)
  }

  const shown = (models ?? []).filter((m) => filter === '' || m.label.toLowerCase().includes(filter.toLowerCase()))
  // The chosen model stays in the list even while the server cannot be reached.
  const options = settings.model !== '' && !shown.some((m) => m.id === settings.model) ? [{ id: settings.model, label: settings.model }, ...shown] : shown
  const guessed = settings.model === '' ? undefined : guessCaps(settings.model).opSet
  const guessedPage = settings.model === '' ? undefined : pageFor(settings.model)

  return (
    <section className="settings-part" aria-label="AI">
      <h3>AI</h3>
      <div className="segmented" role="radiogroup" aria-label="AI server">
        {SERVERS.map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={settings.provider === value} onClick={() => chooseServer(value)}>
            {label}
          </button>
        ))}
      </div>

      {settings.provider === 'lmstudio' ? (
        <label className="settings-field">
          <span>Address</span>
          <span className="settings-row">
            <input
              type="url"
              value={address}
              spellCheck={false}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') useAddress()
              }}
            />
            <button type="button" className="button" disabled={finding} onClick={useAddress}>
              {finding ? 'Asking…' : 'Find models'}
            </button>
          </span>
        </label>
      ) : (
        <div className="settings-field">
          <span>Key</span>
          {hasKey ? (
            <span className="settings-row">
              <span className="settings-line settings-key">
                <KeyRound size={16} aria-hidden className="ok" />
                <span>A key is kept on this device.</span>
              </span>
              <button
                type="button"
                className="button"
                onClick={() => {
                  forgetKey()
                  setHasKey(false)
                }}
              >
                Forget key
              </button>
            </span>
          ) : (
            <span className="settings-row">
              <input
                type="password"
                aria-label="OpenRouter key"
                placeholder="sk-or-…"
                autoComplete="off"
                spellCheck={false}
                value={typedKey}
                onChange={(event) => setTypedKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') keepKey()
                }}
              />
              <button type="button" className="button" disabled={typedKey.trim() === ''} onClick={keepKey}>
                Keep key
              </button>
            </span>
          )}
        </div>
      )}

      <label className="settings-field">
        <span>Model</span>
        {settings.provider === 'openrouter' && models && models.length > 20 ? (
          <input type="search" placeholder="Filter models" aria-label="Filter models" value={filter} onChange={(event) => setFilter(event.target.value)} />
        ) : null}
        <select aria-label="Model" value={settings.model} data-command="ai.useModel" onChange={(event) => chooseModel(event.target.value)}>
          <option value="">{finding ? 'Finding models…' : 'Choose a model'}</option>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {problem ? (
        <p className="settings-answer" role="alert">
          {problem}
        </p>
      ) : null}

      <label className="settings-field">
        <span>Operations</span>
        <select
          aria-label="Operations"
          value={settings.opSet ?? ''}
          onChange={(event) => {
            const next: AiSettings = { ...settings }
            delete next.opSet
            change(event.target.value === 'small' || event.target.value === 'full' ? { ...next, opSet: event.target.value } : next)
          }}
        >
          <option value="">Guess from the model's size{guessed ? ` (${guessed} set)` : ''}</option>
          <option value="small">Small set: style, mark, rewrite, insert, delete</option>
          <option value="full">Full set: also move, convert and calculate</option>
        </select>
      </label>

      <label className="settings-field">
        <span>Terminal page</span>
        <select
          aria-label="Terminal page"
          value={settings.page ?? ''}
          onChange={(event) => {
            const next: AiSettings = { ...settings }
            delete next.page
            change(event.target.value === 'overall' || event.target.value === 'small' ? { ...next, page: event.target.value } : next)
          }}
        >
          <option value="">By the model's size{guessedPage ? ` (${guessedPage === 'small' ? 'small models' : 'every model'})` : ''}</option>
          <option value="overall">The page for every model</option>
          <option value="small">The small models' page: the app's state in plain sentences</option>
        </select>
      </label>

      {settings.provider === 'lmstudio' ? (
        <>
          <p className="settings-hint">
            LM Studio must let this page call it: in LM Studio, <strong>Developer tab → Server Settings → Enable CORS</strong>; or, from a terminal, <code>lms server start --cors</code>.
          </p>
          <p className="settings-hint">
            Stop LM Studio's server when you are not using the app (switch <strong>Status: Running</strong> off in the Developer tab, or run <code>lms server stop</code>), because with CORS on, other websites open in Edge could also call your local models.
          </p>
        </>
      ) : (
        <p className="settings-hint">The key stays on this device and goes only to openrouter.ai. It is never put in a note, the library or the AI log. Hosted models cost money: the AI log shows what each request cost.</p>
      )}
    </section>
  )
}
