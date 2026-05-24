/**
 * Bank-transfer reconciliation page.
 *
 * Finance staff drops a daily camt.054 / Tilisiirto CSV here. The page parses
 * each row, extracts the RF reference, calls /admin/reconciliation/entries
 * (which delegates to PaymentsService.handleEvent), and shows a per-row
 * result with filter chips for matched / unmatched.
 */
import React, { useMemo, useState } from 'react';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterChip,
  HelpBanner,
  Notice,
  Page,
  PageHeader,
  SearchFilterBar,
  StatusPill,
  useDebouncedValue,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

interface Entry {
  reference: string;
  amountCents: number;
  paidAt: string;
  debtorName?: string;
}

interface Result {
  reference: string;
  matched: boolean;
}

const ReconciliationPage: React.FC = () => {
  const [parsed, setParsed] = useState<Entry[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [filter, setFilter] = useState<'all' | 'matched' | 'unmatched' | 'unprocessed'>('all');
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);

  function onFile(file: File) {
    setFileName(file.name);
    setOkMsg(null);
    setErr(null);
    setParseWarnings([]);
    setResults([]);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) {
        setErr('CSV is empty or has no rows under the header.');
        setParsed([]);
        return;
      }
      const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
      const idxDate = header.indexOf('date');
      const idxAmount = header.indexOf('amount');
      const idxRef = header.indexOf('reference');
      const idxDebtor = header.indexOf('debtor');
      if (idxRef < 0 || idxAmount < 0 || idxDate < 0) {
        setErr(
          'Couldn\'t find the required columns. Expected headers: date, amount, reference (and optional debtor).',
        );
        setParsed([]);
        return;
      }
      const entries: Entry[] = [];
      const warnings: string[] = [];
      lines.slice(1).forEach((line, i) => {
        const cols = parseCsvLine(line);
        const rawRef = cols[idxRef] ?? '';
        const ref = rawRef.replace(/\s+/g, '');
        if (!/^RF\d{2}/i.test(ref)) {
          warnings.push(`Row ${i + 2}: reference "${rawRef}" isn't a valid RF code — skipped.`);
          return;
        }
        const amountStr = (cols[idxAmount] ?? '0').replace(',', '.');
        const amountEuros = parseFloat(amountStr);
        if (Number.isNaN(amountEuros)) {
          warnings.push(`Row ${i + 2}: couldn't read amount "${cols[idxAmount]}" — skipped.`);
          return;
        }
        entries.push({
          reference: ref,
          amountCents: Math.round(amountEuros * 100),
          paidAt: new Date(cols[idxDate] ?? Date.now()).toISOString(),
          debtorName: cols[idxDebtor],
        });
      });
      setParsed(entries);
      setParseWarnings(warnings);
    };
    reader.readAsText(file);
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/admin/reconciliation/entries', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries: parsed }),
      });
      const json = (await res.json()) as { results: Result[] };
      setResults(json.results ?? []);
      const matched = (json.results ?? []).filter((r) => r.matched).length;
      setOkMsg(
        `${matched} of ${parsed.length} entries matched a pending order. Unmatched rows stay unprocessed — verify they aren't typos before re-running.`,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const reset = () => {
    setParsed([]);
    setResults([]);
    setFileName(null);
    setOkMsg(null);
    setErr(null);
    setParseWarnings([]);
    setSearch('');
    setFilter('all');
  };

  const enriched = useMemo(
    () =>
      parsed.map((e, i) => ({
        ...e,
        match:
          results[i]?.matched === true
            ? 'matched'
            : results[i]?.matched === false
              ? 'unmatched'
              : 'unprocessed',
      })),
    [parsed, results],
  );

  const visible = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return enriched.filter((e) => {
      if (filter !== 'all' && e.match !== filter) return false;
      if (!q) return true;
      return (
        e.reference.toLowerCase().includes(q) ||
        (e.debtorName ?? '').toLowerCase().includes(q)
      );
    });
  }, [enriched, debouncedSearch, filter]);

  const counts = useMemo(() => {
    return {
      all: enriched.length,
      matched: enriched.filter((e) => e.match === 'matched').length,
      unmatched: enriched.filter((e) => e.match === 'unmatched').length,
      unprocessed: enriched.filter((e) => e.match === 'unprocessed').length,
    };
  }, [enriched]);

  return (
    <Page>
      <PageHeader
        kicker="Finance"
        title="Bank-transfer reconciliation"
        lede="Upload the daily CSV / camt.054 export from your bank (Nordea, OP, S-Pankki, etc.). RF-prefixed references are matched against pending orders, marking the donation as paid and triggering the receipt."
        actions={
          parsed.length > 0 ? (
            <>
              <Button variant="secondary" onClick={reset}>
                Start over
              </Button>
              {results.length === 0 && (
                <Button variant="primary" onClick={submit} loading={busy}>
                  {busy ? 'Submitting…' : `Apply ${parsed.length} entries`}
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      <HelpBanner id="reconciliation-intro" title="Before you upload">
        Your CSV needs at least three columns, in any order:{' '}
        <strong>date</strong>, <strong>amount</strong>, <strong>reference</strong>.
        Optional <strong>debtor</strong>. Quotes around values are honoured. Rows without an RF
        reference are skipped and listed as warnings — they’re usually fees or transfers between
        the garden’s own accounts.
      </HelpBanner>

      {err && (
        <Notice tone="danger" title="Couldn't parse the file" onDismiss={() => setErr(null)}>
          {err}
        </Notice>
      )}
      {okMsg && (
        <Notice tone="success" onDismiss={() => setOkMsg(null)}>
          {okMsg}
        </Notice>
      )}

      {parsed.length === 0 ? (
        <Card title="Pick a bank export" description="CSV or camt.054 exported from your online bank.">
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: `${space[10]} ${space[6]}`,
              border: `2px dashed ${colors.line}`,
              borderRadius: radius.lg,
              background: colors.whisper,
              cursor: 'pointer',
              gap: space[3],
              transition: 'all 180ms ease',
            }}
            onDragOver={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLLabelElement).style.background = colors.sage;
              (e.currentTarget as HTMLLabelElement).style.borderColor = colors.olive;
            }}
            onDragLeave={(e) => {
              (e.currentTarget as HTMLLabelElement).style.background = colors.whisper;
              (e.currentTarget as HTMLLabelElement).style.borderColor = colors.line;
            }}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) onFile(file);
              (e.currentTarget as HTMLLabelElement).style.background = colors.whisper;
              (e.currentTarget as HTMLLabelElement).style.borderColor = colors.line;
            }}
          >
            <span
              aria-hidden="true"
              style={{
                fontSize: 36,
                color: colors.olive,
              }}
            >
              ⬆
            </span>
            <div
              style={{
                fontFamily: font.display,
                fontSize: fontSize.xl,
                color: colors.forestDeep,
                fontWeight: 600,
              }}
            >
              Drop CSV or click to choose
            </div>
            <div
              style={{
                fontSize: fontSize.base,
                color: colors.inkMute,
                textAlign: 'center',
                maxWidth: 420,
              }}
            >
              Headers: <code style={{ fontFamily: font.mono }}>date, amount, reference, debtor</code>.
              Reference must be RF-prefixed (ISO 11649).
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
                e.target.value = '';
              }}
            />
          </label>
        </Card>
      ) : (
        <>
          <Card
            kicker={fileName ?? 'Parsed file'}
            title={`${parsed.length} entries with RF references`}
            description={
              results.length === 0
                ? 'Review the parsed rows below, then hit Apply to match against pending orders.'
                : 'Per-row results below. Unmatched rows didn’t map to any pending order — verify spelling and retry, or follow up with the donor.'
            }
          >
            {parseWarnings.length > 0 && (
              <Notice tone="warn" title={`${parseWarnings.length} skipped row${parseWarnings.length === 1 ? '' : 's'}`}>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: fontSize.sm, lineHeight: 1.55 }}>
                  {parseWarnings.slice(0, 10).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {parseWarnings.length > 10 && (
                    <li style={{ color: colors.inkMute }}>
                      …and {parseWarnings.length - 10} more.
                    </li>
                  )}
                </ul>
              </Notice>
            )}
            <SearchFilterBar
              search={search}
              onSearch={setSearch}
              searchPlaceholder="Search reference or debtor name…"
              filters={
                <>
                  <FilterChip
                    active={filter === 'all'}
                    label="All"
                    count={counts.all}
                    onClick={() => setFilter('all')}
                  />
                  <FilterChip
                    active={filter === 'matched'}
                    label="Matched"
                    count={counts.matched}
                    onClick={() => setFilter('matched')}
                  />
                  <FilterChip
                    active={filter === 'unmatched'}
                    label="Unmatched"
                    count={counts.unmatched}
                    onClick={() => setFilter('unmatched')}
                    tone={counts.unmatched > 0 ? 'accent' : 'default'}
                  />
                  <FilterChip
                    active={filter === 'unprocessed'}
                    label="Not yet applied"
                    count={counts.unprocessed}
                    onClick={() => setFilter('unprocessed')}
                  />
                </>
              }
              activeFilterCount={(search ? 1 : 0) + (filter !== 'all' ? 1 : 0)}
              onClearAll={() => {
                setSearch('');
                setFilter('all');
              }}
              resultCount={visible.length}
              totalCount={enriched.length}
              resultLabel="entries"
            />
            <DataTable
              columns={[
                {
                  key: 'reference',
                  label: 'Reference',
                  width: 220,
                  render: (e) => (
                    <code
                      style={{
                        fontFamily: font.mono,
                        fontSize: 13,
                        color: colors.forest,
                        fontWeight: 600,
                      }}
                    >
                      {e.reference}
                    </code>
                  ),
                },
                {
                  key: 'debtor',
                  label: 'Debtor',
                  render: (e) => e.debtorName ?? <span style={{ color: colors.inkFaint }}>—</span>,
                },
                {
                  key: 'amount',
                  label: 'Amount',
                  align: 'right',
                  width: 140,
                  render: (e) => (
                    <strong style={{ fontFamily: font.mono, color: colors.forest }}>
                      €{(e.amountCents / 100).toFixed(2)}
                    </strong>
                  ),
                },
                {
                  key: 'paidAt',
                  label: 'Date',
                  width: 140,
                  render: (e) => new Date(e.paidAt).toLocaleDateString(),
                },
                {
                  key: 'match',
                  label: 'Match',
                  align: 'right',
                  width: 160,
                  render: (e) =>
                    e.match === 'matched' ? (
                      <StatusPill tone="success">Matched</StatusPill>
                    ) : e.match === 'unmatched' ? (
                      <StatusPill tone="danger">No match</StatusPill>
                    ) : (
                      <StatusPill tone="neutral" dot={false}>
                        Pending apply
                      </StatusPill>
                    ),
                },
              ]}
              rows={visible}
              rowKey={(e, i) => `${e.reference}-${i}`}
              empty={
                <EmptyState
                  variant="no-filter-match"
                  title="No entries match these filters"
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch('');
                        setFilter('all');
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              }
            />
          </Card>
        </>
      )}
    </Page>
  );
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

export default ReconciliationPage;
