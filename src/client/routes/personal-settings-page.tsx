import { UserRound } from "lucide-react";
import { useApplicationIdentity } from "../auth/application-identity";
import { IdentityNotice } from "../auth/local-entry";
import { useLogout } from "../auth/logout-context";
import { Link } from "react-router-dom";
import { TaskHeader } from "../components/task-header";

export default function PersonalSettingsPage() {
  const identity = useApplicationIdentity();
  const { session } = identity;
  const logout = useLogout();
  const email = session.data?.user.email;
  return <div className="app-page">
    <TaskHeader title={"账户"} backTo={"/drives"} />
    <main className="page-shell settings-page settings-ux personal-settings-page">
      <div className="personal-settings-account">
        <span className="personal-settings-avatar" aria-hidden="true"><UserRound size={21} /></span>
        <div className="personal-settings-identity"><p>{email ?? (identity.localUserId ? "本机用户" : "访客")}</p><small>{identity.localUserId ? "你的账户" : "尚未登录"}</small></div>
        {identity.localUserId ? <button className="secondary-button" onClick={() => void logout.request()}>退出登录</button> : !identity.restoring && identity.onlineState === "signed-out" && <Link className="secondary-button" to="/login">登录</Link>}
      </div>
      <IdentityNotice identity={identity} />
      <section className="personal-settings-data"><h2>用户与数据</h2><Link className="settings-secondary-link settings-danger-link" to="/user/lifecycle">删除用户<span aria-hidden="true">›</span></Link><p>笔记图层的阅读偏好和显示名在各云盘中分别设置。</p></section>
    </main>
  </div>;
}
