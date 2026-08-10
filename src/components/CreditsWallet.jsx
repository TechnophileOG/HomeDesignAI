import React, { useState, useEffect } from 'react';
import { Coins, CreditCard, ArrowDownLeft, ArrowUpRight, Sparkles, X, Wallet, ShieldCheck } from 'lucide-react';
import { formatINR, timeAgo, LEDGER_META, api } from '../api/client';

/* ── Fallback credit packs (the server list is fetched and wins) ─────────── */
const FALLBACK_PACKS = [
  { packId: 'pack_50',   credits: 50,   pricePaise: 24900,  currency: 'INR' },
  { packId: 'pack_120',  credits: 120,  pricePaise: 49900,  currency: 'INR' },
  { packId: 'pack_300',  credits: 300,  pricePaise: 99900,  currency: 'INR' },
  { packId: 'pack_1000', credits: 1000, pricePaise: 249900, currency: 'INR' },
];

const toPack = (p, idx) => ({
  id: p.packId,
  price: Math.round((p.pricePaise || 0) / 100),
  credits: p.credits,
  popular: idx === 1,
});

/* ── Razorpay checkout (loaded on demand from checkout.razorpay.com) ─────── */
const loadRazorpay = () => new Promise((resolve, reject) => {
  if (window.Razorpay) return resolve(window.Razorpay);
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  s.onload = () => resolve(window.Razorpay);
  s.onerror = () => reject(new Error('Could not load the payment gateway.'));
  document.head.appendChild(s);
});

const payWithRazorpay = ({ keyId, orderId, amountPaise, currency, credits }) =>
  new Promise((resolve, reject) => {
    const RazorpayCtor = window.Razorpay;
    if (!RazorpayCtor) { reject(new Error('Payment gateway unavailable.')); return; }
    const options = {
      key: keyId,
      order_id: orderId,
      amount: amountPaise,
      currency: currency || 'INR',
      name: 'KatalogitAI',
      description: `Add ${credits} credits to your wallet`,
      handler: (response) => resolve(response),
      modal: { ondismiss: () => reject(new Error('Payment cancelled.')) },
      prefill: {},
      theme: { color: '#0e6b3f' },
    };
    try {
      const rzp = new RazorpayCtor(options);
      rzp.open();
    } catch (err) {
      reject(err);
    }
  });

/* ── Wallet summary card (used inside Settings) ──────────────────────────── */
export function WalletCard({ wallet, onOpenTopUp, onOpenTransactions }) {
  const balance = wallet?.balance ?? 0;
  return (
    <div className="settings-section-card wallet-card">
      <div className="wallet-card-head">
        <div className="wallet-balance-block">
          <div className="wallet-balance-label">
            <Coins size={13} /> Credit Balance
          </div>
          <div className="wallet-balance-value">
            {formatINR(balance)}
            <span className="wallet-balance-unit"> credits</span>
          </div>
        </div>
        <span className={`plan-chip ${wallet?.plan === 'PRO' ? 'pro' : 'free'}`}>
          <Sparkles size={11} /> {wallet?.plan || 'FREE'}
        </span>
      </div>

      <div className="wallet-card-row">
        <div className="wallet-usage">
          <div className="wallet-usage-bar">
            <div className="wallet-usage-fill" style={{ width: `${Math.min(100, balance)}%` }} />
          </div>
          <span className="wallet-usage-note">
            AI photoshoot costs {formatINR(3)} credits per product
          </span>
        </div>
      </div>

      <div className="wallet-actions">
        <button className="kv-btn kv-btn-primary" onClick={onOpenTopUp}>
          <CreditCard size={15} /> Top Up
        </button>
        <button className="kv-btn kv-btn-ghost" onClick={onOpenTransactions}>
          <Wallet size={15} /> Transactions
        </button>
      </div>
    </div>
  );
}

