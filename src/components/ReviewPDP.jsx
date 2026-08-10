import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, RotateCcw, Check, Sparkles, Tag, Ruler, Palette, Clock } from 'lucide-react';
import { CREDIT_PRICING } from '../api/client';

const QTY_PRESETS = [1, 5, 10, 50, 100];

/* ── Per-photo regen button overlay ───────────────────────────────────── */
function RegenShotBtn({ onClick, loading, queued }) {
  return (
    <button className="rpd-regen-shot-btn" onClick={onClick} disabled={loading || queued} title="Regenerate this shot (1 credit)">
      {loading
        ? <div className="rpd-regen-spinner"/>
        : queued
          ? <><Clock size={13}/> Queued</>
          : <><RotateCcw size={13}/> Regen Shot</>
      }
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function ReviewPDP({ product, onClose, onApprove, onSendToRetake, walletBalance = 0, onRegenShot, onFullRegen, onOpenTopUp }) {
  const [slide, setSlide]       = useState(0);
  // gallery holds display URLs (flat-lay + any AI results already on the product)
  const gallery = product.gallery?.length ? product.gallery : (product.image ? [product.image] : []);
  const [regenLoading, setRegenLoading] = useState(null); // index of shot being regen'd
  const [fullRegenLoading, setFullRegenLoading] = useState(false);
  const [queuedNote, setQueuedNote] = useState('');
  // synchronous re-entry guard — a fast double-tap must not double-spend
  const busyRef = useRef(false);
  // drop in-flight results if the modal closes mid-job
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [price, setPrice]   = useState(product.price?.replace(/[^0-9]/g, '').slice(0, 7) || '');
  const [qty, setQty]       = useState(1);
  const [qtyInput, setQtyInput] = useState('');
  const [useCustomQty, setUseCustomQty] = useState(false);

  // AI specs only when the pipeline has actually produced them
  const specs = product.aiSpecs || null;
  const shootQueued = product.jobStatus === 'queued' || product.jobStatus === 'processing';

  // Only digits, capped at ₹99,99,999 — blocks junk/negative/huge values
  const sanitizePrice = (raw) => raw.replace(/[^0-9]/g, '').slice(0, 7);
  // Integer between 1 and 1,00,000
  const sanitizeQty = (raw) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 1) return '';
    return String(Math.min(n, 100000));
  };

  const finalQty = useCustomQty
    ? (parseInt(qtyInput, 10) || 1)
    : qty;

  const prev = () => setSlide(s => (s - 1 + gallery.length) % gallery.length);
  const next = () => setSlide(s => (s + 1) % gallery.length);

  const handleRegenShot = async (idx) => {
    if (busyRef.current || !onRegenShot) return; // double-tap guard
    // Credit gate: one shot regen costs 1 credit
    const cost = CREDIT_PRICING.regen_shot;
    if (walletBalance < cost) {
      if (onOpenTopUp) onOpenTopUp();
      return;
    }
    busyRef.current = true;
    setRegenLoading(idx);
    setQueuedNote('');
    try {
      const res = await onRegenShot(product, idx);
      if (!mountedRef.current) return;
      if (res && res.id) setQueuedNote('Regeneration queued — the new shot appears here once processing completes.');
    } catch (err) {
      console.error('[ai] regen shot failed:', err);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setRegenLoading(null);
    }
  };

  const handleFullRegen = async () => {
    if (busyRef.current || !onFullRegen) return; // double-tap guard
    // Credit gate: full regeneration costs 3 credits
    const cost = CREDIT_PRICING.full_regen;
    if (walletBalance < cost) {
      if (onOpenTopUp) onOpenTopUp();
      return;
    }
    busyRef.current = true;
    setFullRegenLoading(true);
    setQueuedNote('');
    try {
      const res = await onFullRegen(product);
      if (!mountedRef.current) return;
      if (res && res.id) setQueuedNote('Full regeneration queued — results appear here once processing completes.');
    } catch (err) {
      console.error('[ai] full regen failed:', err);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setFullRegenLoading(false);
    }
  };

  const handleApprove = () => {
    if (!price) { alert('Please set a price before approving.'); return; }
    const p = parseInt(price, 10);
    if (Number.isNaN(p) || p <= 0 || p > 9999999) {
      alert('Please enter a valid price (₹1 – ₹99,99,999).');
      return;
    }
    onApprove('₹' + p, finalQty);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content rpd-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">Review &amp; Approve</span>
          <button className="modal-close-btn" onClick={onClose}><X size={16}/></button>
        </div>

        <div className="rpd-grid">

          {/* ── Left: Gallery ── */}
          <div className="rpd-gallery-col">
            <div className="rpd-gallery-main">
              {gallery[slide]
                ? <img src={gallery[slide]} alt="Product view" className="pdp-gallery-img"/>
                : <div className="pdp-gallery-img pdp-gallery-empty"><Sparkles size={30} color="var(--c-peach-mid)"/></div>}

              {/* AI badge — honest: only claims generated when there are results */}
              {shootQueued ? (
                <div className="pdp-ai-badge pdp-ai-badge-queued"><Clock size={10}/> AI shoot queued</div>
              ) : gallery.length > 1 ? (
                <div className="pdp-ai-badge"><Sparkles size={10}/> AI Generated</div>
              ) : (
                <div className="pdp-ai-badge pdp-ai-badge-queued"><Clock size={10}/> Waiting for AI shoot</div>
              )}

              {/* Per-shot regen — only once the AI gallery exists */}
              {!shootQueued && gallery.length > 1 && (
                <RegenShotBtn
                  onClick={() => handleRegenShot(slide)}
                  loading={regenLoading === slide}
                  queued={!!queuedNote}
                />
              )}

              {/* Nav arrows */}
              {gallery.length > 1 && (
                <>
                  <button className="pdp-gal-arrow left" onClick={prev}><ChevronLeft size={16}/></button>
                  <button className="pdp-gal-arrow right" onClick={next}><ChevronRight size={16}/></button>
                </>
              )}
            </div>

            {queuedNote && <p className="rpd-queued-note"><Clock size={12}/> {queuedNote}</p>}

            {/* Dots */}
            {gallery.length > 1 && (
              <div className="pdp-gallery-dots" style={{ marginTop:8 }}>
                {gallery.map((_, i) => (
                  <button key={i} className={`pdp-gallery-dot${i===slide?' active':''}`} onClick={() => setSlide(i)}/>
                ))}
              </div>
            )}

            {/* Thumbs */}
            {gallery.length > 1 && (
              <div className="pdp-gallery-thumbs" style={{ marginTop:10 }}>
                {gallery.map((src, i) => (
                  <button key={i} className={`pdp-thumb${i===slide?' active':''}`} onClick={() => setSlide(i)}>
                    <img src={src} alt={`View ${i+1}`}/>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Right: Details + actions ── */}
          <div className="rpd-info-col">
            <h3 className="rpd-product-title">{product.title}</h3>
            <span className="rpd-category-tag">{product.category}</span>

            {shootQueued && (
              <p className="rpd-queued-banner">
                <Clock size={13}/> Your AI photoshoot is queued. It will appear here as soon as processing completes.
              </p>
            )}

            {specs ? (
              <>
                <p className="pdp-desc" style={{ marginTop:8 }}>{specs.description}</p>
                <div className="pdp-detail-grid" style={{ marginTop:4 }}>
                  <div className="pdp-detail-row">
                    <Ruler size={13}/><span className="pdp-detail-key">Sizes</span>
                    <div className="pdp-size-chips">{(specs.sizes || []).map(s=><span key={s} className="pdp-size-chip">{s}</span>)}</div>
                  </div>
                  <div className="pdp-detail-row">
                    <Palette size={13}/><span className="pdp-detail-key">Colors</span>
                    <span className="pdp-detail-val">{(specs.colors || []).join(', ')}</span>
                  </div>
                  <div className="pdp-detail-row">
                    <Tag size={13}/><span className="pdp-detail-key">Material</span>
                    <span className="pdp-detail-val">{specs.material || '—'}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="pdp-desc" style={{ marginTop:8, opacity:.7 }}>
                The AI analysis (description, sizes, colours, material) will appear here once the photoshoot completes.
              </p>
            )}

            {/* Price input */}
            <div className="rpd-field">
              <label className="rpd-field-label">Set Selling Price *</label>
              <div className="rpd-price-input-wrap">
                <span className="rpd-price-prefix">₹</span>
                <input
                  className="rpd-price-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="e.g. 999"
                  value={price}
                  maxLength={7}
                  onChange={e => setPrice(sanitizePrice(e.target.value))}
                />
              </div>
            </div>

            {/* Quantity selector */}
            <div className="rpd-field">
              <label className="rpd-field-label">Stock Quantity</label>
              <div className="rpd-qty-presets">
                {QTY_PRESETS.map(q => (
                  <button
                    key={q}
                    className={`rpd-qty-chip${!useCustomQty && qty===q?' active':''}`}
                    onClick={() => { setQty(q); setUseCustomQty(false); }}
                  >
                    {q === 100 ? '100+' : q}
                  </button>
                ))}
                <button
                  className={`rpd-qty-chip${useCustomQty?' active':''}`}
                  onClick={() => setUseCustomQty(true)}
                >
                  Custom
                </button>
              </div>
              {useCustomQty && (
                <input
                  className="rpd-qty-custom-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Enter quantity"
                  value={qtyInput}
                  maxLength={6}
                  onChange={e => setQtyInput(sanitizeQty(e.target.value))}
                  autoFocus
                />
              )}
            </div>

            {/* Action buttons */}
            <div className="rpd-actions">
              <button
                className="rpd-btn rpd-btn-approve"
                onClick={handleApprove}
                disabled={!price}
                style={{ opacity: price ? 1 : 0.45 }}
              >
                <Check size={16}/> Approve &amp; Go Live
              </button>
              {!shootQueued && (
                <button
                  className="rpd-btn rpd-btn-regen-full"
                  onClick={handleFullRegen}
                  disabled={fullRegenLoading}
                >
                  {fullRegenLoading
                    ? <><div className="rpd-regen-spinner rpd-regen-spinner-sm"/> Queuing…</>
                    : <><Sparkles size={15}/> Regenerate Full Product ({CREDIT_PRICING.full_regen})</>
                  }
                </button>
              )}
              <button className="rpd-btn rpd-btn-retake" onClick={onSendToRetake}>
                <RotateCcw size={15}/> Send for Retake
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
