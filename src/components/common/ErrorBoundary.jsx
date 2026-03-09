import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo })
    console.error('[ErrorBoundary] 捕獲到渲染錯誤:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🐱💥</div>
          <h2 style={{ color: '#D64545', marginBottom: '0.5rem' }}>呼嚕嚕小鎮遇到了問題</h2>
          <p style={{ color: '#8B8B8B', marginBottom: '1rem' }}>發生了一個渲染錯誤，請截圖以下資訊回報給開發者：</p>
          <pre style={{
            textAlign: 'left',
            background: '#F5F5F5',
            padding: '1rem',
            borderRadius: '0.5rem',
            overflow: 'auto',
            maxHeight: '200px',
            fontSize: '0.75rem',
            color: '#D64545',
            border: '1px solid #E8E8E8',
          }}>
            {this.state.error?.toString()}
            {'\n\n'}
            {this.state.errorInfo?.componentStack}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            style={{
              marginTop: '1rem',
              padding: '0.75rem 2rem',
              borderRadius: '1rem',
              border: 'none',
              background: '#A8D8B9',
              color: 'white',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            重新載入
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