/* ── Top-up modal (real Razorpay order flow) ─────────────────────────────── */
export function TopUpModal({ onClose, onTopUp, initialPack }) {
  const [packs, setPacks] = useState(FALLBACK_PACKS.map(toPack));
  const [packId, setPackId] = useState(initialPack?.id || FALLBACK_PACKS[1].packId);
  const [paying, setPaying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Packs come from the server (single source of truth for pricing).
  useEffect(() => {
    let mounted = true;
    api.getCreditPacks()
      .then((serverPacks) => {
        if (!mounted || !serverPacks?.length) return;
        const mapped = serverPacks.map(toPack);
        setPacks(mapped);
        if (initialPack?.id) setPackId(initialPack.id);
        else if (!mapped.some((p) => p.id === packId)) setPackId(mapped[0]?.id);
      })
      .catch(() => { /* fall back to display packs */ });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = packs.find((p) => p.id === packId) || packs[0];

  const handlePay = async () => {
    if (!selected || paying) return;
    setPaying(true);
    setError('');
    try {
      const order = await api.createOrder(selected.id); // server creates the Razorpay order
      await loadRazorpay();
      await payWithRazorpay({
        keyId: order.keyId,
        orderId: order.orderId,
        amountPaise: order.amountPaise,
        currency: order.currency,
        credits: order.credits,
      });
      setSuccess(true);
      // credits are granted by the webhook — App polls the server wallet
      if (onTopUp) onTopUp();
    } catch (err) {
      console.error('[topup] failed:', err);
      if (err?.code === 'PAYMENTS_NOT_CONFIGURED') {
        setError('Payments are being enabled — please try again shortly.');
      } else {
        setError(err?.message || 'Payment could not be completed. Please try again.');
      }
    } finally {
      setPaying(false);
    }
  };

  const handleDone = () => {
    if (onTopUp) onTopUp(); // final wallet refresh before closing
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={!paying ? onClose : undefined}>
      <div className="modal-content kv-modal" onClick={(e) => e.stopPropagation()}>
        <button className="kv-modal-close" onClick={onClose}><X size={18} /></button>

        {!success ? (
          <>
            <div className="kv-modal-title-row">
              <div className="kv-modal-icon"><CreditCard size={20} /></div>
              <div>
                <h3 className="kv-modal-title">Top up credits</h3>
                <p className="kv-modal-sub">Secured checkout via Razorpay</p>
              </div>
            </div>

            <div className="pack-grid">
              {packs.map((p) => (
                <button
                  key={p.id}
                  className={`pack-card${packId === p.id ? ' selected' : ''}${p.popular ? ' popular' : ''}`}
                  onClick={() => setPackId(p.id)}
                >
                  {p.popular && <span className="pack-popular-tag">BEST VALUE</span>}
                  <div className="pack-credits">{formatINR(p.credits)}</div>
                  <div className="pack-credits-label">credits</div>
                  <div className="pack-price">₹{formatINR(p.price)}</div>
                </button>
              ))}
            </div>

            {error && <p className="kv-modal-footnote" style={{ color: '#c0392b' }}>{error}</p>}

            <div className="topup-pay-row">
              <div className="topup-pay-info">
                <span className="topup-pay-gets">You get</span>
                <span className="topup-pay-total">{formatINR(selected.credits)} credits</span>
              </div>
              <button className="kv-btn kv-btn-primary kv-btn-lg" onClick={handlePay} disabled={paying}>
                {paying ? (
                  <><span className="ai-spinner" style={{ width: 14, height: 14 }} /> Processing…</>
                ) : (
                  <>Pay ₹{formatINR(selected.price)}</>
                )}
              </button>
            </div>
            <p className="kv-modal-footnote">
              <ShieldCheck size={12} /> Payment is processed securely — credits are credited to your wallet automatically.
            </p>
          </>
        ) : (
          <div className="topup-success">
            <div className="topup-success-ring">✓</div>
            <h3 className="kv-modal-title">Payment successful!</h3>
            <p className="kv-modal-sub">
              {formatINR(selected.credits)} credits are being added to your wallet.
            </p>
            <button className="kv-btn kv-btn-primary kv-btn-lg" onClick={handleDone}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Transactions modal ──────────────────────────────────────────────────── */
export function TransactionsModal({ wallet, ledger, onClose }) {
  const mine = ledger.filter((l) => !wallet?.id || l.storeId === wallet.id);
  const totalIn = mine.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content kv-modal kv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="kv-modal-close" onClick={onClose}><X size={18} /></button>
        <div className="kv-modal-title-row">
          <div className="kv-modal-icon"><Wallet size={20} /></div>
          <div>
            <h3 className="kv-modal-title">Transactions</h3>
            <p className="kv-modal-sub">
              Balance {formatINR(wallet?.balance ?? 0)} · {formatINR(totalIn)} credits received
            </p>
          </div>
        </div>

        <div className="ledger-list">
          {mine.length === 0 && (
            <div className="ledger-empty">No transactions yet — top up or run your first AI shoot.</div>
          )}
          {mine.map((l) => {
            const meta = LEDGER_META[l.type] || { label: l.type, tone: 'gray' };
            return (
              <div className="ledger-item" key={l.id}>
                <div className={`ledger-type-icon ${meta.tone}`}>
                  {l.amount > 0 ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                </div>
                <div className="ledger-item-main">
                  <div className="ledger-item-title">
                    {l.note || meta.label}
                    <span className={`ledger-chip ${meta.tone}`}>{meta.label}</span>
                  </div>
                  <div className="ledger-item-sub">{timeAgo(l.ts)}</div>
                </div>
                <div className={`ledger-amt ${l.amount >= 0 ? 'plus' : 'minus'}`}>
                  {l.amount >= 0 ? '+' : '−'}{formatINR(Math.abs(l.amount))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
