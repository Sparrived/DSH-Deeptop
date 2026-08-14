type WindowControlsProps = {
  windowMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
};

export function WindowControls({ windowMaximized, onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  return (
    <div className="window-controls" aria-label="窗口控制">
      <button className="window-control minimize" onClick={onMinimize} title="最小化" aria-label="最小化"><span className="window-control-glyph" aria-hidden="true" /></button>
      <button className={`window-control ${windowMaximized ? "restore" : "maximize"}`} onClick={onToggleMaximize} title={windowMaximized ? "还原" : "最大化"} aria-label={windowMaximized ? "还原" : "最大化"}><span className="window-control-glyph" aria-hidden="true" /></button>
      <button className="window-control close" onClick={onClose} title="关闭" aria-label="关闭"><span className="window-control-glyph" aria-hidden="true" /></button>
    </div>
  );
}
