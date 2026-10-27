import { expect, it } from 'vitest';
import { sourceArtifact, wasBetaAdmitted } from './extended-run-plan.mjs';

it('accepts only the original attempt with a successful beta admission', async () => {
  let jobs = [{name:'deploy',conclusion:'success',steps:[{name:'Admit verified frontend to beta',conclusion:'success'}]}];
  const calls = [];
  const check = () => wasBetaAdmitted({repository:'example/repo',runId:123,attempt:2,token:'fixture',fetchImpl:async url => {
    calls.push(url); return Response.json({total_count:jobs.length,jobs});
  }});
  expect(await check()).toBe(true);
  expect(calls[0]).toContain('/runs/123/attempts/2/jobs?per_page=100');
  jobs[0].steps[0].conclusion = 'skipped'; expect(await check()).toBe(false);
  jobs[0].steps[0].conclusion = 'success'; jobs[0].conclusion = 'failure'; expect(await check()).toBe(false);
  jobs = []; expect(await check()).toBe(false);
  await expect(wasBetaAdmitted({repository:'example/repo',runId:123,attempt:1,token:'fixture',fetchImpl:async () => Response.json({total_count:101,jobs:[]})})).rejects.toThrow('paginated');
});

it('pins exactly one unexpired artifact ID from the source run', async () => {
  const sha = 'a'.repeat(40), artifact = {id: 42, name:`release-${sha}`, expired:false};
  const fetchImpl = async () => Response.json({total_count:1,artifacts:[artifact]});
  expect(await sourceArtifact({repository:'example/repo',runId:123,sha,token:'fixture',fetchImpl})).toBe(42);
  artifact.expired = true;
  await expect(sourceArtifact({repository:'example/repo',runId:123,sha,token:'fixture',fetchImpl})).rejects.toThrow('unexpired');
});
