import { useMessages } from "../../i18n";
import { scoreDisplayName } from "../../shared/score-display-name";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { localDatabase } from "../platform/local-database";
import { authenticatedLocalOwnerKey, currentLocalOwnerKey } from "../platform/local-workspace";

// Navigation only. Opening a saved score still verifies bytes and annotation snapshots.
export function LocalLibrary({ userId, choirId }: { userId: string; choirId?: string }) {
  const t = useMessages("library");
  const content = useLiveQuery(async () => {
    const ownerKey = authenticatedLocalOwnerKey(userId);
    try {
      return await localDatabase.transaction("r", [localDatabase.system, localDatabase.driveDirectories, localDatabase.offlineScores], async () => {
        if (await currentLocalOwnerKey() !== ownerKey) return null;
        const directories = await localDatabase.driveDirectories.where("ownerKey").equals(ownerKey).toArray();
        const saved = await localDatabase.offlineScores.where("ownerKey").equals(ownerKey).filter(record => record.active === 1).toArray();
        const ids = new Set([...directories.map(entry => entry.choirId), ...saved.map(entry => entry.choirId)]);
        return { userId, choirId, drives: [...ids].filter(id => !choirId || id === choirId).map(id => {
          const directory = directories.find(entry => entry.choirId === id);
          const copies = saved.filter(entry => entry.choirId === id);
          const scores = new Map((directory?.scores ?? []).map(score => [score.id, { id: score.id, fileName: score.fileName, saved: false }]));
          for (const copy of copies) scores.set(copy.scoreId, { id: copy.scoreId, fileName: copy.fileName, saved: true });
          return { id, name: directory?.choir.name ?? t("localLibrarySavedCloudDisk"), scores: [...scores.values()] };
        }) };
      });
    } catch { return null; }
  }, [userId, choirId, t]);
  if (content === undefined) return <p role="status">{t("localLibraryReadingLocalDirectory")}</p>;
  if (!content || content.userId !== userId || content.choirId !== choirId) return null;
  if (!content.drives.length) return <p>{t(choirId ? "localNoScoresInDrive" : "localNoScores")}</p>;
  return <section aria-label={t("localLibraryLocalMusicScoreDirectory")}>
    <p>{t("localLibrary")}</p>
    {content.drives.map(drive => <section key={drive.id}>
      <h2>{choirId ? drive.name : <Link className="local-drive-link" to={`/choirs/${drive.id}`}>{drive.name}</Link>}</h2>
      <div className="membership-list">{drive.scores.map(score => score.saved
        ? <Link className="membership-row" key={score.id} to={`/choirs/${drive.id}/scores/${score.id}`}><span>{scoreDisplayName(score.fileName)}</span><small>{t("localLibraryMachineHasBeenSaved")}</small></Link>
        : <div className="membership-row" key={score.id} aria-disabled="true" title={t("localLibraryNoOfflineCopyAvailable")}><span>{scoreDisplayName(score.fileName)}</span></div>)}</div>
    </section>)}
  </section>;
}
