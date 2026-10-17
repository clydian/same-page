import type { ScoreSummary } from '../../../shared/scores';
import { visibleAttachmentCount } from '../../../shared/scores';
import { useLibraryAttachments } from './use-library-attachments';

// Legacy summaries need their saved directory even while collapsed. Resolving
// presentation never rewrites a summary, cache revision, or access decision.
export function useLibraryAttachmentPresentation(choirId: string, scores: ScoreSummary[], expanded: Set<string>, active: boolean, generation: string, owner?: string) {
  const requested = scores.filter(score => expanded.has(score.id) || score.hasGeneratedXml === undefined);
  const metadata = useLibraryAttachments(choirId, requested, active, generation, owner);
  return {
    ...metadata,
    forScore(score: ScoreSummary) {
      if (metadata.statusFor(score.id) !== 'ready') return { count: visibleAttachmentCount(score), hasGeneratedXml: score.hasGeneratedXml ?? false };
      const items = metadata.items.filter(item => item.scoreId === score.id && !item.trashExpiresAt);
      return { count: items.filter(item => item.source !== 'generated').length, hasGeneratedXml: items.some(item => item.source === 'generated') };
    },
  };
}
