-- The release administrator roster is the sole migration source, never a union.
CREATE TABLE product_administrators (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE
);
INSERT INTO product_administrators(user_id) SELECT user_id FROM release_operators;

-- Read compatibility for deployed Workers and their atomic publication guards.
-- Legacy grant commands fail closed instead of creating partial or wider grants.
DROP TABLE release_operators;
DROP TABLE product_operators;
DROP TABLE diagnostic_operators;
CREATE VIEW release_operators AS SELECT user_id FROM product_administrators;
CREATE VIEW product_operators AS
  SELECT user_id, 1 AS view_scores, 1 AS review_xml, 1 AS publish_xml
  FROM product_administrators;
CREATE VIEW diagnostic_operators AS
  SELECT user_id, 1 AS can_delete FROM product_administrators;
