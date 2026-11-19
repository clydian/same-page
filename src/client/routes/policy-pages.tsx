import { NavLink, Link } from "react-router-dom";
import { useMessages } from "../../i18n";
import { TaskHeader } from "../components/task-header";
import "./policy-pages.css";

const titles = { pricing: "价格与方案", terms: "服务条款", refunds: "取消与退款" };
export default function PolicyPage({ kind }: { kind: keyof typeof titles }) {
  const t = useMessages("common");
  return <div className="privacy-page policy-page">
    <TaskHeader title={t(kind)} backTo="/" />
    <PolicyDocument kind={kind} />
  </div>;
}

/* eslint-disable i18n/product-copy -- These review drafts describe the proposed China-market terms and carry their own document language. */
function PolicyDocument({ kind }: { kind: keyof typeof titles }) {
  return <main className="privacy-document policy-document" lang="zh-Hans">
      <header className="privacy-document__header">
        <p className="eyebrow">合谱 · Same Page</p>
        <p className="policy-status"><strong>审阅草稿 · 付费筹备中</strong><br />尚未开放购买。以下付费方案和政策均待实现、审阅与正式生效，当前不构成已上线能力或生效条款。</p>
        <h2 className="policy-title">{kind === "pricing" ? "为每一次合练，留好空间。" : titles[kind]}</h2>
        <p className="privacy-document__lead">{kind === "pricing" ? "按云盘订阅，成员一起使用。中国市场人民币含税年价草案。" : "先把规则讲清楚，再开放付费。草稿整理于 2026-11-18，生效日期待确定。"}</p>
      </header>
      <nav className="policy-nav" aria-label="价格与政策">
        {Object.entries(titles).map(([path, title]) => <NavLink key={path} to={`/${path}`}>{title}</NavLink>)}
        <Link to="/privacy">隐私政策</Link>
      </nav>
      {kind === "pricing" ? <Pricing /> : kind === "terms" ? <Terms /> : <Refunds />}
      <section><h2>正式开放前仍需确定</h2><p>经营者真实姓名／品牌及必要身份资料、生效日期、适用法律与争议处理条款、实际付款隐私字段与保留期限、升级补差价与降级规则、退款后的数据取回安排、支付失败及重试宽限规则，均待确定。未完成确认与实现前不开放购买。</p><p>咨询或反馈：<a href="mailto:admin@clyapps.com">admin@clyapps.com</a>。请勿发送密码、验证码、完整银行卡资料或私有乐谱。</p></section>
      <Link className="privacy-document__home" to="/" state={{ home: true }}>返回产品首页</Link>
  </main>;
}

