'use client';

import { useState, useRef } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { validateWaNumber, sanitizeWaNumber } from '@/src/lib/utils/contacts';
import { createClient } from '@/src/lib/supabase/client';

interface Group { id: string; name: string; }
interface ImportRow { full_name: string; wa_number: string; category?: string; notes?: string; }
interface ImportResult { imported: number; skipped_duplicates: number; failed: number; errors: string[]; }

/** Normalise a raw row (object with arbitrary keys) into ImportRow or null */
function parseRow(raw: Record<string, string>, rowNum: number): ImportRow | { row: number; reason: string } {
  const name = (raw['nama'] ?? raw['full_name'] ?? raw['name'] ?? '').trim();
  const num  = (raw['nomor'] ?? raw['wa_number'] ?? raw['phone'] ?? raw['nomor_wa'] ?? '').trim();
  if (!name) return { row: rowNum, reason: 'Nama kosong' };
  if (!validateWaNumber(num)) return { row: rowNum, reason: `Nomor tidak valid: ${num}` };
  return {
    full_name: name,
    wa_number: sanitizeWaNumber(num),
    category: raw['kategori'] ?? raw['category'] ?? undefined,
    notes:    raw['catatan']  ?? raw['notes']    ?? undefined,
  };
}

function parseCSV(file: File): Promise<{ valid: ImportRow[]; invalid: { row: number; reason: string }[] }> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const valid: ImportRow[] = [];
        const invalid: { row: number; reason: string }[] = [];
        data.forEach((raw, i) => {
          const r = parseRow(raw, i + 2);
          ('wa_number' in r) ? valid.push(r) : invalid.push(r);
        });
        resolve({ valid, invalid });
      },
    });
  });
}

function parseXLSX(file: File): Promise<{ valid: ImportRow[]; invalid: { row: number; reason: string }[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
        const valid: ImportRow[] = [];
        const invalid: { row: number; reason: string }[] = [];
        rows.forEach((raw, i) => {
          const r = parseRow(raw, i + 2);
          ('wa_number' in r) ? valid.push(r) : invalid.push(r);
        });
        resolve({ valid, invalid });
      } catch {
        reject(new Error('Gagal membaca file XLSX'));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export default function ImportClient({ groups }: { groups: Group[] }) {
  const [rows, setRows]               = useState<ImportRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<{ row: number; reason: string }[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [result, setResult]           = useState<ImportResult | null>(null);
  const [loading, setLoading]         = useState(false);
  const [progress, setProgress]       = useState(0);
  const [fileName, setFileName]       = useState('');
  const [parseError, setParseError]   = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setFileName(file.name);
    setResult(null);
    setParseError('');
    try {
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
      const { valid, invalid } = isXlsx ? await parseXLSX(file) : await parseCSV(file);
      setRows(valid);
      setInvalidRows(invalid);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Gagal memproses file');
    }
  }

  async function handleImport() {
    setLoading(true);
    setProgress(0);
    const supabase = createClient();
    let imported = 0, skipped = 0, failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const { error } = await supabase.from('contacts').insert({
        full_name: row.full_name,
        wa_number: row.wa_number,
        category:  row.category ?? null,
        notes:     row.notes ?? null,
      });

      if (error) {
        if (error.code === '23505') skipped++;
        else { failed++; errors.push(`Baris ${i + 2} (${row.wa_number}): ${error.message}`); }
      } else {
        imported++;
        if (selectedGroupId) {
          const { data: contact } = await supabase
            .from('contacts').select('id').eq('wa_number', row.wa_number).single();
          if (contact) {
            await supabase.from('contact_group_members')
              .upsert({ contact_id: contact.id, group_id: selectedGroupId });
          }
        }
      }

      setProgress(Math.round(((i + 1) / rows.length) * 100));
    }

    setResult({ imported, skipped_duplicates: skipped, failed, errors });
    setLoading(false);
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Import Kontak</h1>

      {/* Dropzone */}
      <div
        className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-green-400 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <div className="text-4xl mb-3">📁</div>
        <p className="text-sm font-medium text-gray-700">{fileName || 'Klik atau seret file di sini'}</p>
        <p className="text-xs text-gray-400 mt-1">Format: CSV atau XLSX — kolom wajib: nama, nomor</p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {parseError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{parseError}</div>
      )}

      {rows.length > 0 && !result && (
        <>
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-1">
            <p className="text-sm font-medium text-green-800">{rows.length} kontak valid siap diimpor</p>
            {invalidRows.length > 0 && (
              <p className="text-xs text-yellow-700">{invalidRows.length} baris dilewati (format tidak valid)</p>
            )}
          </div>

          {/* Preview table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="min-w-full text-sm divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>{['Nama', 'Nomor WA', 'Kategori'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-600">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">{r.full_name}</td>
                    <td className="px-4 py-2 font-mono">{r.wa_number}</td>
                    <td className="px-4 py-2 text-gray-500">{r.category ?? '—'}</td>
                  </tr>
                ))}
                {rows.length > 5 && (
                  <tr><td colSpan={3} className="px-4 py-2 text-xs text-gray-400">…dan {rows.length - 5} lainnya</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Group selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assign ke Grup (opsional)</label>
            <select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="block border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 max-w-xs"
            >
              <option value="">— Tidak ada —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>

          {/* Progress bar */}
          {loading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Mengimpor…</span><span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <button
            onClick={handleImport}
            disabled={loading}
            className="px-6 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
          >
            {loading ? `Mengimpor… ${progress}%` : `Import ${rows.length} Kontak`}
          </button>
        </>
      )}

      {/* Result summary */}
      {result && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Hasil Import</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-xl font-bold text-green-700">{result.imported}</p>
              <p className="text-xs text-gray-500">Berhasil</p>
            </div>
            <div className="bg-yellow-50 rounded-lg p-3">
              <p className="text-xl font-bold text-yellow-600">{result.skipped_duplicates}</p>
              <p className="text-xs text-gray-500">Duplikat</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-xl font-bold text-red-600">{result.failed}</p>
              <p className="text-xs text-gray-500">Gagal</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 font-medium mb-1">Detail error:</p>
              {result.errors.slice(0, 10).map((e, i) => (
                <p key={i} className="text-xs text-red-600">{e}</p>
              ))}
            </div>
          )}
          <button
            onClick={() => { setRows([]); setInvalidRows([]); setResult(null); setFileName(''); setProgress(0); }}
            className="text-sm text-green-600 hover:underline"
          >
            Import file lain
          </button>
        </div>
      )}
    </div>
  );
}
