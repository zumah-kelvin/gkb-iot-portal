import React, { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Captured in GKB Portal ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#020617',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <div style={{
            maxWidth: '560px',
            width: '100%',
            backgroundColor: '#0f172a',
            border: '1px solid rgba(6,182,212,0.3)',
            borderRadius: '24px',
            padding: '32px',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
            textAlign: 'center'
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              backgroundColor: 'rgba(239,68,68,0.15)',
              color: '#f87171',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
              fontSize: '24px'
            }}>
              ⚠️
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 8px 0', color: '#ffffff' }}>
              GKB IoT Portal Error
            </h2>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: '0 0 20px 0', lineHeight: 1.6 }}>
              A client runtime exception occurred. Click the button below to reset your cache and reload the Hardware Fleet.
            </p>
            <div style={{
              backgroundColor: '#020617',
              borderRadius: '12px',
              padding: '12px',
              fontSize: '11px',
              fontFamily: 'monospace',
              color: '#fca5a5',
              textAlign: 'left',
              marginBottom: '20px',
              overflowX: 'auto',
              maxHeight: '120px'
            }}>
              {this.state.error?.message || 'Unknown runtime error'}
            </div>
            <button
              onClick={() => {
                window.localStorage.removeItem('gkb-devices');
                window.location.reload();
              }}
              style={{
                backgroundColor: '#06b6d4',
                color: '#020617',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 24px',
                fontSize: '13px',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 10px 15px -3px rgba(6,182,212,0.3)'
              }}
            >
              Reset & Reload Portal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
