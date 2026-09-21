import { Check } from "lucide-react";
import { Button } from "react-aria-components";
import { Link } from "react-router-dom";
import { loginHref } from "../auth/login-return";
import { DriveSuggestion } from "../components/drive-suggestion";
import { InstallButton } from "../install/install-entry";
import { useInstall } from "../install/install-context";
import "./drive-preparation.css";

export function DrivePreparation({ choirId, accountReady }: { choirId: string; accountReady: boolean }) {
  const install = useInstall();
  if (!install || (install.hidden && accountReady)) return null;
  const installed = install.hidden;
  const pendingInstall = install.requested && !installed;
  const login = loginHref(`/choirs/${choirId}`);
  return <DriveSuggestion id="preparation" label="排练准备" title="为下次排练做好准备"
    closeLabel="暂时不用，关闭排练准备"
    action={<>
      {!installed && (pendingInstall
        ? <Button className="secondary-button" onPress={install.open}>查看添加帮助</Button>
        : <InstallButton className="primary-button" />)}
      {!accountReady && <Link className={installed ? "primary-button" : "preparation-login"} to={login}>
        {installed ? "注册 / 登录，开始记笔记" : "暂不添加，直接登录"}
      </Link>}
    </>}>
    <ol className="preparation-steps">
      <li data-complete={installed || undefined}>
        <span className="preparation-step-marker" aria-hidden="true">{installed ? <Check size={16} /> : "1"}</span>
        <div><strong>{installed ? "已添加到桌面" : pendingInstall ? "添加请求已提交" : "添加到桌面"}</strong>
          {!installed && <p>{pendingInstall ? "回到桌面，点合谱图标打开。" : "像其他 App 一样，点合谱图标就能打开。"}</p>}
        </div>
      </li>
      <li data-complete={accountReady || undefined}>
        <span className="preparation-step-marker" aria-hidden="true">{accountReady ? <Check size={16} /> : "2"}</span>
        <div><strong>{accountReady ? "已登录并加入云盘" : "登录，保存并同步笔记"}</strong>
          {!accountReady && <p>{install.runningInApp
            ? "注册或登录并加入此云盘，换设备也能接着记。"
            : "建议从桌面打开后登录，加入此云盘，让笔记随身同步。"}</p>}
        </div>
      </li>
    </ol>
  </DriveSuggestion>;
}
