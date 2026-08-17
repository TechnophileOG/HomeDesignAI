import React, { useState } from 'react';
import { X, Gift, ShieldCheck, Store, Coins, Users, Search, BellRing, CheckCheck, Inbox, Image, Megaphone, Plus, Trash2, Pencil, Eye, EyeOff, Lock } from 'lucide-react';
import { formatINR, timeAgo, LEDGER_META } from '../api/client';

/* ── Content editor (banners + announcements) ────────────────────────────── */
function ContentEditor({ kind, initial, onSave, onCancel }) {
  const blank = kind === 'banner'
    ? { title: '', subtitle: '', badge: '', ctaText: '', ctaUrl: '', theme: 1, order: 100, enabled: false }
    : { title: '', message: '', type: 'info', expiresDays: '', enabled: false };
  const [form, setForm] = useState(initial ? { ...blank, ...initial } : blank);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setBool = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));

  const submit = () => {
    if (!String(form.title || '').trim()) { alert('Title is required.'); return; }
    if (kind === 'banner') {
      onSave({
        title: form.title, subtitle: form.subtitle, badge: form.badge,
        ctaText: form.ctaText, ctaUrl: form.ctaUrl,
        theme: [1, 2, 3].includes(Number(form.theme)) ? Number(form.theme) : 1,
        order: Math.max(0, Math.min(1000, parseInt(form.order, 10) || 100)),
        enabled: !!form.enabled,
      }, initial?.id);
    } else {
      const days = parseInt(form.expiresDays, 10);
      onSave({
        title: form.title, message: form.message,
        type: ['info', 'promo', 'maintenance'].includes(form.type) ? form.type : 'info',
        enabled: !!form.enabled,
        ...(Number.isFinite(days) && days > 0 ? { expiresAt: Date.now() + days * 86400000 } : {}),
      }, initial?.id);
    }
    onCancel();
  };

  const field = (label, children) => (
    <label className="kv-field-label" style={{ display: 'block', marginTop: 10 }}>
      {label}
      {children}
    </label>
  );

  return (
    <div className="kv-modal-body">
      {field('Title *', <input className="kv-input" value={form.title} onChange={set('title')} maxLength={kind === 'banner' ? 80 : 100} placeholder="Short, catchy title" />)}
      {kind === 'banner' ? (
        <>
          {field('Subtitle / description', <textarea className="kv-input" rows={2} value={form.subtitle} onChange={set('subtitle')} maxLength={200} placeholder="One or two lines describing the offer" />)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {field('Badge label', <input className="kv-input" value={form.badge} onChange={set('badge')} maxLength={30} placeholder="e.g. PROMO" />)}
            {field('Theme', (
              <select className="kv-input" value={form.theme} onChange={set('theme')}>
                <option value={1}>Green</option>
                <option value={2}>Peach</option>
                <option value={3}>Teal</option>
              </select>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {field('Button text (optional)', <input className="kv-input" value={form.ctaText} onChange={set('ctaText')} maxLength={40} placeholder="e.g. Claim offer" />)}
            {field('Button link (optional)', <input className="kv-input" value={form.ctaUrl} onChange={set('ctaUrl')} maxLength={300} placeholder="https://… or /path" />)}
          </div>
          {field('Order (lower = earlier)', <input className="kv-input" type="number" min={0} max={1000} value={form.order} onChange={set('order')} />)}
        </>
      ) : (
        <>
          {field('Message', <textarea className="kv-input" rows={3} value={form.message} onChange={set('message')} maxLength={500} placeholder="What users should know — shows in the notification bell" />)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {field('Type', (
              <select className="kv-input" value={form.type} onChange={set('type')}>
                <option value="info">Info</option>
                <option value="promo">Promo</option>
                <option value="maintenance">Maintenance</option>
              </select>
            ))}
            {field('Expires in (days, optional)', <input className="kv-input" type="number" min={1} value={form.expiresDays} onChange={set('expiresDays')} placeholder="e.g. 7" />)}
          </div>
        </>
      )}
      <label className="settings-item" style={{ marginTop: 12, cursor: 'pointer', justifyContent: 'flex-start', gap: 8 }}>
        <input type="checkbox" checked={!!form.enabled} onChange={setBool('enabled')} style={{ width: 16, height: 16 }} />
        <span style={{ fontSize: '.8rem', fontWeight: 600 }}>Publish now (visible to all stores)</span>
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="kv-btn kv-btn-primary" onClick={submit}>{initial ? 'Save changes' : 'Create'}</button>
        <button className="kv-btn kv-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ContentTab({ kind, items, onSave, onDelete }) {
  const [editing, setEditing] = useState(null); // null | {} (new) | item (edit)
  return (
    <div className="ledger-list admin-ledger">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <p className="kv-modal-sub" style={{ margin: 0 }}>
          {kind === 'banner'
            ? 'Carousel slides on every store dashboard. Disabled items are saved but not shown.'
            : 'Announcements appear in the notification bell of every store. Disabled items are saved but not shown.'}
        </p>
        <button className="kv-btn kv-btn-primary" onClick={() => setEditing({})}>
          <Plus size={13} /> New
        </button>
      </div>

      {editing && (
        <div className="kv-modal kv-modal-sm" style={{ marginBottom: 14 }}>
          <ContentEditor
            kind={kind}
            initial={editing.id ? editing : null}
            onSave={onSave}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {items.length === 0 && <div className="ledger-empty">Nothing here yet — create your first {kind}.</div>}
      {items.map((it) => (
        <div className={`ledger-item admin-alert${it.enabled ? '' : ' resolved'}`} key={it.id}>
          <div className={`ledger-type-icon ${it.enabled ? 'gold' : 'blue'}`}>
            {kind === 'banner' ? <Image size={14} /> : <Megaphone size={14} />}
          </div>
          <div className="ledger-item-main">
            <div className="ledger-item-title">
              {it.title}
              {it.enabled
                ? <span className="ledger-chip gold">Live</span>
                : <span className="ledger-chip gray">Draft</span>}
            </div>
            <div className="ledger-item-sub">
              {kind === 'banner'
                ? `${it.badge || 'No badge'} · order ${it.order}${it.ctaUrl ? ' · links: ' + it.ctaUrl : ''} · ${timeAgo(it.createdAt)}`
                : `${it.type} · expires ${it.expiresAt ? new Date(it.expiresAt).toLocaleDateString('en-IN') : 'never'} · ${timeAgo(it.createdAt)}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="kv-btn kv-btn-ghost kv-btn-sm" title={it.enabled ? 'Unpublish' : 'Publish'} onClick={() => onSave({ ...it, enabled: !it.enabled }, it.id)}>
              {it.enabled ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <button className="kv-btn kv-btn-ghost kv-btn-sm" onClick={() => setEditing(it)}>
              <Pencil size={13} />
            </button>
            <button
              className="kv-btn kv-btn-ghost kv-btn-sm"
              style={{ color: '#c0392b' }}
              onClick={() => { if (window.confirm(`Delete “${it.title}”?`)) onDelete(it.id); }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

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
export default function AdminPanel({ stores, ledger, onGift, onClose, alerts = [], onResolveAlert, leads = [], onResolveLead, banners = [], announcements = [], onSaveBanner, onDeleteBanner, onSaveAnnouncement, onDeleteAnnouncement, jobs = [], orders = [], onLock }) {
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
            <h3 className="kv-modal-title">Owner Console</h3>
            <p className="kv-modal-sub">Credits, stores & ecosystem management</p>
          </div>
          {onLock && (
            <button className="kv-btn kv-btn-ghost kv-btn-sm" onClick={onLock} title="Lock the console now">
              <Lock size={13} /> Lock
            </button>
          )}
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
          <button className={`admin-tab${tab === 'banners' ? ' active' : ''}`} onClick={() => setTab('banners')}>
            Banners
          </button>
          <button className={`admin-tab${tab === 'announcements' ? ' active' : ''}`} onClick={() => setTab('announcements')}>
            Announcements
          </button>
          <button className={`admin-tab${tab === 'jobs' ? ' active' : ''}`} onClick={() => setTab('jobs')}>
            Jobs
          </button>
          <button className={`admin-tab${tab === 'orders' ? ' active' : ''}`} onClick={() => setTab('orders')}>
            Payments
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

        {tab === 'banners' && (
          <ContentTab kind="banner" items={banners} onSave={onSaveBanner} onDelete={onDeleteBanner} />
        )}
        {tab === 'announcements' && (
          <ContentTab kind="announcement" items={announcements} onSave={onSaveAnnouncement} onDelete={onDeleteAnnouncement} />
        )}

        {tab === 'jobs' && (
          <div className="ledger-list admin-ledger">
            <p className="kv-modal-sub" style={{ marginBottom: 10 }}>
              AI jobs across all stores — newest first. Failed jobs auto-refund credits.
            </p>
            {jobs.length === 0 && <div className="ledger-empty">No jobs yet.</div>}
            {jobs.slice(0, 60).map((j) => (
              <div className={`ledger-item admin-alert${j.status === 'failed' ? ' resolved' : ''}`} key={j.id}>
                <div className={`ledger-type-icon ${j.status === 'done' ? 'green' : j.status === 'failed' ? 'red' : 'gold'}`}>
                  <Image size={14} />
                </div>
                <div className="ledger-item-main">
                  <div className="ledger-item-title">
                    {j.storeName} · {j.type}
                    <span className={`ledger-chip ${j.status === 'done' ? 'green' : j.status === 'failed' ? 'red' : 'gold'}`}>{j.status}</span>
                  </div>
                  <div className="ledger-item-sub">
                    {j.creditsReserved} credits{j.errorCode ? ` · ${j.errorCode}` : ''} · {timeAgo(j.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'orders' && (
          <div className="ledger-list admin-ledger">
            <p className="kv-modal-sub" style={{ marginBottom: 10 }}>
              Razorpay top-up orders + Pro subscriptions — newest first.
            </p>
            {orders.length === 0 && <div className="ledger-empty">No payments yet.</div>}
            {orders.slice(0, 60).map((o) => (
              <div className="ledger-item" key={`${o.kind}-${o.id}`}>
                <div className={`ledger-type-icon ${o.status === 'paid' || o.status === 'active' ? 'green' : 'gold'}`}>
                  {o.kind === 'subscription' ? <BellRing size={14} /> : <Coins size={14} />}
                </div>
                <div className="ledger-item-main">
                  <div className="ledger-item-title">
                    {o.storeName} · {o.kind === 'subscription' ? 'Pro subscription' : `${formatINR(o.credits)} credits`}
                    <span className={`ledger-chip ${o.status === 'paid' || o.status === 'active' ? 'green' : 'gold'}`}>{o.status}</span>
                  </div>
                  <div className="ledger-item-sub">
                    ₹{formatINR(Math.round((o.amountPaise || 0) / 100))} · {timeAgo(o.createdAt)}
                  </div>
                </div>
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
