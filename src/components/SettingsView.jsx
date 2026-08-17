import React from 'react';
import { User, ShieldCheck, HelpCircle, FileText, Shield, LogOut, MailCheck, Sparkles } from 'lucide-react';
import { WalletCard } from './CreditsWallet';

export default function SettingsView({
  profile,
  wallet,
  onOpenTopUp,
  onOpenTransactions,
  onOpenAdmin,
  isAdmin,
  onSignOut,
  email,
  emailVerified,
  onResendVerification,
}) {
  const storeName = profile?.storeName || 'My Store';
  const city      = profile?.city      || '';

  return (
    <div className="settings-view">
      <div className="section-title" style={{ fontFamily: 'var(--font-geom)' }}>
        Store Settings
      </div>

      {/* Profile Card */}
      <div className="settings-section-card" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'var(--c-peach)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--c-peach-darker)',
            flexShrink: 0,
          }}
        >
          <User size={24} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {storeName}
          </div>
          <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>
            B2B Vendor Tier{city ? ` • ${city}, India` : ''}
          </div>
        </div>
        <span className={`plan-chip ${wallet?.plan === 'PRO' ? 'pro' : 'free'}`}>
          <Sparkles size={11} /> {wallet?.plan || 'FREE'}
        </span>
      </div>

      {/* Credits & Wallet */}
      <WalletCard wallet={wallet} onOpenTopUp={onOpenTopUp} onOpenTransactions={onOpenTransactions} />

      {/* Account — Admin Console is visible only to authorized admins */}
      <div className="settings-section-card">
        <div className="settings-section-title">Account</div>

        {isAdmin && (
          <div className="settings-item" onClick={onOpenAdmin} style={{ cursor: 'pointer' }}>
            <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={14} /> Owner Console
            </div>
            <div style={{ fontSize: '0.72rem', opacity: 0.5 }}>Passcode-locked · credits, banners, jobs →</div>
          </div>
        )}

        <div className="settings-item">
          <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MailCheck size={14} /> Email Verification
          </div>
          {emailVerified ? (
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--c-accent-dark)' }}>✓ Verified</div>
          ) : (
            <button
              className="btn-ai-wizard primary"
              style={{ padding: '5px 10px', fontSize: '0.7rem', borderRadius: '9px' }}
              onClick={onResendVerification}
            >
              Resend link to {email}
            </button>
          )}
        </div>

        <div
          className="settings-item"
          onClick={() => {
            if (window.confirm('Sign out of your store account?')) onSignOut();
          }}
          style={{ cursor: 'pointer' }}
        >
          <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#c0392b' }}>
            <LogOut size={14} /> Sign Out
          </div>
          <div style={{ fontSize: '0.72rem', opacity: 0.5 }}>End this session →</div>
        </div>
      </div>

      {/* Help & Legal — the policies open on their own pages (sample content
          for now; swap in the final lawyer-approved text when ready) */}
      <div className="settings-section-card">
        <div className="settings-section-title">Help & Legal</div>

        <a
          className="settings-item"
          href="https://wa.me/919718282638"
          target="_blank"
          rel="noopener noreferrer"
          style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}
        >
          <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <HelpCircle size={14} /> Support & Guide
          </div>
          <div style={{ fontSize: '0.72rem', opacity: 0.5 }}>WhatsApp us →</div>
        </a>

        <a
          className="settings-item"
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}
        >
          <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FileText size={14} /> Terms & Conditions
          </div>
          <div style={{ fontSize: '0.72rem', opacity: 0.5 }}>Open →</div>
        </a>

        <a
          className="settings-item"
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}
        >
          <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Shield size={14} /> Privacy Policy
          </div>
          <div style={{ fontSize: '0.72rem', opacity: 0.5 }}>Open →</div>
        </a>

        <a
          className="settings-item"
          href="/data"
          target="_blank"
          rel="noopener noreferrer"
          style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}
        >
          <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Shield size={14} /> Data Policy
          </div>
          <div style={{ fontSize: '0.72rem', opacity: 0.5 }}>Open →</div>
        </a>
      </div>
    </div>
  );
}
