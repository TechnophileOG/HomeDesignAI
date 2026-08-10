import React, { useState } from 'react';
import { X, Gift, ShieldCheck, Store, Coins, Users, Search, BellRing, CheckCheck, Inbox } from 'lucide-react';
import { formatINR, timeAgo, LEDGER_META } from '../api/client';

/* ── Gift credits modal ───────────────────────────────────────────────────── */
function GiftModal({ store, onClose, onGift }) {
  const [amount, setAmount] = useState(10);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const presets = [5, 10, 25, 50, 100];

  const submit = () => {
    if (!confirming) { setConfirming(true); return; }
    const amt = Math.max(1, Math.min(5000, parseInt(amount, 10) || 0));
    onGift(store, amt, note.trim() || `Admin gift`);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content kv-modal kv-modal-sm" onClick={(e) => e.stopPropagation()}>
        <button className="kv-modal-close" onClick={onClose}><X size={18} /></button>
        <div className="kv-modal-title-row">
          <div className="kv-modal-icon gift"><Gift size={20} /></div>
          <div>
            <h3 className="kv-modal-title">Gift credits</h3>
            <p className="kv-modal-sub">
              {store.storeName} · current balance {formatINR(store.balance)}
            </p>
          </div>
        </div>

        <div className="gift-presets">
          {presets.map((p) => (
            <button
              key={p}
              className={`gift-preset${parseInt(amount, 10) === p ? ' active' : ''}`}
              onClick={() => { setAmount(p); setConfirming(false); }}
            >
              +{formatINR(p)}
            </button>
          ))}
        </div>

        <label className="kv-field-label">Credits to gift</label>
        <input
          className="kv-input"
          type="number"
          min={1}
          max={5000}
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setConfirming(false); }}
        />

        <label className="kv-field-label">Note (optional)</label>
        <input
          className="kv-input"
          type="text"
          maxLength={60}
          placeholder="e.g. Campaign credit for July"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 60))}
        />

        <button
          className="kv-btn kv-btn-primary kv-btn-lg"
          onClick={submit}
        >
          {confirming ? <>Confirm gift of {formatINR(parseInt(amount, 10) || 0)} credits?</> : <>Gift {formatINR(parseInt(amount, 10) || 0)} credits</>}
        </button>
        {confirming && (
          <p className="kv-modal-footnote">Tap again to confirm — this is recorded in the ledger.</p>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Admin Console
   ══════════════════════════════════════════════════════════════════════════ */
export default function AdminPanel({ stores, ledger, onGift, onClose, alerts = [], onResolveAlert, leads = [], onResolveLead }) {
  const [search, setSearch] = useState('');
  const [giftStore, setGiftStore] = useState(null);
  const [tab, setTab] = useState('stores');

  const openAlerts = alerts.filter((a) => !a.resolved);
  const newLeads = leads.filter((l) => l.status !== 'contacted');

  const filtered = stores.filter((s) =>
    `${s.storeName} ${s.city || ''} ${s.plan || ''}`.toLowerCase().includes(search.toLowerCase())
  );

  const totalCredits = stores.reduce((a, s) => a + (s.balance || 0), 0);
  const totalConsumed = ledger
    .filter((l) => l.type === 'consume')
    .reduce((a, l) => a + Math.abs(l.amount), 0);
  const totalGifted = ledger
    .filter((l) => l.type === 'gift')
    .reduce((a, l) => a + l.amount, 0);

  return (
    <div className="modal-overlay">
      <div className="modal-content kv-modal kv-modal-admin" onClick={(e) => e.stopPropagation()}>
        <button className="kv-modal-close" onClick={onClose}><X size={18} /></button>

        <div className="admin-head">
          <div className="kv-modal-icon admin"><ShieldCheck size={20} /></div>
          <div>
            <h3 className="kv-modal-title">Admin Console</h3>
            <p className="kv-modal-sub">Credits, stores & ecosystem management</p>
          </div>
        </div>

        {/* Stats */}
        <div className="admin-stats">
          <div className="admin-stat">
            <div className="admin-stat-value">{stores.length}</div>
            <div className="admin-stat-label"><Users size={11} /> Stores</div>
          </div>
          <div className="admin-stat">
            <div className="admin-stat-value">{formatINR(totalCredits)}</div>
            <div className="admin-stat-label"><Coins size={11} /> Credits in circulation</div>
          </div>
          <div className="admin-stat">
            <div className="admin-stat-value">{formatINR(totalConsumed)}</div>
            <div className="admin-stat-label"><Store size={11} /> Consumed</div>
          </div>
          <div className="admin-stat">
            <div className="admin-stat-value">{formatINR(totalGifted)}</div>
            <div className="admin-stat-label"><Gift size={11} /> Gifted</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="admin-tabs">
          <button className={`admin-tab${tab === 'stores' ? ' active' : ''}`} onClick={() => setTab('stores')}>
            Stores
          </button>
          <button className={`admin-tab${tab === 'ledger' ? ' active' : ''}`} onClick={() => setTab('ledger')}>
            Global Ledger
          </button>
          <button className={`admin-tab${tab === 'alerts' ? ' active' : ''}`} onClick={() => setTab('alerts')}>
            Follow-ups
            {openAlerts.length > 0 && <span className="admin-tab-badge">{openAlerts.length}</span>}
          </button>
          <button className={`admin-tab${tab === 'leads' ? ' active' : ''}`} onClick={() => setTab('leads')}>
            Leads
            {newLeads.length > 0 && <span className="admin-tab-badge">{newLeads.length}</span>}
          </button>
        </div>

        {tab === 'stores' && (
          <>
            <div className="admin-search-row">
              <Search size={14} />
              <input
                className="kv-input admin-search"
                placeholder="Search stores…"
                value={search}
                onChange={(e) => setSearch(e.target.value.slice(0, 40))}
              />
            </div>

            <div className="admin-table">
              <div className="admin-table-head">
                <span>Store</span>
                <span>Plan</span>
                <span>Balance</span>
                <span>Last active</span>
                <span />
              </div>
              {filtered.length === 0 && (
                <div className="ledger-empty">No stores match “{search}”.</div>
              )}
              {filtered.map((s) => (
                <div className="admin-row" key={s.id}>
                  <div className="admin-store-cell">
                    <div className="admin-store-avatar">
                      {s.storeName.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="admin-store-name">
                        {s.storeName}
                      </div>
                      <div className="admin-store-city">{s.city || '—'}</div>
                    </div>
                  </div>
                  <span className={`plan-chip ${s.plan === 'PRO' ? 'pro' : 'free'}`}>
                    <SparklesMini /> {s.plan || 'FREE'}
                  </span>
                  <div className="admin-balance">{formatINR(s.balance)}</div>
                  <div className="admin-last-active">{timeAgo(s.lastActive)}</div>
                  <button className="kv-btn kv-btn-gift" onClick={() => setGiftStore(s)}>
                    <Gift size={13} /> Gift
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'ledger' && (
          <div className="ledger-list admin-ledger">
            {ledger.length === 0 && <div className="ledger-empty">Ledger is empty.</div>}
            {ledger.slice(0, 60).map((l) => {
              const meta = LEDGER_META[l.type] || { label: l.type, tone: 'gray' };
              return (
                <div className="ledger-item" key={l.id}>
                  <div className={`ledger-type-icon ${meta.tone}`}>
                    {l.amount > 0 ? <ArrowDownMini /> : <ArrowUpMini />}
                  </div>
                  <div className="ledger-item-main">
                    <div className="ledger-item-title">
                      {l.note || meta.label}
                      <span className={`ledger-chip ${meta.tone}`}>{meta.label}</span>
                    </div>
                    <div className="ledger-item-sub">
                      {l.storeName} · {timeAgo(l.ts)} · by {l.actor}
                    </div>
                  </div>
                  <div className={`ledger-amt ${l.amount >= 0 ? 'plus' : 'minus'}`}>
                    {l.amount >= 0 ? '+' : '−'}{formatINR(Math.abs(l.amount))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'alerts' && (
          <div className="ledger-list admin-ledger">
            <p className="kv-modal-sub" style={{ marginBottom: 10 }}>
              Automatic follow-up requests — low balances, stuck stores, and anything the app flagged for the team.
            </p>
            {alerts.length === 0 && <div className="ledger-empty">No follow-ups — all clear. 🎉</div>}
            {alerts.slice(0, 60).map((a) => (
              <div className={`ledger-item admin-alert${a.resolved ? ' resolved' : ''}`} key={a.id}>
                <div className={`ledger-type-icon ${a.resolved ? 'blue' : 'gold'}`}>
                  <BellRing size={14} />
                </div>
                <div className="ledger-item-main">
                  <div className="ledger-item-title">
                    {a.message || 'Low balance — needs follow-up'}
                    {a.resolved
                      ? <span className="ledger-chip green">Resolved</span>
                      : <span className="ledger-chip gold">Needs follow-up</span>}
                  </div>
                  <div className="ledger-item-sub">
                    {a.storeName} · balance {formatINR(a.balance)} credits · {timeAgo(a.ts)}
                    {a.resolved && a.resolvedTs ? ` · resolved ${timeAgo(a.resolvedTs)}` : ''}
                  </div>
                </div>
                {!a.resolved && (
                  <button
                    className="kv-btn kv-btn-ghost kv-btn-sm"
                    onClick={() => onResolveAlert && onResolveAlert(a.id)}
                  >
                    <CheckCheck size={13} /> Resolved
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'leads' && (
          <div className="ledger-list admin-ledger">
            <p className="kv-modal-sub" style={{ marginBottom: 10 }}>
              Contact-form leads from the website — follow up and mark contacted.
            </p>
            {leads.length === 0 && <div className="ledger-empty">No leads yet.</div>}
            {leads.slice(0, 60).map((l) => (
              <div className={`ledger-item admin-alert${l.status === 'contacted' ? ' resolved' : ''}`} key={l.id}>
                <div className={`ledger-type-icon ${l.status === 'contacted' ? 'blue' : 'gold'}`}>
                  <Inbox size={14} />
                </div>
                <div className="ledger-item-main">
                  <div className="ledger-item-title">
                    {l.name} · <span style={{ fontWeight: 400 }}>{l.email}</span>
                    {l.status === 'contacted'
                      ? <span className="ledger-chip green">Contacted</span>
                      : <span className="ledger-chip gold">New</span>}
                  </div>
                  <div className="ledger-item-sub">
                    {l.phone} · {l.platform || '—'} · {l.products || '—'} products · {timeAgo(l.ts)}
                  </div>
                </div>
                {l.status !== 'contacted' && (
                  <button
                    className="kv-btn kv-btn-ghost kv-btn-sm"
                    onClick={() => onResolveLead && onResolveLead(l.id)}
                  >
                    <CheckCheck size={13} /> Contacted
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {giftStore && (
        <GiftModal
          store={giftStore}
          onClose={() => setGiftStore(null)}
          onGift={onGift}
        />
      )}
    </div>
  );
}

/* tiny icon shims to keep imports tidy */
function SparklesMini() {
  return <span className="plan-chip-spark">✦</span>;
}
function ArrowDownMini() {
  return <span className="ledger-arrow">↓</span>;
}
function ArrowUpMini() {
  return <span className="ledger-arrow up">↑</span>;
}
