-- Additive: old clients continue to write within one layer.
ALTER TABLE annotation_sync_operations ADD COLUMN source_layer_id TEXT;
