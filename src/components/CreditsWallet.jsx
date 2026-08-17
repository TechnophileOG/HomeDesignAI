import React, { useState, useEffect } from 'react';
import { Coins, CreditCard, ArrowDownLeft, ArrowUpRight, Sparkles, X, Wallet, ShieldCheck } from 'lucide-react';
import { formatINR, timeAgo, LEDGER_META, api, CREDIT_PRICING } from '../api/client';

/* ── Fallback credit packs (the server list is fetched and wins) ─────────── */
const FALLBACK_PACKS = [
  { packId: 'pack_50',   credits: 50,   pricePaise: 34900,  currency: 'INR' },
  { packId: 'pack_120',  credits: 120,  pricePaise: 69900,  currency: 'INR' },
  { packId: 'pack_300',  credits: 300,  pricePaise: 149900, currency: 'INR' },
  { packId: 'pack_1000', credits: 1000, pricePaise: 449900, currency: 'INR' },
];

/* ── Pro subscription (₹499/mo — credits + priority + 20% off top-ups).
   The monthly credit count comes from the server (source of truth). */
const SUB_PRICE = 49900;

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

const payWithRazorpay = ({ keyId, orderId, subscriptionId, amountPaise, currency, credits }) =>
  new Promise((resolve, reject) => {
    const RazorpayCtor = window.Razorpay;
    if (!RazorpayCtor) { reject(new Error('Payment gateway unavailable.')); return; }
    const options = {
      key: keyId,
      amount: amountPaise,
      currency: currency || 'INR',
      name: 'KatalogitAI',
      description: subscriptionId
        ? `KatalogitAI Pro — ${credits} credits every month`
        : `Add ${credits} credits to your wallet`,
      handler: (response) => resolve(response),
      modal: { ondismiss: () => reject(new Error('Payment cancelled.')) },
      prefill: {},
      theme: { color: '#0e6b3f' },
    };
    // A Razorpay subscription uses subscription_id (recurring), a one-off
    // top-up uses order_id. Mutually exclusive — never send both.
    if (subscriptionId) options.subscription_id = subscriptionId;
    else if (orderId) options.order_id = orderId;
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
          <span className="wallet-usage-note">
            ≈ {Math.floor(balance / (CREDIT_PRICING.model_shoot || 3))} AI shoot{(Math.floor(balance / (CREDIT_PRICING.model_shoot || 3))) === 1 ? '' : 's'} remaining
            {' '}· {formatINR(CREDIT_PRICING.model_shoot || 3)} credits per product
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
  const [subPlans, setSubPlans] = useState([]);
  const [subEnabled, setSubEnabled] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  // Fetch the Pro subscription plan availability (server knows if Razorpay
  // plan id is configured).
  useEffect(() => {
    let mounted = true;
    api.getSubscriptionPlan()
      .then((plan) => {
        if (!mounted || !plan) return;
        setSubEnabled(!!plan.configured);
        if (plan.configured) setSubPlans([{ id: 'pro_sub', price: Math.round(plan.pricePaise / 100), credits: plan.monthlyCredits }]);
      })
      .catch(() => { /* subscription just won't show */ });
    return () => { mounted = false; };
  }, []);

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
                <h3 className="kv-modal-title">Add credits</h3>
                <p className="kv-modal-sub">Secured checkout via Razorpay · ₹{formatINR(Math.round(SUB_PRICE / 100))}/mo Pro available</p>
              </div>
            </div>

            {subEnabled && subPlans.length > 0 && (
              <div className="sub-card">
                <div className="sub-card-head">
                  <div>
                    <div className="sub-card-title">
                      <Sparkles size={14} /> KatalogitAI Pro
                    </div>
                    <div className="sub-card-sub">
                      {formatINR(subPlans[0].credits)} credits every month · priority queue · 20% off top-ups
                    </div>
                  </div>
                  <div className="sub-card-price">₹{formatINR(subPlans[0].price)}<span>/mo</span></div>
                </div>
                <button
                  className="kv-btn kv-btn-primary kv-btn-lg"
                  disabled={paying || subscribing}
                  onClick={async () => {
                    if (subscribing) return;
                    setSubscribing(true);
                    setError('');
                    try {
                      const sub = await api.createSubscription();
                      await loadRazorpay();
                      await payWithRazorpay({
                        keyId: sub.keyId,
                        subscriptionId: sub.subscriptionId,
                        amountPaise: sub.amountPaise,
                        currency: sub.currency,
                        credits: subPlans[0].credits,
                      });
                      setSuccess(true);
                      if (onTopUp) onTopUp();
                    } catch (err) {
                      console.error('[subscribe] failed:', err);
                      setError(err?.message || 'Subscription could not be started.');
                    } finally {
                      setSubscribing(false);
                    }
                  }}
                >
                  {subscribing ? (
                    <><span className="ai-spinner" style={{ width: 14, height: 14 }} /> Starting…</>
                  ) : (
                    <>Subscribe ₹{formatINR(subPlans[0].price)}/mo</>
                  )}
                </button>
              </div>
            )}

            <div className="topup-divider">or top up once</div>

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
