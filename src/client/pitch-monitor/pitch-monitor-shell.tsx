import { ArrowLeft } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMessages } from '../../i18n';
import { LoadingStatus } from '../components/loading-status';
import { useAppNavigation } from '../navigation/navigation-context';
import './pitch-monitor.css';

export function PitchMonitorShell({ children, theme, colors }: {
  children: ReactNode; theme?: 'dark' | 'light'; colors?: CSSProperties;
}) {
  const t = useMessages('common');
  const practice = useMessages('practice');
  const { choirId } = useParams();
  const { search } = useLocation();
  const navigation = useAppNavigation();
  const backTo = `${choirId ? `/choirs/${choirId}` : ''}/tools${search}`;

  return <main className="pitch-monitor-page pitch-monitor-theme" data-ui-theme={theme} style={colors}
    data-no-native-selection aria-labelledby="pitch-monitor-title">
    <h1 className="visually-hidden" id="pitch-monitor-title">{practice('pitchMonitor.title')}</h1>
    <button className="pitch-monitor-action pitch-monitor-icon pitch-monitor-back" type="button"
      aria-label={t('back')} onClick={() => navigation.back(backTo)}><ArrowLeft size={21} aria-hidden="true" /></button>
    {children}
  </main>;
}

export function PitchMonitorRouteFeedback({ failed }: { failed: boolean }) {
  const t = useMessages('common');
  const practice = useMessages('practice');
  const title = practice('pitchMonitor.title');

  return <PitchMonitorShell>
    <div className="pitch-monitor-message">
      {failed ? <>
        <p role="alert">{t('routeFailed', { title })}</p>
        <button className="secondary-button" type="button" onClick={() => window.location.reload()}>{t('reload')}</button>
        <Link className="secondary-link" to="/diagnostics">{t('reportProblem')}</Link>
      </> : <LoadingStatus>{t('routeLoading', { title })}</LoadingStatus>}
    </div>
  </PitchMonitorShell>;
}
