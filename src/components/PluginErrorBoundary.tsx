import { Component, type ErrorInfo, type ReactNode } from "react";

export interface PluginErrorInfo {
  pluginId: string;
  contributionId: string;
  message: string;
}

interface PluginErrorBoundaryProps {
  pluginId: string;
  contributionId: string;
  /** Diagnostics sink; receives every render failure for the Inspector/log viewer. */
  onError?: (info: PluginErrorInfo) => void;
  children: ReactNode;
}

interface PluginErrorBoundaryState {
  message: string | null;
}

/**
 * Isolates one plugin contribution's render tree: a throwing component shows a
 * small inline fallback instead of taking down the host surface (docs §10.2).
 * The boundary resets itself when its identity props change so retrying a
 * re-activated plugin works without remounting the outlet.
 */
export class PluginErrorBoundary extends Component<PluginErrorBoundaryProps, PluginErrorBoundaryState> {
  override state: PluginErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): PluginErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    const message = error instanceof Error ? error.message : String(error);
    this.props.onError?.({ pluginId: this.props.pluginId, contributionId: this.props.contributionId, message });
    console.error(`[ui-plugin] ${this.props.pluginId}/${this.props.contributionId} 渲染失败`, message, info.componentStack);
  }

  override componentDidUpdate(previous: PluginErrorBoundaryProps) {
    if (previous.pluginId !== this.props.pluginId || previous.contributionId !== this.props.contributionId) {
      if (this.state.message !== null) this.setState({ message: null });
    }
  }

  override render() {
    if (this.state.message !== null) {
      return (
        <span className="plugin-contribution-error" role="status" title={this.state.message}>
          插件组件不可用
        </span>
      );
    }
    return this.props.children;
  }
}
