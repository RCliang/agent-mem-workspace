import { useEffect, useState, type FormEvent } from 'react';
import { api, type LlmSettingsView } from '../api';
import { useI18n } from '../i18n';
import { Button } from '../ui';

export function Settings({ onSaved }: { onSaved: () => void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<LlmSettingsView | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void api.llmSettings().then((value) => { if (active) setSettings(value); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  const update = (value: Partial<LlmSettingsView>) => {
    setSettings((current) => current ? { ...current, ...value } : current);
    setSaved(false);
  };
  async function persist(reset: boolean) {
    if (!settings && !reset) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const result = reset ? await api.resetLlmSettings() : await api.saveLlmSettings({
        mode: settings!.mode, baseUrl: settings!.baseUrl, model: settings!.model, apiKey, clearApiKey,
      });
      setSettings(result); setApiKey(''); setClearApiKey(false); setSaved(true); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const inputClass = 'w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-paper focus:border-signal focus:outline-none';
  return (
    <div className="h-full overflow-auto p-5 sm:p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-paper">{t('settings.title')}</h1>
          <p className="mt-2 text-sm leading-6 text-paper-mute">{t('settings.description')}</p>
        </header>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {!settings && !error && <p role="status">{t('settings.loading')}</p>}
        {!settings && error && <Button disabled={busy} onClick={() => void persist(true)}>{t('settings.reset')}</Button>}
        {settings && <form className="space-y-5" onSubmit={(event: FormEvent) => { event.preventDefault(); void persist(false); }}>
          <p className="text-xs text-paper-mute">{t('settings.source')}: {t(`settings.${settings.source}`)}</p>
          <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
            <label className="block space-y-2 text-sm text-paper-dim">
              <span>{t('settings.mode')}</span>
              <select className={inputClass} value={settings.mode} onChange={(e) => {
                const mode = e.target.value;
                if (mode === 'auto' || mode === 'local' || mode === 'api') update({ mode });
              }}>
                <option value="auto">{t('settings.auto')}</option>
                <option value="local">{t('settings.local')}</option>
                <option value="api">{t('settings.api')}</option>
              </select>
            </label>
            <p className="text-xs leading-5 text-paper-mute">{t(`settings.${settings.mode}Help`)}</p>
            <label className="block space-y-2 text-sm text-paper-dim">
              <span>Base URL</span>
              <input required type="url" className={inputClass} value={settings.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
              <span className="block text-xs text-paper-mute">{t('settings.urlHelp')}</span>
            </label>
            <label className="block space-y-2 text-sm text-paper-dim">
              <span>{t('settings.model')}</span>
              <input required className={inputClass} value={settings.model} onChange={(e) => update({ model: e.target.value })} placeholder="gpt-4o-mini" />
            </label>
            <label className="block space-y-2 text-sm text-paper-dim">
              <span>API Key · {t(settings.hasApiKey ? 'settings.keyConfigured' : 'settings.keyMissing')}</span>
              <input type="password" autoComplete="new-password" spellCheck={false} disabled={clearApiKey} className={inputClass} value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setSaved(false); }} placeholder={t('settings.keyHelp')} />
            </label>
            {settings.hasApiKey && <label className="flex items-center gap-2 text-sm text-paper-dim">
              <input type="checkbox" checked={clearApiKey} onChange={(e) => { setClearApiKey(e.target.checked); setSaved(false); }} />{t('settings.clearKey')}
            </label>}
            <p className="rounded-lg border border-ink-700 p-3 text-xs leading-5 text-paper-mute">{t('settings.storage')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary">{t(busy ? 'settings.saving' : 'settings.save')}</Button>
              <Button type="button" onClick={() => void persist(true)}>{t('settings.reset')}</Button>
              {saved && <span role="status" className="text-sm text-signal">{t('settings.saved')}</span>}
            </div>
          </fieldset>
        </form>}
      </div>
    </div>
  );
}
