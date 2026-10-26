import { Link } from "react-router-dom";
import { connectionsEnabled, connectionWebsites } from "../connection/connection";

export function AppFooter() {
  return (
    <footer className="app-footer">
      <nav aria-label="产品信息">
        <Link to="/help">使用手册</Link>
        <Link to="/about">关于与更新</Link>
        <Link to="/privacy">隐私政策</Link>
        {connectionsEnabled && <a href={connectionWebsites.backup} target="_blank" rel="noopener noreferrer">备用网址</a>}
      </nav>
    </footer>
  );
}