function Pricing() {
  return <>
    <section aria-labelledby="annual-plans"><h2 id="annual-plans">年度云盘方案 · 待上线</h2>
      <div className="policy-plans">{[{ price: 99, storage: 5, members: 25 }, { price: 199, storage: 20, members: 50 }, { price: 399, storage: 50, members: 100 }].map(plan => <article key={plan.price} className="policy-plan"><h3>{plan.storage} GB 云盘</h3><p className="policy-price"><strong>¥{plan.price}</strong><span> / 年，含税</span></p><p>{plan.members} 位有效成员（含拥有者）</p><p>容量内不另限乐谱份数</p><p className="policy-plan-status">筹备中 · 尚未开放购买</p></article>)}</div>
      <p>每个云盘单独订阅，无需每位成员分别购买，拟每年自动续费。付款前须清楚展示所选云盘和方案、本次含税总额、下次续费日期及金额，不在结账时另加适用销售税；目前没有付款或订阅管理入口。</p>
    </section>
    <section><h2>免费体验与已有云盘</h2><p><strong>当前新建免费云盘：20 位有效成员（含拥有者）、50 MB、10 份当前乐谱。</strong>新建免费云盘改为 10 人、50 MB、10 份谱是待上线规则，本页不会改变现有额度。已有云盘保留各自配置，包括已有的免费 100 人特例；请以云盘实际配置为准。</p><p>经验证的用户最多拥有一个免费体验云盘，创建名额受平台总量限制。免费体验无固定到期时间，不承诺永久保留。连续超过 30 天无成员联网访问时可能被人工清理，至少提前 14 天邮件通知拥有者；通知期内任一成员重新联网访问即取消本次清理。</p></section>
    <section><h2>年费包含什么</h2><p>PDF 阅读、共享与个人笔记、离线准备、笔记 PDF 导出，以及已有 MusicXML 的练习播放。笔记按产品同步机制更新，并非实时多人协作。</p><p>自动生成练习版目前由运营导入审核，不代表已开放自助转谱。收费 PDF 转 MusicXML 和转谱 credits 尚未开放，也不包含在年费中，年费不含人工校订。自动生成练习版可能与原谱不同，需要核对。</p></section>
    <section><h2>容量与文件边界</h2><p>容量包含主谱、附件、候选文件、回收站及历史保留文件。沿用现有 1024 进位显示口径：1 GB = 1024 MB，1 MB = 1024 × 1024 字节。</p><p>主谱 PDF 单文件最多 20 MiB、500 页。附件支持音频、PDF、Markdown、MusicXML 与链接，每谱最多 100 个附件；音频最多 50 MiB，PDF／MusicXML 最多 20 MiB，Markdown 最多 1 MiB。MiB 为 1024 × 1024 字节。合谱面向乐谱与排练资料，不是通用视频网盘。</p></section>
    <section><h2>续费、取消与到期</h2><p>拟提供无需说明理由的便捷取消方式；期末取消保留已付费期间权益。首次购买 14 天内、年度误续费后 7 天内可申请该次全额退款，更有利的权利不受影响。详见<Link to="/refunds">取消与退款草稿</Link>。</p><p>到期后的只读取回、保留与通知安排均待实现，详见<Link to="/terms">服务条款中的到期安排</Link>。</p></section>
  </>;
}

function Terms() {
  return <>
    <section><h2>服务与使用范围</h2><p>合谱是为合唱排练设计的乐谱云盘，提供 PDF 阅读、共享与个人笔记、离线准备、笔记 PDF 导出和已有 MusicXML 播放。共享笔记不是实时多人协作；运营导入审核生成练习版不等于自助转谱服务。收费转谱与 credits 尚未开放，不含在年费中。</p><p>请只上传、分享和使用你有权处理的乐谱、附件与笔记，并遵守云盘权限及适用法律。拥有者负责选择适合的容量、成员额度与授权范围；拥有权不授予查看未分享个人层的权利。</p></section>
    <section><h2>内容、保存与合理使用</h2><p>上传不会转移内容所有权；你允许我们在提供你请求的存储、显示、同步、分享及处理功能所必要的范围内处理内容。成员身份不授予乐谱版权，退出或被移除可能停止云端访问与同步，已下载或离线保存的内容不能保证即时撤回。</p><p>请妥善保管认证方式和邀请码，留意保存、同步、冲突与离线准备提示，并保留重要原始文件。本机保存不等于云端同步；设备故障、浏览器清理或存储驱逐可能影响本机数据，不承诺未同步草稿已获云端备份。练习播放依赖源文件与设备支持，生成练习谱可能有音符、节奏、歌词或版式差异，不保证与原谱完全一致或达到出版级校订质量。</p><p>不得绕过认证或权限、访问未授权数据、恶意破坏服务或规避额度。安全与滥用处置不排除依法应履行的退款或其他义务。</p></section>
    <section><h2>订阅与额度 · 待上线</h2><p>年度方案按云盘自动续费，中国市场含税年价与额度见<Link to="/pricing">价格与方案</Link>。容量内不另限乐谱份数，有效成员包括拥有者。付款前须展示本次总额、下次续费日期及金额。升级补差价与降级生效规则尚未确定。重要价格或权益变更须按适用规则提前通知，不自行削减已付款期间的明确权益。</p><p>本草稿不修改免费云盘额度；当前新建仍为 20 人、50 MB、10 份当前乐谱。10 人是拟上线的新建规则，已有云盘保留各自配置。达到额度可能阻止新增操作，不会因此自动删谱或移除成员。</p></section>
    <section id="expiry"><h2>付费未续期后的安排 · 全部待实现</h2><p>以下是拟实现的承诺，尚未生效，也不是现有免费云盘的清理规则：</p><ol><li><strong>到期后 30 天：</strong>已有成员仅可读取、下载有权访问的文件及导出现有笔记；不得新增文件、成员或云端笔记。</li><li><strong>随后 60 天：</strong>继续保留数据，但停止云端访问。</li><li><strong>满 90 天仍未恢复：</strong>可能清理数据，须至少提前 14 天邮件通知云盘拥有者。未完成通知，不得仅因满 90 天而清理。</li></ol><p>支付失败与重试宽限、退款后的数据取回期限仍待确定，不适用上述安排来代替尚未确定的规则。</p></section>
    <section><h2>取消、退款与隐私</h2><p>拟在订阅管理或交易邮件中提供便捷取消，无需说明理由；普通期末取消保留本期权益。退款另行处理，详见<Link to="/refunds">取消与退款草稿</Link>。本草稿不限制适用的强制消费者权利。</p><p>现有数据处理方式见<Link to="/privacy">隐私政策</Link>。Paddle 仅为拟接入的支付服务，尚未开放购买；实际付款字段、保留期限及责任边界待确认后再补充，不表示当前已通过 Paddle 处理订单。</p></section>
  </>;
}

