/**
 * Bank-transfer reconciliation page.
 *
 * Finance staff drops a daily camt.054 / Tilisiirto CSV here. The page parses
 * each row, extracts the RF reference, calls /admin-api/reconciliation/entries
 * (which delegates to PaymentsService.handleEvent), and shows a per-row result.
 */
import React, { useState } from 'react';

interface Result {
  reference: string;
  matched: boolean;
}

const ReconciliationPage: React.FC = () => {
  const [parsed, setParsed] = useState<Array<{ reference: string; amountCents: number; paidAt: string; debtorName?: string }>>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const entries: Array<{ reference: string; amountCents: number; paidAt: string; debtorName?: string }> = [];
      // Very generic CSV parse: expects columns "date,amount,reference,debtor" (any order tolerable).
      const lines = text.split(/\r?\n/).filter(Boolean);
      const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
      const idxDate = header.indexOf('date');
      const idxAmount = header.indexOf('amount');
      const idxRef = header.indexOf('reference');
      const idxDebtor = header.indexOf('debtor');
      for (const line of lines.slice(1)) {
        const cols = parseCsvLine(line);
        const ref = cols[idxRef]?.replace(/\s+/g, '') ?? '';
        if (!/^RF\d{2}/i.test(ref)) continue;
        const amountEuros = parseFloat((cols[idxAmount] ?? '0').replace(',', '.'));
        entries.push({
          reference: cols[idxRef] ?? '',
          amountCents: Math.round(amountEuros * 100),
          paidAt: new Date(cols[idxDate] ?? Date.now()).toISOString(),
          debtorName: cols[idxDebtor],
        });
      }
      setParsed(entries);
    };
    reader.readAsText(file);
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch('/admin/reconciliation/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries: parsed }),
      });
      const json = await res.json();
      setResults(json.results);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Bank-transfer reconciliation</h1>
      <p>Upload the daily CSV / camt.054 from Nordea, OP, S-Pankki, etc.</p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      {parsed.length > 0 && (
        <>
          <p>{parsed.length} entries parsed with RF references.</p>
          <button onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Apply'}</button>
          <table style={{ width: '100%', marginTop: 16, fontSize: 13 }}>
            <thead>
              <tr><th align="left">Reference</th><th align="right">Amount</th><th>Date</th><th>Match</th></tr>
            </thead>
            <tbody>
              {parsed.map((e, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace' }}>{e.reference}</td>
                  <td align="right">€{(e.amountCents / 100).toFixed(2)}</td>
                  <td>{new Date(e.paidAt).toLocaleDateString()}</td>
                  <td>{results[i] ? (results[i]!.matched ? '✅' : '❌') : '·'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

export default ReconciliationPage;
