-- Advisory results are keyed to the immutable release, never to the channel.
CREATE TABLE release_verification (
  build_id TEXT PRIMARY KEY REFERENCES frontend_releases(build_id),
  manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64),
  run_id INTEGER NOT NULL CHECK(run_id > 0),
  attempt INTEGER NOT NULL CHECK(attempt > 0),
  status TEXT NOT NULL CHECK(status IN ('running','success','failure','cancelled')),
  updated_at INTEGER NOT NULL
);
