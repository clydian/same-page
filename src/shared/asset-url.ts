declare const __SAME_PAGE_ASSET_BASE__: string;
export const assetBase = typeof __SAME_PAGE_ASSET_BASE__ === "string" ? __SAME_PAGE_ASSET_BASE__ : "/";
export const assetUrl = (path: string) => assetBase + path.replace(/^\//, "");
