import React from 'react';

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

interface ErrorBoundaryProps {
    children: React.ReactNode;
}

/**
 * Error Boundary - Bắt lỗi runtime để app không bị crash trắng.
 * Cho phép người dùng reload hoặc reset app khi gặp lỗi.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('🚨 App crash:', error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    handleClearAndReload = () => {
        try {
            localStorage.removeItem('skkn_session_data');
            sessionStorage.clear();
        } catch (e) {
            // ignore
        }
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    padding: '20px'
                }}>
                    <div style={{
                        background: 'white',
                        borderRadius: '16px',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.1)',
                        padding: '40px',
                        maxWidth: '480px',
                        width: '100%',
                        textAlign: 'center'
                    }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
                        <h2 style={{
                            fontSize: '22px',
                            fontWeight: '700',
                            color: '#1e293b',
                            margin: '0 0 12px 0'
                        }}>
                            Ứng dụng gặp sự cố
                        </h2>
                        <p style={{
                            fontSize: '14px',
                            color: '#64748b',
                            lineHeight: '1.6',
                            margin: '0 0 24px 0'
                        }}>
                            Đã xảy ra lỗi không mong muốn. Bạn có thể thử tải lại trang hoặc xóa dữ liệu phiên.
                        </p>

                        {this.state.error && (
                            <div style={{
                                background: '#fef2f2',
                                border: '1px solid #fecaca',
                                borderRadius: '8px',
                                padding: '12px',
                                marginBottom: '20px',
                                textAlign: 'left'
                            }}>
                                <p style={{
                                    fontSize: '12px',
                                    color: '#991b1b',
                                    fontFamily: 'monospace',
                                    margin: 0,
                                    wordBreak: 'break-word'
                                }}>
                                    {this.state.error.message}
                                </p>
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button
                                onClick={this.handleReset}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '10px',
                                    border: '1px solid #e2e8f0',
                                    background: 'white',
                                    color: '#475569',
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                }}
                            >
                                🔄 Thử lại
                            </button>
                            <button
                                onClick={this.handleClearAndReload}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: 'linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)',
                                    color: 'white',
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 14px rgba(59,130,246,0.3)'
                                }}
                            >
                                🗑 Xóa phiên & Tải lại
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
