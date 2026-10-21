import { Link } from "react-router-dom";
import { TaskHeader } from "../components/task-header";

export function NotFoundPage() {
  return (
    <div className="app-page">
      <TaskHeader title="页面不存在" backTo="/drives" backBehavior="parent" />
      <main className="page-shell compact-page">
        <p>这个地址没有对应的页面，请返回我的云盘继续浏览。</p>
        <Link className="primary-link" to="/drives">返回我的云盘</Link>
      </main>
    </div>
  );
}
