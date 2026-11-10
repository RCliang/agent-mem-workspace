import { Plug2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, type Info, type LlmMode, type LlmSettings } from '../api';
import { useI18n, type MessageKey } from '../i18n';
import { Button, cx } from '../ui';
import { useToast } from './Toasts';

const MODES: { id: LlmMode; label: MessageKey; help: MessageKey }[] = [
  { id: 'auto', label: 'api.modeAuto', help: 'api.modeAutoHelp' },
  { id: 'local', label: 'api.modeLocal', help: 'api.modeLocalHelp' },
  { id: 'api', label: 'api.modeApi', help: 'api.modeApiHelp' },
];

const fieldClass = 'h-9 w-full rounded-full border border-ink-600 bg-ink-900 px-3 text-[13px] text-paper placeholder:text-paper-mute disabled:bg-ink-850 disabled:text-paper-dim';

export function ApiSettings({ onInfo }: { onInfo: (info: Info) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<LlmMode>('auto');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: true; model: string; reply: string } | { ok: false; message: string } | null>(null);

  const apply = useCallback((next: LlmSettings) => {
    setSettings(next);
    setBaseUrl(next.env.baseUrl ? next.effective.baseUrl : next.saved.baseUrl);
    setModel(next.env.model ? next.effective.model : next.saved.model);
    setMode(next.env.mode ? next.effective.mode : next.saved.mode);
    setApiKey('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .llm()
      .then((next) => {
        if (!cancelled) apply(next);
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  async function refreshInfo() {
    onInfo(await api.info());
  }

  async function save(clearKey = false) {
    if (!settings) return;
    setSaving(true);
    setTestResult(null);
    try {
      const next = await api.saveLlm({
        ...(settings.env.baseUrl ? {} : { baseUrl }),
        ...(settings.env.model ? {} : { model }),
        ...(settings.env.mode ? {} : { mode }),
        ...(clearKey ? { clearKey: true } : apiKey.trim() ? { apiKey } : {}),
      });
      apply(next);
      await refreshInfo();
      toast({ tone: 'ok', message: clearKey ? t('api.keyRemoved') : t('api.saved') });
    } catch (error) {
      toast({ tone: 'error', message: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function testCall() {
    if (!settings) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testLlm({
        ...(settings.env.baseUrl ? {} : { baseUrl }),
        ...(settings.env.model ? {} : { model }),
        ...(apiKey.trim() ? { apiKey } : {}),
      });
      setTestResult({ ok: true, model: result.model, reply: result.reply });
    } catch (error) {
      setTestResult({ ok: false, message: (error as Error).message });
    } finally {
      setTesting(false);
    }
  }

  if (loadError) {
    return <p className="m-4 border-y border-danger/40 bg-danger/8 px-4 py-3 text-[13px] text-danger">{t('api.loadError', { message: loadError })}</p>;
  }
  if (!settings) return <div className="m-4 h-40 animate-pulse rounded-lg bg-ink-900" />;

  const locked = [
    settings.env.baseUrl ? 'AGENT_MEM_LLM_BASE_URL' : '',
    settings.env.model ? 'AGENT_MEM_LLM_MODEL' : '',
    settings.env.apiKey ? 'AGENT_MEM_LLM_API_KEY' : '',
    settings.env.mode ? 'AGENT_MEM_LLM_MODE' : '',
  ].filter(Boolean);
  const testMessage = !testResult ? null : testResult.ok ? t('api.testOk', { model: testResult.model, reply: testResult.reply }) : t('api.testFail', { message: testResult.message });
  const modeHelp = MODES.find((item) => item.id === mode)?.help ?? 'api.modeAutoHelp';
  const keyStatus = settings.env.apiKey
    ? t('api.sourceEnv')
    : settings.saved.hasKey
      ? settings.saved.keyHint
        ? t('api.keyHint', { hint: settings.saved.keyHint })
        : t('api.sourceSaved')
      : t('api.noKey');

  return (
    <div className="h-full overflow-auto">
      <form
        className="mx-auto flex max-w-[68ch] flex-col gap-8 px-5 py-8 sm:px-8 sm:py-10"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <Plug2 className="size-5 text-signal" aria-hidden />
            <h1 className="text-[22px] leading-7 font-semibold tracking-tight text-paper">{t('api.title')}</h1>
          </div>
          <p className="text-[14px] leading-6 text-paper-dim">{t('api.intro')}</p>
        </header>

        {locked.length > 0 && <p className="border-y border-ink-700 py-3 text-[13px] leading-5 text-warn">{t('api.envNote', { names: locked.join(', ') })}</p>}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[13px] font-medium text-paper">{t('api.mode')}</legend>
          <div role="radiogroup" aria-label={t('api.mode')} className="grid grid-cols-3 gap-1 rounded-full border border-ink-600 bg-ink-900 p-0.5">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={mode === item.id}
                disabled={settings.env.mode || saving}
                onClick={() => setMode(item.id)}
                className={cx(
                  'hit-target min-h-8 rounded-full px-2 text-[12px] font-medium sm:text-[13px]',
                  mode === item.id ? 'bg-ink-700 text-paper' : 'text-paper-mute hover:text-paper',
                )}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          <p className="text-[13px] leading-5 text-paper-mute">{t(modeHelp)}</p>
        </fieldset>

        <div className="flex flex-col gap-6 border-t border-ink-700 pt-6">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-paper">{t('api.baseUrl')}</span>
            <input
              value={baseUrl}
              disabled={settings.env.baseUrl || saving}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={settings.defaults.baseUrl}
              autoComplete="off"
              spellCheck={false}
              className={fieldClass}
            />
            <span className="text-[12px] leading-5 text-paper-mute">{t('api.baseUrlHelp')}</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-paper">{t('api.model')}</span>
            <input
              value={model}
              disabled={settings.env.model || saving}
              onChange={(event) => setModel(event.target.value)}
              placeholder={settings.defaults.model}
              autoComplete="off"
              spellCheck={false}
              className={cx(fieldClass, 'font-mono')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-paper">{t('api.key')}</span>
            <input
              type="password"
              value={settings.env.apiKey ? '' : apiKey}
              disabled={settings.env.apiKey || saving}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.env.apiKey ? t('api.keyFromEnv') : settings.saved.hasKey ? t('api.keyKeep') : t('api.keyPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              className={cx(fieldClass, 'font-mono')}
            />
            <span className="text-[12px] leading-5 text-paper-mute">{keyStatus}</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={saving || testing}>
            {saving ? t('api.saving') : t('api.save')}
          </Button>
          <Button type="button" disabled={saving || testing || (!settings.effective.hasKey && !apiKey.trim())} onClick={() => void testCall()}>
            {testing ? t('api.testing') : t('api.test')}
          </Button>
          {settings.saved.hasKey && !settings.env.apiKey && (
            <Button type="button" variant="quiet" disabled={saving || testing} onClick={() => void save(true)}>
              {t('api.clearKey')}
            </Button>
          )}
        </div>

        {testMessage && (
          <p role="status" className={cx('border-y py-3 text-[13px] leading-5', testResult?.ok ? 'border-ok/40 text-ok' : 'border-danger/40 text-danger')}>
            {testMessage}
          </p>
        )}
      </form>
    </div>
  );
}
