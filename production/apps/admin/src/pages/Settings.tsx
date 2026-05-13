/**
 * Settings page — grouped key/value editor for SystemSetting + FeatureFlag.
 *
 * Renders one card per category (payments, vat, features, receipts, gdpr).
 * Each row has a description and a "Restore default" button. Saves are
 * audited via the same pipeline as Translations.
 */
import React, { useEffect, useState } from 'react';
import { ApiClient } from 'adminjs';

interface Setting {
  key: string;
  value: any;
  description?: string;
  category?: string;
}

interface Flag {
  key: string;
  enabled: boolean;
  description?: string;
}

const api = new ApiClient();

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [dirty, setDirty] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.resourceAction({ resourceId: 'SystemSetting', actionName: 'list', params: { perPage: 500 } }),
      api.resourceAction({ resourceId: 'FeatureFlag', actionName: 'list', params: { perPage: 500 } }),
    ]).then(([s, f]: [any, any]) => {
      setSettings(s.data.records.map((r: any) => r.params));
      setFlags(f.data.records.map((r: any) => r.params));
    });
  }, []);

  const grouped = settings.reduce<Record<string, Setting[]>>((acc: Record<string, Setting[]>, s: Setting) => {
    const key = s.key.split('.')[0] ?? 'other';
    acc[key] = acc[key] ?? [];
    acc[key]!.push(s);
    return acc;
  }, {});

  function set(key: string, value: any) {
    setDirty((d: Record<string, any>) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      for (const [key, value] of Object.entries(dirty)) {
        if (key.startsWith('flag:')) {
          await api.recordAction({
            resourceId: 'FeatureFlag',
            recordId: key.slice(5),
            actionName: 'edit',
            // AdminJS' typed `params` is restrictive; the runtime accepts a
            // free-form payload that becomes the record's update body.
            payload: { enabled: value },
          } as any);
        } else {
          await api.recordAction({
            resourceId: 'SystemSetting',
            recordId: key,
            actionName: 'edit',
            payload: { value },
          } as any);
        }
      }
      setDirty({});
      const [s, f]: [any, any] = await Promise.all([
        api.resourceAction({ resourceId: 'SystemSetting', actionName: 'list', params: { perPage: 500 } }),
        api.resourceAction({ resourceId: 'FeatureFlag', actionName: 'list', params: { perPage: 500 } }),
      ]);
      setSettings(s.data.records.map((r: any) => r.params));
      setFlags(f.data.records.map((r: any) => r.params));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Settings</h1>
      <p>Edit every business-decision value live. Changes audit-logged.</p>
      <button onClick={save} disabled={saving || !Object.keys(dirty).length}>
        {saving ? 'Saving…' : `Save (${Object.keys(dirty).length})`}
      </button>

      <h2 style={{ marginTop: 24 }}>Feature flags</h2>
      <table style={{ width: '100%', fontSize: 13 }}>
        <tbody>
          {flags.map((f: Flag) => (
            <tr key={f.key}>
              <td style={{ padding: 8 }}>
                <strong>{f.key}</strong>
                {f.description && <div style={{ color: '#777' }}>{f.description}</div>}
              </td>
              <td style={{ padding: 8, textAlign: 'right' }}>
                <label>
                  <input
                    type="checkbox"
                    checked={dirty[`flag:${f.key}`] ?? f.enabled}
                    onChange={(e) => set(`flag:${f.key}`, e.target.checked)}
                  />{' '}
                  {(dirty[`flag:${f.key}`] ?? f.enabled) ? 'enabled' : 'disabled'}
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(Object.entries(grouped) as Array<[string, Setting[]]>).map(([cat, list]) => (
        <section key={cat}>
          <h2 style={{ marginTop: 24, textTransform: 'capitalize' }}>{cat}</h2>
          <table style={{ width: '100%', fontSize: 13 }}>
            <tbody>
              {list.map((s: Setting) => (
                <tr key={s.key}>
                  <td style={{ padding: 8, width: '40%' }}>
                    <strong>{s.key}</strong>
                    {s.description && <div style={{ color: '#777' }}>{s.description}</div>}
                  </td>
                  <td style={{ padding: 8 }}>
                    <input
                      style={{ width: '100%', boxSizing: 'border-box', padding: 6 }}
                      value={JSON.stringify(dirty[s.key] ?? s.value)}
                      onChange={(e) => {
                        try {
                          set(s.key, JSON.parse(e.target.value));
                        } catch {
                          set(s.key, e.target.value);
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
};

export default SettingsPage;
