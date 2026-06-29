import { Component, ErrorInfo, ReactNode } from 'react';
import { reportClientError } from '../utils/clientLogger';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('应用渲染异常', error, info);
    reportClientError(error.message || 'React render error', {
      stack: error.stack,
      component_stack: info.componentStack ?? undefined,
      details: { type: 'react-error-boundary' },
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-fallback">
          <div className="panel">
            <h1>页面暂时无法显示</h1>
            <p>{this.state.error.message || '组件渲染时发生异常，请刷新后重试。'}</p>
            <button className="button primary" type="button" onClick={() => window.location.reload()}>
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