function Refunds() {
  return <>
    <section><h2>取消自动续费 · 待上线</h2><p>拟允许通过订阅管理或交易邮件中的入口便捷取消，不要求理由。普通期末取消停止下一期扣款，保留本次已付费期间权益；取消与退款分别处理，取消不会自动申请退款。目前尚无真实订阅或管理入口。</p></section>
    <section><h2>拟提供的全额退款保障</h2><ul><li><strong>首次购买后 14 天内：</strong>可申请该次全额退款。</li><li><strong>年度误续费后 7 天内：</strong>可申请该次全额退款。</li></ul><p>这些是拟提供的额外保障，不是所有交易的统一退款上限，不缩窄更有利的适用消费者权利或 Paddle 政策；行使其他无条件退款权利时，不要求证明“误续费”。</p><p>超过上述期限，重复收费、未交付、实质性产品缺陷及适用法定退款权利仍须处理，不会仅以“数字商品”或“已使用”为由一概拒绝。</p></section>
    <section><h2>更有利的消费者权利</h2><p>拟接入的 Paddle 的<a href="https://www.paddle.com/legal/refund-policy" target="_blank" rel="noreferrer">官方退款政策</a>单列中国消费者 7 天无条件取消及退款，并为符合其条件的英国年度订阅续期规定新的 14 天撤回期。各项规则按实际交易与适用条件判断，不泛化为所有法律情形；适用法律或政策提供更有利保障时，以更有利的权利为准。</p></section>
    <section><h2>申请与处理 · 待上线</h2><p>开放付费后，拟通过支持邮箱 admin@clyapps.com 协助申请，实际交易亦可按 Paddle 官方买家支持流程处理。退款拟由 Paddle 办理，可能需要批准；提交申请不代表已经批准或即时到账，完成情况以实际处理结果为准。当前邮箱仅提供咨询，不表示已有 Paddle 订单。</p><p>退款申请不表示已取消未来续费，办理时须分别确认退款结果与订阅状态。退款后的付费权益终止及数据取回安排与期限尚未确定，将在开放购买前明确；退款不代表删除整个用户身份或其他云盘，也不会用尚待确定的流程限制上述保障。</p></section>
  </>;
}
